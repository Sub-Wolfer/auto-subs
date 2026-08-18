# Caption Restyle, Richer Presets, and Revert — Design

**Date:** 2026-08-18
**Status:** Approved for planning
**Scope:** `Resolve-Integration/autosubs-macro.setting`, `AutoSubs-App/src-tauri/resources/modules/autosubs_core.lua`, `AutoSubs-App/src` (TypeScript/React)
**Non-scope:** Rust backend, Adobe extension, transcription engines

## Problem

AutoSubs applies caption styling **only at generation time**. Once captions are on
the Resolve timeline there is no supported way to restyle them — the only path is
regenerating, which discards manual transcript corrections. There is also no way to
undo a styling change or remove generated captions in bulk.

Two concrete failures motivated this work:

1. **Long captions render off-screen.** The preset schema cannot express Fusion
   Text+ text-box layout, so captions longer than the frame width overflow past both
   edges. A 36-character caption at the default `TextSize: 0.07` is already clipped
   at 1080x1920, and any size increase makes it worse.
2. **Scripted Fusion edits are not reliably undoable.** Changes to Fusion comp
   inputs made through the scripting API do not consistently enter Resolve's undo
   stack, so `Ctrl+Z` is not a safety net for bulk restyling.

## Goals

- Restyle captions already on the timeline, without regenerating.
- Extend presets to express text-box wrapping and safe-zone positioning.
- Colour captions per track, with per-caption overrides.
- Snapshot-based undo, plus a bulk "remove all subtitles" that is itself undoable.

## Non-goals

- Per-caption style editing beyond colour.
- Speaker-based colouring (the existing `set_speaker_styling` path is untouched).
- Any change to transcription, diarization, or the Rust backend.

## Architecture

Existing transport is reused unchanged:

```
React --Tauri IPC--> resolve_bridge (generic) --HTTP :56002--> Lua server --> Resolve API
```

`resolve_bridge` forwards arbitrary JSON and is endpoint-agnostic, so **no Rust
source is modified**. The Lua server dispatches on `data.func` via an `if/elseif`
chain; new endpoints are additive branches.

Captions are identified by the presence of a tool named `AutoSubs` in the timeline
item's Fusion composition (`comp:FindTool("AutoSubs")`). This is how the macro is
already located during generation, so it is a reliable existing marker.

### Layer responsibilities

| Layer | Owns |
|---|---|
| Fusion macro | Which inputs are round-trippable (`InputKeys`) |
| Lua server | Stateless read/write against Resolve; no history |
| React app | Preset data, colour rules, snapshot history, all persistence |

Keeping Lua stateless matters: the Lua server restarts with Resolve, so any state it
held would be lost exactly when a user most needs to undo.

## Data model

### Macro changes

The macro currently publishes `Font`, `Style`, `TextSize`, `TextPosition`, the
Fill/Outline/Shadow/Highlight colours and the animation flags. It does **not**
publish any layout input, so wrapping cannot be expressed today.

Two edits are required in `autosubs-macro.setting`, not one:

1. **Publish four inputs** from the inner Text+ node, in the macro's `Inputs`
   block, following the existing `InstanceInput` pattern:

```lua
Wrap = InstanceInput {
    SourceOp = "Template",
    Source = "Wrap",
    Page = "Text",
},
```

   ...and likewise for `LayoutType`, `LayoutWidth`, `LayoutHeight`.

2. **Append the same four names to `InputKeys`** so they round-trip when a preset
   is captured from the Inspector.

Both are needed and they do different jobs: `InputKeys` governs *capture*
(`GetInputValues` iterates it), while publishing governs *apply* — `SetInputValues`
calls `tool:SetInput(key, value)` on the macro, which silently does nothing for an
input the macro does not expose. Neither helper function itself needs changing, and
presets predating this addition simply omit the keys and inherit macro defaults.

Shipping a macro change also requires regenerating `caption-bin.drb` (via
`Resolve-Integration/scripts/AutoSubs - Update Caption Template.lua`, which
`npm run setup-resolve` generates) and bumping
`resources/modules/caption_template_version.lua`. That step involves manual
interaction in Resolve and cannot be fully scripted.

`LayoutType: 1` selects Fusion's Frame layout; `Wrap: 1` enables wrapping within
`LayoutWidth` (a 0..1 fraction of frame width). Together these bound caption width
so long captions wrap to multiple centred lines instead of overflowing.

### New built-in preset

```ts
{
  id: 'builtin:shorts-bold',
  name: 'Shorts Bold',
  description: 'Montserrat ExtraBold, safe-zone position, wraps long captions',
  builtIn: true,
  version: 1,
  createdAt: EPOCH,
  updatedAt: EPOCH,
  macroSettings: {
    Font: 'Montserrat', Style: 'ExtraBold',
    TextSize: 0.12, TextPosition: [0.5, 0.35, 0],
    LayoutType: 1, Wrap: 1, LayoutWidth: 0.80, LayoutHeight: 0.5,
    FillEnabled: 1, FillColorRed: 1, FillColorGreen: 0.902, FillColorBlue: 0.29,
    OutlineEnabled: 1, OutlineThickness: 0.14,
    OutlineColorRed: 0, OutlineColorGreen: 0, OutlineColorBlue: 0,
    PopInEnabled: 1, AnimationLength: 0.2, AnimationLevel: 1,
    HighlightEnabled: 0,
  }
}
```

`TextPosition` Y of `0.35` places captions clear of the YouTube Shorts bottom
overlay (title, channel row, description), which occupies roughly the lower 15%.
The stock `0.12` sits inside it.

### Colour rules

Extends `CaptionPreset` with an optional field. Absent means current behaviour.

```ts
type ColorRules = {
  trackColors?: Record<number, string>      // track index -> hex
  captionOverrides?: Record<string, string> // caption UUID -> hex
}
```

Resolution precedence, highest first:

1. `captionOverrides[captionId]`
2. `trackColors[trackIndex]`
3. `macroSettings.FillColor{Red,Green,Blue}`

Resolved colour is written to `FillColorRed/Green/Blue`. Because rule 2 keys on
track, a caption moved between tracks is recoloured on the next restyle — intended,
and surfaced in the UI so it is not a surprise.

### Snapshot record

Persisted app-side, keyed by `projectName + timelineId`:

```ts
type CaptionSnapshot = {
  captionId: string
  trackIndex: number
  startFrame: number
  endFrame: number
  text: string
  macroSettings: Record<string, unknown>
}

type SnapshotEntry = {
  id: string
  label: string
  createdAt: string
  operation: 'restyle' | 'generate' | 'remove-all'
  captions: CaptionSnapshot[]
}
```

Recording `text`, `trackIndex` and the frame range — not only style — is what allows
undo to **recreate** captions deleted by Remove All. A style-only snapshot could not.

## Endpoints

All added to the `data.func` dispatch chain in `autosubs_core.lua`.

| Endpoint | Args | Returns |
|---|---|---|
| `ListCaptions` | `trackIndices?` | `{ captions: [{ captionId, trackIndex, startFrame, endFrame, text }] }` |
| `SnapshotCaptions` | `trackIndices?` | `{ captions: CaptionSnapshot[] }` |
| `RestyleSubtitles` | `trackIndices?`, `macroSettings`, `colorRules` | `{ restyled, failed, errors[] }` |
| `RestoreSnapshot` | `captions: CaptionSnapshot[]` | `{ restored, recreated, failed, errors[] }` |
| `RemoveAllSubtitles` | `trackIndices?` | `{ removed }` |

### Operation orchestration

Because the Lua layer is stateless, **the app sequences every destructive
operation**. Restyle and Remove All are each two calls, not one:

```
SnapshotCaptions(trackIndices)  ->  persist SnapshotEntry  ->  RestyleSubtitles(...)
SnapshotCaptions(trackIndices)  ->  persist SnapshotEntry  ->  RemoveAllSubtitles(...)
```

If the snapshot call fails, the mutation is not attempted. This keeps the Lua
endpoints individually simple and independently testable, and guarantees no
mutation can occur without a persisted snapshot preceding it.

### Identity stamping

Captions generated before this feature have no UUID. `RestyleSubtitles` and
`SnapshotCaptions` both stamp any unstamped caption **before** reading or writing,
via `autosubsTool:SetData("CaptionId", uuid)`. `SetData` persistence is already
relied upon by the macro for `WordTiming`, so this mechanism is proven.

Stamping before snapshotting guarantees every snapshot has stable identity, which
removes the need for any positional fallback matching.

### Applying style

`RestyleSubtitles` applies settings through the macro's own `SetInputValues` helper,
mirroring `apply_subtitle_text` (`autosubs_core.lua:1401`):

```lua
local setter = autosubsTool:GetData("SetInputValues")
loadstring(setter)()(comp, autosubsTool, settings)
```

This matters: `SetInputValues` also invokes `SetAnimations` and `UpdateHighlight`.
Writing inputs directly with `SetInput` would leave animation keyframes and
highlight state stale relative to the new style.

## UI

One new panel, "Timeline Subtitles", beside the existing caption-style dialog:

- **Inventory** — caption count per track, detected preset
- **Restyle** — preset picker, per-track colour swatches, track checkboxes, Apply
- **History** — snapshot list with label and timestamp, each with Restore
- **Remove All** — confirm dialog; records a snapshot so it is undoable

New Zustand slice `caption-history-store.ts` alongside `settings-store.ts`,
persisted via the Tauri fs plugin.

## Error handling

Follows the existing convention. Lua returns `{ error = "..." }` for whole-operation
failures. Per-caption failures are **counted and reported, not fatal** — the pattern
`apply_subtitle_text` already uses. A restyle failing on 3 of 31 captions reports
"28 restyled, 3 failed" rather than aborting midway and leaving a mixed timeline.

Snapshots are written **before** any mutation. If an operation fails partway, the
snapshot already covers every caption it was going to touch, so Restore recovers the
full pre-operation state.

## Testing

The repository currently has no test infrastructure. This work adds Vitest, which is
close to free given Vite is already the bundler.

**Unit tested** (pure functions, no Resolve):

- colour resolution precedence, including empty and partial rule sets
- preset merge and back-compat for presets lacking the new layout keys
- snapshot diffing and history pruning
- caption identity: stamping, dedup, matching on restore

**Manual smoke checklist** (documented in the PR, requires Resolve):

- restyle a mixed multi-track timeline; verify wrapping on a caption wider than frame
- restyle a subset via track filter; verify untouched tracks are unchanged
- Remove All, then Restore; verify text, timing and track are recreated
- restyle twice, restore to first snapshot
- confirm animation and highlight remain correct after restyle

## Compatibility

- Existing presets lack the four layout keys and inherit macro defaults — unchanged rendering.
- Existing captions lack a UUID and are stamped on first restyle or snapshot.
- `set_speaker_styling` is untouched; speaker colouring continues to work as today.
- No Rust changes, so no rebuild of native crates is required for review.

## Build prerequisite

Building a runnable bundle requires the Rust toolchain (rustup + MSVC build tools)
plus platform Cargo features (`--features windows` on Windows). Node 22 alone is
sufficient to typecheck, run Vitest, and build web assets (`npm run build:web`), so
all logic in this design can be developed and tested without the Rust toolchain.
