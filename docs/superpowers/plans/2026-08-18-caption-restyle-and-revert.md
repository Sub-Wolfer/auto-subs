# Caption Restyle, Richer Presets, and Revert — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users restyle AutoSubs captions already on a Resolve timeline, express text-box wrapping in presets, and undo styling changes or bulk-remove captions.

**Architecture:** Five new stateless endpoints in the Lua server, driven by the existing generic `resolve_bridge` Tauri command. Captions are identified by a UUID stamped onto their `AutoSubs` macro tool via `SetData`. Snapshot history lives entirely app-side in a Zustand store persisted through the Tauri store plugin. No Rust source is modified.

**Tech Stack:** TypeScript, React, Zustand, Vitest, Lua 5.1 (LuaJIT inside Resolve), Fusion macro `.setting` format.

**Spec:** `docs/superpowers/specs/2026-08-18-caption-restyle-and-revert-design.md`

## Global Constraints

- **No Rust changes.** `resolve_bridge` forwards arbitrary JSON; adding endpoints never requires touching `src-tauri/src/`.
- **Lua target is LuaJIT 5.1** as embedded in Resolve. No `goto`, no integer division operator, no `table.move`.
- **Lua runs sandboxed inside Resolve.** Use the existing `dump()` helper for logging; never `io.write` to stdout.
- **Caption identification is always** `comp:FindTool("AutoSubs") ~= nil`. Never match on clip name — users rename clips.
- **Apply styles only via the macro helper** `loadstring(autosubsTool:GetData("SetInputValues"))()(comp, autosubsTool, settings)`. Never call `tool:SetInput` directly for preset fields; the helper also runs `SetAnimations` and `UpdateHighlight`.
- **Per-caption failures are counted, never fatal.** Mirror `apply_subtitle_text` in `autosubs_core.lua:1363`.
- **Snapshot before mutate, always.** The app sequences `SnapshotCaptions` → persist → mutate. If the snapshot call fails, the mutation must not be attempted.
- **Colour precedence, highest first:** `captionOverrides[captionId]` → `trackColors[trackIndex]` → preset's own `FillColor{Red,Green,Blue}`.
- **Node 22 / npm 10.** All TypeScript work runs without the Rust toolchain (`npm run build:web`, `npx vitest`).
- **The `windows` Cargo feature currently carries a local `load-dynamic` workaround** (commit `f883b79`) that must be reverted before any upstream PR. Do not build on it or extend it.

---

## File Structure

**Created:**

| Path | Responsibility |
|---|---|
| `AutoSubs-App/vitest.config.ts` | Vitest config, jsdom-free (pure logic only) |
| `AutoSubs-App/src/lib/caption-colors.ts` | Colour rule resolution — pure, no I/O |
| `AutoSubs-App/src/lib/caption-colors.test.ts` | Tests for the above |
| `AutoSubs-App/src/lib/caption-snapshots.ts` | Snapshot construction, diffing, history pruning — pure |
| `AutoSubs-App/src/lib/caption-snapshots.test.ts` | Tests for the above |
| `AutoSubs-App/src/stores/caption-history-store.ts` | Zustand slice for snapshot history |
| `AutoSubs-App/src/components/dialogs/timeline-subtitles/timeline-subtitles-panel.tsx` | Panel shell: inventory, restyle, history |
| `AutoSubs-App/src/components/dialogs/timeline-subtitles/track-color-row.tsx` | One track's colour swatch + enable checkbox |
| `AutoSubs-App/src/components/dialogs/timeline-subtitles/snapshot-history-list.tsx` | History list with Restore buttons |

**Modified:**

| Path | Change |
|---|---|
| `AutoSubs-App/package.json` | Add `vitest` devDependency and `test` script |
| `AutoSubs-App/src/types.ts` | Add `ColorRules`, `CaptionSnapshot`, `SnapshotEntry`, `TimelineCaption` |
| `AutoSubs-App/src/presets/built-in-presets.ts` | Add `builtin:shorts-bold` |
| `AutoSubs-App/src/api/resolve-api.ts` | Add five endpoint wrappers |
| `Resolve-Integration/autosubs-macro.setting` | Publish 4 layout inputs; append 4 `InputKeys` |
| `AutoSubs-App/src-tauri/resources/modules/autosubs_core.lua` | Add 5 endpoints + dispatch branches |
| `AutoSubs-App/src-tauri/resources/modules/caption_template_version.lua` | Version bump after template regen |

---

## Task 1: Vitest harness and colour resolution

**Files:**
- Create: `AutoSubs-App/vitest.config.ts`
- Create: `AutoSubs-App/src/lib/caption-colors.ts`
- Test: `AutoSubs-App/src/lib/caption-colors.test.ts`
- Modify: `AutoSubs-App/package.json`
- Modify: `AutoSubs-App/src/types.ts`

**Interfaces:**
- Consumes: nothing (first task)
- Produces:
  - `type ColorRules = { trackColors?: Record<number, string>; captionOverrides?: Record<string, string> }`
  - `hexToRgb01(hex: string): { r: number; g: number; b: number }`
  - `resolveCaptionColor(args: { captionId: string; trackIndex: number; rules?: ColorRules; fallback: { r: number; g: number; b: number } }): { r: number; g: number; b: number }`
  - `applyColorToSettings(settings: Record<string, unknown>, rgb: { r: number; g: number; b: number }): Record<string, unknown>`

- [ ] **Step 1: Add Vitest dependency and script**

```bash
cd AutoSubs-App
npm install --save-dev vitest@^3.2.4 --no-audit --no-fund
```

Then add to `package.json` `"scripts"`, immediately after `"build:web"`:

```json
"test": "vitest run",
"test:watch": "vitest",
```

- [ ] **Step 2: Create Vitest config**

Create `AutoSubs-App/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
    resolve: {
        alias: { '@': path.resolve(__dirname, './src') },
    },
    test: {
        environment: 'node',
        include: ['src/**/*.test.ts'],
    },
});
```

The `@` alias must match `vite.config.ts` or imports like `@/types` fail.

- [ ] **Step 3: Add types**

Append to `AutoSubs-App/src/types.ts`:

```ts
export interface ColorRules {
    trackColors?: Record<number, string>;
    captionOverrides?: Record<string, string>;
}

export interface TimelineCaption {
    captionId: string;
    trackIndex: number;
    startFrame: number;
    endFrame: number;
    text: string;
}

export interface CaptionSnapshot extends TimelineCaption {
    macroSettings: Record<string, unknown>;
}

export interface SnapshotEntry {
    id: string;
    label: string;
    createdAt: string;
    operation: 'restyle' | 'generate' | 'remove-all';
    captions: CaptionSnapshot[];
}
```

- [ ] **Step 4: Write the failing tests**

Create `AutoSubs-App/src/lib/caption-colors.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { hexToRgb01, resolveCaptionColor, applyColorToSettings } from './caption-colors';

const FALLBACK = { r: 1, g: 1, b: 1 };

describe('hexToRgb01', () => {
    it('converts six-digit hex to 0..1 floats', () => {
        expect(hexToRgb01('#FFE64A')).toEqual({ r: 1, g: 230 / 255, b: 74 / 255 });
    });

    it('accepts hex without a leading hash', () => {
        expect(hexToRgb01('000000')).toEqual({ r: 0, g: 0, b: 0 });
    });

    it('throws on malformed input rather than silently returning black', () => {
        expect(() => hexToRgb01('#ZZZ')).toThrow();
    });
});

describe('resolveCaptionColor', () => {
    it('returns the fallback when no rules are given', () => {
        expect(resolveCaptionColor({ captionId: 'a', trackIndex: 3, fallback: FALLBACK }))
            .toEqual(FALLBACK);
    });

    it('uses the track colour when one matches', () => {
        const rules = { trackColors: { 3: '#000000' } };
        expect(resolveCaptionColor({ captionId: 'a', trackIndex: 3, rules, fallback: FALLBACK }))
            .toEqual({ r: 0, g: 0, b: 0 });
    });

    it('falls back when the track has no colour', () => {
        const rules = { trackColors: { 4: '#000000' } };
        expect(resolveCaptionColor({ captionId: 'a', trackIndex: 3, rules, fallback: FALLBACK }))
            .toEqual(FALLBACK);
    });

    it('prefers a caption override over the track colour', () => {
        const rules = { trackColors: { 3: '#000000' }, captionOverrides: { a: '#FFFFFF' } };
        expect(resolveCaptionColor({ captionId: 'a', trackIndex: 3, rules, fallback: FALLBACK }))
            .toEqual({ r: 1, g: 1, b: 1 });
    });

    it('applies an override to only the caption it names', () => {
        const rules = { trackColors: { 3: '#000000' }, captionOverrides: { a: '#FFFFFF' } };
        expect(resolveCaptionColor({ captionId: 'b', trackIndex: 3, rules, fallback: FALLBACK }))
            .toEqual({ r: 0, g: 0, b: 0 });
    });
});

describe('applyColorToSettings', () => {
    it('writes fill channels without mutating the input', () => {
        const settings = { Font: 'Montserrat' };
        const out = applyColorToSettings(settings, { r: 1, g: 0.5, b: 0 });
        expect(out.FillColorRed).toBe(1);
        expect(out.FillColorGreen).toBe(0.5);
        expect(out.FillColorBlue).toBe(0);
        expect(out.Font).toBe('Montserrat');
        expect(settings).toEqual({ Font: 'Montserrat' });
    });
});
```

- [ ] **Step 5: Run the tests and confirm they fail**

Run: `cd AutoSubs-App && npx vitest run src/lib/caption-colors.test.ts`
Expected: FAIL — `Failed to resolve import "./caption-colors"`.

- [ ] **Step 6: Implement**

Create `AutoSubs-App/src/lib/caption-colors.ts`:

```ts
import { ColorRules } from '@/types';

export interface Rgb01 {
    r: number;
    g: number;
    b: number;
}

const HEX_RE = /^#?([0-9a-fA-F]{6})$/;

/** Convert `#RRGGBB` (hash optional) to Fusion's 0..1 float channels. */
export function hexToRgb01(hex: string): Rgb01 {
    const match = HEX_RE.exec(hex.trim());
    if (!match) {
        throw new Error(`Invalid hex colour: ${hex}`);
    }
    const int = parseInt(match[1], 16);
    return {
        r: ((int >> 16) & 0xff) / 255,
        g: ((int >> 8) & 0xff) / 255,
        b: (int & 0xff) / 255,
    };
}

/**
 * Resolve a caption's fill colour. Precedence, highest first:
 *   1. an explicit per-caption override
 *   2. the colour assigned to its track
 *   3. the fallback (the preset's own fill colour)
 */
export function resolveCaptionColor(args: {
    captionId: string;
    trackIndex: number;
    rules?: ColorRules;
    fallback: Rgb01;
}): Rgb01 {
    const { captionId, trackIndex, rules, fallback } = args;
    if (!rules) return fallback;

    const override = rules.captionOverrides?.[captionId];
    if (override) return hexToRgb01(override);

    const trackColor = rules.trackColors?.[trackIndex];
    if (trackColor) return hexToRgb01(trackColor);

    return fallback;
}

/** Return a copy of `settings` with the fill channels replaced. */
export function applyColorToSettings(
    settings: Record<string, unknown>,
    rgb: Rgb01,
): Record<string, unknown> {
    return {
        ...settings,
        FillColorRed: rgb.r,
        FillColorGreen: rgb.g,
        FillColorBlue: rgb.b,
    };
}
```

- [ ] **Step 7: Run the tests and confirm they pass**

Run: `cd AutoSubs-App && npx vitest run src/lib/caption-colors.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 8: Commit**

```bash
git add AutoSubs-App/package.json AutoSubs-App/package-lock.json AutoSubs-App/vitest.config.ts AutoSubs-App/src/types.ts AutoSubs-App/src/lib/caption-colors.ts AutoSubs-App/src/lib/caption-colors.test.ts
git commit -m "feat: add vitest harness and caption colour resolution"
```

---

## Task 2: Shorts Bold preset with layout keys

**Files:**
- Modify: `AutoSubs-App/src/presets/built-in-presets.ts`
- Test: `AutoSubs-App/src/presets/built-in-presets.test.ts`

**Interfaces:**
- Consumes: `CaptionPreset` from `@/types` (already exists)
- Produces: preset id `'builtin:shorts-bold'` exported inside `BUILT_IN_PRESETS`

- [ ] **Step 1: Write the failing test**

Create `AutoSubs-App/src/presets/built-in-presets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { BUILT_IN_PRESETS } from './built-in-presets';

describe('BUILT_IN_PRESETS', () => {
    it('includes the Shorts Bold preset', () => {
        const preset = BUILT_IN_PRESETS.find(p => p.id === 'builtin:shorts-bold');
        expect(preset).toBeDefined();
        expect(preset!.builtIn).toBe(true);
    });

    it('positions Shorts Bold clear of the Shorts bottom overlay', () => {
        const preset = BUILT_IN_PRESETS.find(p => p.id === 'builtin:shorts-bold')!;
        const pos = preset.macroSettings.TextPosition as number[];
        expect(pos[0]).toBe(0.5);
        expect(pos[1]).toBeGreaterThanOrEqual(0.3);
    });

    it('enables wrapping so long captions cannot overflow the frame', () => {
        const preset = BUILT_IN_PRESETS.find(p => p.id === 'builtin:shorts-bold')!;
        expect(preset.macroSettings.Wrap).toBe(1);
        expect(preset.macroSettings.LayoutType).toBe(1);
        expect(preset.macroSettings.LayoutWidth as number).toBeLessThanOrEqual(0.9);
    });

    it('gives every preset a unique id', () => {
        const ids = BUILT_IN_PRESETS.map(p => p.id);
        expect(new Set(ids).size).toBe(ids.length);
    });
});
```

- [ ] **Step 2: Run the test and confirm it fails**

Run: `cd AutoSubs-App && npx vitest run src/presets/built-in-presets.test.ts`
Expected: FAIL — `expect(preset).toBeDefined()` receives `undefined`.

- [ ] **Step 3: Add the preset**

In `AutoSubs-App/src/presets/built-in-presets.ts`, append this object to the `BUILT_IN_PRESETS` array (after the last existing entry, before the closing `];`):

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
            Font: 'Montserrat',
            Style: 'ExtraBold',
            TextSize: 0.12,
            TextPosition: [0.5, 0.35, 0],
            LayoutType: 1,
            Wrap: 1,
            LayoutWidth: 0.8,
            LayoutHeight: 0.5,
            FadeEnabled: 0,
            PopInEnabled: 1,
            SlideUpEnabled: 0,
            AnimationLength: 0.2,
            AnimationLevel: 1,
            AnimationMode: 0,
            HighlightExtendHorizontal: -0.03,
            HighlightExtendVertical: 0.06,
            HighlightRound: 0.2,
            HighlightColorRed: 0,
            HighlightColorGreen: 0.208,
            HighlightColorBlue: 1,
            FillEnabled: 1,
            FillColorRed: 1,
            FillColorGreen: 0.902,
            FillColorBlue: 0.29,
            OutlineEnabled: 1,
            OutlineThickness: 0.14,
            OutlineColorRed: 0,
            OutlineColorGreen: 0,
            OutlineColorBlue: 0,
            ShadowEnabled: 0,
            ShadowColorRed: 0,
            ShadowColorGreen: 0,
            ShadowColorBlue: 0,
            HighlightStyle: 3,
            HighlightEnabled: 0,
        },
    },
```

- [ ] **Step 4: Run the test and confirm it passes**

Run: `cd AutoSubs-App && npx vitest run src/presets/built-in-presets.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Commit**

```bash
git add AutoSubs-App/src/presets/built-in-presets.ts AutoSubs-App/src/presets/built-in-presets.test.ts
git commit -m "feat: add Shorts Bold built-in caption preset"
```

---

## Task 3: Publish layout inputs on the Fusion macro

This is the fix for captions overflowing the frame. It is the only task with a manual Resolve step.

**Files:**
- Modify: `Resolve-Integration/autosubs-macro.setting`
- Modify: `AutoSubs-App/src-tauri/resources/modules/caption_template_version.lua`

**Interfaces:**
- Consumes: nothing
- Produces: macro inputs `Wrap`, `LayoutType`, `LayoutWidth`, `LayoutHeight`, settable via `SetInputValues` and capturable via `GetInputValues`

- [ ] **Step 1: Publish the four inputs**

In `Resolve-Integration/autosubs-macro.setting`, find the `Style = InstanceInput {` block (near line 1872) and insert immediately **after** its closing `},`:

```lua
				Wrap = InstanceInput {
					SourceOp = "Template",
					Source = "Wrap",
					Page = "Text",
				},
				LayoutType = InstanceInput {
					SourceOp = "Template",
					Source = "LayoutType",
					Page = "Text",
				},
				LayoutWidth = InstanceInput {
					SourceOp = "Template",
					Source = "LayoutWidth",
					Page = "Text",
				},
				LayoutHeight = InstanceInput {
					SourceOp = "Template",
					Source = "LayoutHeight",
					Page = "Text",
				},
```

Indentation is tabs, matching the surrounding file. `SourceOp` is `"Template"` because that is the name of the Text+ node inside the macro.

- [ ] **Step 2: Append the same names to `InputKeys`**

In the same file, in the `InputKeys` table starting near line 18, add after `"TextPosition",`:

```lua
					"Wrap",
					"LayoutType",
					"LayoutWidth",
					"LayoutHeight",
```

- [ ] **Step 3: Verify both edits are present**

Run:

```bash
grep -c 'Source = "Wrap"\|Source = "LayoutType"\|Source = "LayoutWidth"\|Source = "LayoutHeight"' Resolve-Integration/autosubs-macro.setting
```

Expected: `4`.

Run:

```bash
grep -c '"Wrap",\|"LayoutType",\|"LayoutWidth",\|"LayoutHeight",' Resolve-Integration/autosubs-macro.setting
```

Expected: `4`.

- [ ] **Step 4: Regenerate the caption template bin (manual, requires Resolve)**

1. From `AutoSubs-App/`, run `npm run setup-resolve`. This generates `AutoSubs - Update Caption Template.lua` with the absolute repo path substituted in.
2. Open Resolve with any project and a timeline.
3. Run `Workspace > Scripts > AutoSubs - Update Caption Template`.
4. Follow its prompts — it imports the existing bin, places the caption on the timeline, and waits for you to drag the updated clip into the new bin.
5. It exports a versioned `caption-bin.drb`.

This cannot be scripted end to end; the drag step is manual.

- [ ] **Step 5: Bump the template version**

Set the contents of `AutoSubs-App/src-tauri/resources/modules/caption_template_version.lua` to today's date, matching the version the update script produced:

```lua
return "2026-08-18"
```

`delete_obsolete_caption_templates` in `autosubs_core.lua` uses this to retire older templates from the media pool.

- [ ] **Step 6: Verify wrapping applies end to end (manual)**

In Resolve, with the regenerated template, generate or restyle a caption whose text is at least 36 characters. Confirm it wraps onto multiple centred lines and no glyph is clipped at either frame edge.

- [ ] **Step 7: Commit**

```bash
git add Resolve-Integration/autosubs-macro.setting AutoSubs-App/src-tauri/resources/modules/caption_template_version.lua AutoSubs-App/src-tauri/resources/caption-bin.drb
git commit -m "feat: publish text-box layout inputs on the caption macro"
```

---

## Task 4: Lua — list captions and stamp identity

**Files:**
- Modify: `AutoSubs-App/src-tauri/resources/modules/autosubs_core.lua`

**Interfaces:**
- Consumes: nothing
- Produces, for later Lua tasks:
  - `local function iter_caption_items(timeline, trackIndices)` → array of `{ item, comp, autosubsTool, template, trackIndex }`
  - `local function ensure_caption_id(autosubsTool)` → string UUID
  - `function ListCaptions(trackIndices)` → `{ captions = { { captionId, trackIndex, startFrame, endFrame, text } } }`

- [ ] **Step 1: Add the helpers**

In `autosubs_core.lua`, immediately **above** `local function apply_subtitle_text` (near line 1363), insert:

```lua
------------------------------------------------------------------------
-- Caption discovery and identity
--
-- A caption is any timeline item whose Fusion comp contains a tool named
-- "AutoSubs". Clip names are user-editable and must never be used.
------------------------------------------------------------------------

local function new_caption_uuid()
    local template = "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
    return (template:gsub("[xy]", function(c)
        local v = (c == "x") and math.random(0, 15) or math.random(8, 11)
        return string.format("%x", v)
    end))
end

-- Return the caption's stable id, creating and persisting one if absent.
local function ensure_caption_id(autosubsTool)
    local existing = autosubsTool:GetData("CaptionId")
    if existing ~= nil and existing ~= "" then
        return existing
    end
    local id = new_caption_uuid()
    autosubsTool:SetData("CaptionId", id)
    return id
end

-- Walk the requested video tracks and yield every AutoSubs caption found.
-- trackIndices may be nil (all video tracks) or an array of 1-based indices.
local function iter_caption_items(timeline, trackIndices)
    local wanted = nil
    if trackIndices ~= nil and #trackIndices > 0 then
        wanted = {}
        for _, idx in ipairs(trackIndices) do
            wanted[tonumber(idx)] = true
        end
    end

    local found = {}
    local trackCount = timeline:GetTrackCount("video")
    for trackIndex = 1, trackCount do
        if wanted == nil or wanted[trackIndex] then
            local items = timeline:GetItemListInTrack("video", trackIndex) or {}
            for _, item in ipairs(items) do
                local ok, entry = pcall(function()
                    local count = item:GetFusionCompCount()
                    if not count or count < 1 then return nil end
                    local comp = item:GetFusionCompByIndex(1)
                    if not comp then return nil end
                    local autosubsTool = comp:FindTool("AutoSubs")
                    if not autosubsTool then return nil end
                    return {
                        item = item,
                        comp = comp,
                        autosubsTool = autosubsTool,
                        template = comp:FindTool("Template"),
                        trackIndex = trackIndex,
                    }
                end)
                if ok and entry ~= nil then
                    table.insert(found, entry)
                end
            end
        end
    end
    return found
end

function ListCaptions(trackIndices)
    refresh_project()
    local timeline = project:GetCurrentTimeline()
    if not timeline then
        return make_error("No timeline", "no current timeline is open")
    end

    local captions = {}
    for _, entry in ipairs(iter_caption_items(timeline, trackIndices)) do
        local text = ""
        if entry.template then
            local ok, value = pcall(function() return entry.template:GetInput("Text") end)
            if ok and value ~= nil then text = value end
        end
        table.insert(captions, {
            captionId = ensure_caption_id(entry.autosubsTool),
            trackIndex = entry.trackIndex,
            startFrame = entry.item:GetStart(),
            endFrame = entry.item:GetEnd(),
            text = text,
        })
    end
    return { captions = captions }
end
```

`refresh_project()` and the module-level `project` upvalue are the file's established way of obtaining handles — see `GetTimelineInfo`. `refresh_project()` also resets the template-import flag on project switch, so calling it is required, not optional. `make_error(short, detail)` is defined at line 228.

- [ ] **Step 2: Add the dispatch branch**

In the `data.func` chain (near line 2056), insert immediately **before** the `elseif data.func == "Exit" then` branch:

```lua
                            elseif data.func == "ListCaptions" then
                                body = ListCaptions(data.trackIndices)
```

Match the surrounding branches' variable name for the response body — read two neighbouring branches first and copy their exact form.

- [ ] **Step 3: Verify the file still loads**

Run:

```bash
luajit -bl AutoSubs-App/src-tauri/resources/modules/autosubs_core.lua /dev/null 2>&1 | head -5 || echo "luajit unavailable - open Resolve and run Workspace > Scripts > AutoSubs (Dev), then check the console for syntax errors"
```

Expected: no syntax errors reported.

- [ ] **Step 4: Verify against a real timeline (manual)**

With Resolve open on a project containing AutoSubs captions, run the dev server (`Workspace > Scripts > AutoSubs (Dev)`), then from a terminal:

```bash
curl -s -X POST http://127.0.0.1:56002/ -d '{"func":"ListCaptions"}'
```

Expected: JSON with one entry per caption, each having a non-empty `captionId`. Run it twice and confirm the ids are **identical** across runs — that proves `SetData` persistence.

- [ ] **Step 5: Commit**

```bash
git add AutoSubs-App/src-tauri/resources/modules/autosubs_core.lua
git commit -m "feat: add ListCaptions endpoint with stable caption ids"
```

---

## Task 5: Lua — snapshot captions

**Files:**
- Modify: `AutoSubs-App/src-tauri/resources/modules/autosubs_core.lua`

**Interfaces:**
- Consumes: `iter_caption_items`, `ensure_caption_id` from Task 4
- Produces: `function SnapshotCaptions(trackIndices)` → `{ captions = { { captionId, trackIndex, startFrame, endFrame, text, macroSettings } } }`

- [ ] **Step 1: Add the endpoint**

Insert directly after `ListCaptions` in `autosubs_core.lua`:

```lua
-- Capture the full styling state of every caption in scope. The app persists
-- the result; Lua keeps no history of its own.
function SnapshotCaptions(trackIndices)
    refresh_project()
    local timeline = project:GetCurrentTimeline()
    if not timeline then
        return make_error("No timeline", "no current timeline is open")
    end

    local captions = {}
    local failed = 0
    for _, entry in ipairs(iter_caption_items(timeline, trackIndices)) do
        local ok, snapshot = pcall(function()
            local getter = entry.autosubsTool:GetData("GetInputValues")
            if not getter or getter == "" then
                error("macro is missing GetInputValues helper")
            end
            local settings = loadstring(getter)()(entry.autosubsTool)

            local text = ""
            if entry.template then
                local value = entry.template:GetInput("Text")
                if value ~= nil then text = value end
            end

            return {
                captionId = ensure_caption_id(entry.autosubsTool),
                trackIndex = entry.trackIndex,
                startFrame = entry.item:GetStart(),
                endFrame = entry.item:GetEnd(),
                text = text,
                macroSettings = settings or {},
            }
        end)
        if ok and snapshot ~= nil then
            table.insert(captions, snapshot)
        else
            failed = failed + 1
        end
    end

    return { captions = captions, failed = failed }
end
```

- [ ] **Step 2: Add the dispatch branch**

Immediately after the `ListCaptions` branch added in Task 4:

```lua
                            elseif data.func == "SnapshotCaptions" then
                                body = SnapshotCaptions(data.trackIndices)
```

- [ ] **Step 3: Verify against a real timeline (manual)**

```bash
curl -s -X POST http://127.0.0.1:56002/ -d '{"func":"SnapshotCaptions"}'
```

Expected: every caption carries a `macroSettings` object containing at least `Font`, `TextSize` and `FillColorRed`, and `failed` is `0`.

- [ ] **Step 4: Commit**

```bash
git add AutoSubs-App/src-tauri/resources/modules/autosubs_core.lua
git commit -m "feat: add SnapshotCaptions endpoint"
```

---

## Task 6: Lua — restyle captions

**Files:**
- Modify: `AutoSubs-App/src-tauri/resources/modules/autosubs_core.lua`

**Interfaces:**
- Consumes: `iter_caption_items`, `ensure_caption_id` from Task 4
- Produces: `function RestyleSubtitles(trackIndices, macroSettings, resolvedColors)` → `{ restyled, failed, errors }`

`resolvedColors` is a map of `captionId` → `{ r, g, b }`, already resolved by the app via `resolveCaptionColor` from Task 1. Colour precedence lives in TypeScript where it is unit-tested; Lua only applies what it is given.

- [ ] **Step 1: Add the endpoint**

Insert directly after `SnapshotCaptions`:

```lua
-- Re-apply styling to captions already on the timeline.
--
-- macroSettings is the preset body. resolvedColors optionally overrides the
-- fill colour per caption id; the app resolves precedence before calling.
function RestyleSubtitles(trackIndices, macroSettings, resolvedColors)
    if macroSettings == nil or next(macroSettings) == nil then
        return make_error("Nothing to apply", "macroSettings was empty")
    end

    refresh_project()
    local timeline = project:GetCurrentTimeline()
    if not timeline then
        return make_error("No timeline", "no current timeline is open")
    end

    local restyled, failed, errors = 0, 0, {}
    for _, entry in ipairs(iter_caption_items(timeline, trackIndices)) do
        local captionId = ensure_caption_id(entry.autosubsTool)

        -- Shallow copy so a per-caption colour never leaks into the next one.
        local settings = {}
        for k, v in pairs(macroSettings) do settings[k] = v end

        local color = resolvedColors and resolvedColors[captionId]
        if color then
            settings.FillColorRed = color.r
            settings.FillColorGreen = color.g
            settings.FillColorBlue = color.b
        end

        local ok, applyErr = pcall(function()
            local setter = entry.autosubsTool:GetData("SetInputValues")
            if not setter or setter == "" then
                error("macro is missing SetInputValues helper")
            end
            loadstring(setter)()(entry.comp, entry.autosubsTool, settings)
        end)

        if ok then
            restyled = restyled + 1
        else
            failed = failed + 1
            if #errors < 10 then
                table.insert(errors, captionId .. ": " .. tostring(applyErr))
            end
        end
    end

    return { restyled = restyled, failed = failed, errors = errors }
end
```

`make_error` already exists in this file — see its use at `AddSubtitles` (near line 1500). If its signature differs from `(summary, detail)`, match the existing call sites exactly.

- [ ] **Step 2: Add the dispatch branch**

```lua
                            elseif data.func == "RestyleSubtitles" then
                                body = RestyleSubtitles(data.trackIndices, data.macroSettings,
                                    data.resolvedColors)
```

- [ ] **Step 3: Verify against a real timeline (manual)**

```bash
curl -s -X POST http://127.0.0.1:56002/ -d '{"func":"RestyleSubtitles","macroSettings":{"Font":"Montserrat","Style":"ExtraBold","TextSize":0.12}}'
```

Expected: `restyled` equals the caption count, `failed` is `0`, and the captions visibly change font and size in Resolve. Confirm the pop-in animation still plays — that proves `SetInputValues` re-ran `SetAnimations`.

- [ ] **Step 4: Verify the track filter**

```bash
curl -s -X POST http://127.0.0.1:56002/ -d '{"func":"RestyleSubtitles","trackIndices":[4],"macroSettings":{"TextSize":0.14}}'
```

Expected: only track 4 captions change; track 3 captions are untouched.

- [ ] **Step 5: Commit**

```bash
git add AutoSubs-App/src-tauri/resources/modules/autosubs_core.lua
git commit -m "feat: add RestyleSubtitles endpoint"
```

---

## Task 7: Lua — restore and remove

**Files:**
- Modify: `AutoSubs-App/src-tauri/resources/modules/autosubs_core.lua`

**Interfaces:**
- Consumes: `iter_caption_items` from Task 4
- Produces:
  - `function RestoreSnapshot(captions)` → `{ restored, missing, failed, errors }`
  - `function RemoveAllSubtitles(trackIndices)` → `{ removed }`

Restore re-applies styling to captions that still exist and reports those that do not as `missing`. Recreating deleted captions requires the media-pool template and is deliberately **not** attempted here — see the note at the end of this task.

- [ ] **Step 1: Add both endpoints**

Insert directly after `RestyleSubtitles`:

```lua
-- Re-apply a previously captured snapshot, matching by caption id.
function RestoreSnapshot(captions)
    if captions == nil or #captions == 0 then
        return make_error("Nothing to restore", "snapshot contained no captions")
    end

    refresh_project()
    local timeline = project:GetCurrentTimeline()
    if not timeline then
        return make_error("No timeline", "no current timeline is open")
    end

    -- Index live captions by id so restore is O(n), not O(n^2).
    local live = {}
    for _, entry in ipairs(iter_caption_items(timeline, nil)) do
        local id = entry.autosubsTool:GetData("CaptionId")
        if id ~= nil and id ~= "" then live[id] = entry end
    end

    local restored, missing, failed, errors = 0, 0, 0, {}
    for _, snapshot in ipairs(captions) do
        local entry = live[snapshot.captionId]
        if entry == nil then
            missing = missing + 1
        else
            local ok, applyErr = pcall(function()
                local setter = entry.autosubsTool:GetData("SetInputValues")
                if not setter or setter == "" then
                    error("macro is missing SetInputValues helper")
                end
                loadstring(setter)()(entry.comp, entry.autosubsTool, snapshot.macroSettings)
                if entry.template and snapshot.text ~= nil then
                    entry.template:SetInput("Text", snapshot.text)
                end
            end)
            if ok then
                restored = restored + 1
            else
                failed = failed + 1
                if #errors < 10 then
                    table.insert(errors, tostring(snapshot.captionId) .. ": " .. tostring(applyErr))
                end
            end
        end
    end

    return { restored = restored, missing = missing, failed = failed, errors = errors }
end

-- Delete every AutoSubs caption in scope. The app must snapshot first.
function RemoveAllSubtitles(trackIndices)
    refresh_project()
    local timeline = project:GetCurrentTimeline()
    if not timeline then
        return make_error("No timeline", "no current timeline is open")
    end

    local doomed = {}
    for _, entry in ipairs(iter_caption_items(timeline, trackIndices)) do
        table.insert(doomed, entry.item)
    end

    if #doomed == 0 then
        return { removed = 0 }
    end

    local ok, deleteErr = pcall(function()
        timeline:DeleteClips(doomed)
    end)
    if not ok then
        return make_error("Failed to remove captions", tostring(deleteErr))
    end

    return { removed = #doomed }
end
```

- [ ] **Step 2: Add both dispatch branches**

```lua
                            elseif data.func == "RestoreSnapshot" then
                                body = RestoreSnapshot(data.captions)
                            elseif data.func == "RemoveAllSubtitles" then
                                body = RemoveAllSubtitles(data.trackIndices)
```

- [ ] **Step 3: Verify restore round-trips (manual)**

```bash
curl -s -X POST http://127.0.0.1:56002/ -d '{"func":"SnapshotCaptions"}' > /tmp/snap.json
curl -s -X POST http://127.0.0.1:56002/ -d '{"func":"RestyleSubtitles","macroSettings":{"TextSize":0.2}}'
```

Confirm the captions grow in Resolve. Then POST the saved snapshot back:

```bash
python -c "import json;d=json.load(open('/tmp/snap.json'));print(json.dumps({'func':'RestoreSnapshot','captions':d['captions']}))" | curl -s -X POST http://127.0.0.1:56002/ -d @-
```

Expected: `restored` equals the caption count, `missing` is `0`, and the captions return to their original size.

- [ ] **Step 4: Verify removal**

```bash
curl -s -X POST http://127.0.0.1:56002/ -d '{"func":"RemoveAllSubtitles","trackIndices":[4]}'
```

Expected: `removed` equals the track-4 caption count and those clips disappear; other tracks are untouched. Undo in Resolve (`Ctrl+Z`) to restore them before continuing.

- [ ] **Step 5: Commit**

```bash
git add AutoSubs-App/src-tauri/resources/modules/autosubs_core.lua
git commit -m "feat: add RestoreSnapshot and RemoveAllSubtitles endpoints"
```

**Known limitation to carry into the UI (Task 10):** `RestoreSnapshot` cannot resurrect deleted captions, so undoing Remove All will report every caption as `missing`. The UI must not present Remove All as undoable until caption recreation exists. Recreating them means appending the media-pool template at the recorded frame range and re-applying text and settings — a follow-up task, deliberately out of scope here to keep this plan shippable.

---

## Task 8: TypeScript API wrappers

**Files:**
- Modify: `AutoSubs-App/src/api/resolve-api.ts`

**Interfaces:**
- Consumes: `TimelineCaption`, `CaptionSnapshot` from Task 1
- Produces:
  - `listCaptions(trackIndices?: number[]): Promise<TimelineCaption[]>`
  - `snapshotCaptions(trackIndices?: number[]): Promise<CaptionSnapshot[]>`
  - `restyleSubtitles(args): Promise<{ restyled: number; failed: number; errors: string[] }>`
  - `restoreSnapshot(captions: CaptionSnapshot[]): Promise<{ restored: number; missing: number; failed: number }>`
  - `removeAllSubtitles(trackIndices?: number[]): Promise<{ removed: number }>`

- [ ] **Step 1: Read the existing call convention**

Open `AutoSubs-App/src/api/resolve-api.ts` and find an existing endpoint wrapper (for example the one calling `GetTimelineInfo`). Note exactly how it invokes `resolve_bridge`, how it passes `timeoutSecs`, and how it surfaces an `error` field from the response. **Match that shape precisely** — do not invent a new pattern.

- [ ] **Step 2: Add the wrappers**

Append to `resolve-api.ts`, adapting the transport call to match what you found in Step 1:

```ts
import { CaptionSnapshot, TimelineCaption } from '@/types';
import { Rgb01 } from '@/lib/caption-colors';

export async function listCaptions(trackIndices?: number[]): Promise<TimelineCaption[]> {
    const res = await callResolve({ func: 'ListCaptions', trackIndices });
    return res.captions ?? [];
}

export async function snapshotCaptions(trackIndices?: number[]): Promise<CaptionSnapshot[]> {
    const res = await callResolve({ func: 'SnapshotCaptions', trackIndices });
    return res.captions ?? [];
}

export async function restyleSubtitles(args: {
    trackIndices?: number[];
    macroSettings: Record<string, unknown>;
    resolvedColors?: Record<string, Rgb01>;
}): Promise<{ restyled: number; failed: number; errors: string[] }> {
    const res = await callResolve({
        func: 'RestyleSubtitles',
        trackIndices: args.trackIndices,
        macroSettings: args.macroSettings,
        resolvedColors: args.resolvedColors,
    });
    return { restyled: res.restyled ?? 0, failed: res.failed ?? 0, errors: res.errors ?? [] };
}

export async function restoreSnapshot(
    captions: CaptionSnapshot[],
): Promise<{ restored: number; missing: number; failed: number }> {
    const res = await callResolve({ func: 'RestoreSnapshot', captions });
    return { restored: res.restored ?? 0, missing: res.missing ?? 0, failed: res.failed ?? 0 };
}

export async function removeAllSubtitles(trackIndices?: number[]): Promise<{ removed: number }> {
    const res = await callResolve({ func: 'RemoveAllSubtitles', trackIndices });
    return { removed: res.removed ?? 0 };
}
```

`callResolve` is the real helper, defined at `resolve-api.ts:65`. It wraps `invoke('resolve_bridge', ...)` and parses the JSON body. Note it pairs with `throwIfError` (line 29) — check whether `callResolve` already calls it, and if not, call it yourself so a Lua `{ error = ... }` response surfaces as a rejected promise rather than a silently empty result.

- [ ] **Step 3: Typecheck**

Run: `cd AutoSubs-App && npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add AutoSubs-App/src/api/resolve-api.ts
git commit -m "feat: add timeline caption API wrappers"
```

---

## Task 9: Snapshot history store

**Files:**
- Create: `AutoSubs-App/src/lib/caption-snapshots.ts`
- Create: `AutoSubs-App/src/lib/caption-snapshots.test.ts`
- Create: `AutoSubs-App/src/stores/caption-history-store.ts`

**Interfaces:**
- Consumes: `CaptionSnapshot`, `SnapshotEntry` from Task 1
- Produces:
  - `makeSnapshotEntry(operation, captions, label?): SnapshotEntry`
  - `pruneHistory(entries: SnapshotEntry[], max: number): SnapshotEntry[]`
  - `historyKey(projectName: string, timelineId: string): string`
  - `useCaptionHistoryStore` with `{ entriesByKey, addEntry, removeEntry, clearKey }`

- [ ] **Step 1: Write the failing tests**

Create `AutoSubs-App/src/lib/caption-snapshots.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makeSnapshotEntry, pruneHistory, historyKey } from './caption-snapshots';
import { CaptionSnapshot, SnapshotEntry } from '@/types';

const caption: CaptionSnapshot = {
    captionId: 'c1',
    trackIndex: 3,
    startFrame: 0,
    endFrame: 10,
    text: 'HELLO',
    macroSettings: { Font: 'Montserrat' },
};

describe('makeSnapshotEntry', () => {
    it('records the operation and captions', () => {
        const entry = makeSnapshotEntry('restyle', [caption]);
        expect(entry.operation).toBe('restyle');
        expect(entry.captions).toHaveLength(1);
    });

    it('generates a unique id per entry', () => {
        const a = makeSnapshotEntry('restyle', [caption]);
        const b = makeSnapshotEntry('restyle', [caption]);
        expect(a.id).not.toBe(b.id);
    });

    it('derives a default label mentioning the caption count', () => {
        const entry = makeSnapshotEntry('restyle', [caption]);
        expect(entry.label).toContain('1');
    });

    it('honours an explicit label', () => {
        const entry = makeSnapshotEntry('restyle', [caption], 'before yellow');
        expect(entry.label).toBe('before yellow');
    });
});

describe('pruneHistory', () => {
    const entries: SnapshotEntry[] = [1, 2, 3, 4, 5].map(n => ({
        id: `e${n}`,
        label: `entry ${n}`,
        createdAt: `2026-08-1${n}T00:00:00.000Z`,
        operation: 'restyle',
        captions: [],
    }));

    it('keeps the newest entries and drops the oldest', () => {
        const kept = pruneHistory(entries, 3);
        expect(kept.map(e => e.id)).toEqual(['e5', 'e4', 'e3']);
    });

    it('returns everything when under the limit', () => {
        expect(pruneHistory(entries, 10)).toHaveLength(5);
    });

    it('never returns more than max', () => {
        expect(pruneHistory(entries, 0)).toHaveLength(0);
    });
});

describe('historyKey', () => {
    it('distinguishes timelines within the same project', () => {
        expect(historyKey('proj', 't1')).not.toBe(historyKey('proj', 't2'));
    });

    it('distinguishes projects sharing a timeline id', () => {
        expect(historyKey('a', 't1')).not.toBe(historyKey('b', 't1'));
    });
});
```

- [ ] **Step 2: Run the tests and confirm they fail**

Run: `cd AutoSubs-App && npx vitest run src/lib/caption-snapshots.test.ts`
Expected: FAIL — cannot resolve `./caption-snapshots`.

- [ ] **Step 3: Implement the pure helpers**

Create `AutoSubs-App/src/lib/caption-snapshots.ts`:

```ts
import { CaptionSnapshot, SnapshotEntry } from '@/types';

function genId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `snap-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const OPERATION_LABELS: Record<SnapshotEntry['operation'], string> = {
    restyle: 'Before restyle',
    generate: 'Before generate',
    'remove-all': 'Before remove all',
};

export function makeSnapshotEntry(
    operation: SnapshotEntry['operation'],
    captions: CaptionSnapshot[],
    label?: string,
): SnapshotEntry {
    return {
        id: genId(),
        label: label ?? `${OPERATION_LABELS[operation]} (${captions.length} captions)`,
        createdAt: new Date().toISOString(),
        operation,
        captions,
    };
}

/** Newest first, capped at `max`. Snapshots hold full styling for every
 *  caption, so an uncapped history would grow without bound. */
export function pruneHistory(entries: SnapshotEntry[], max: number): SnapshotEntry[] {
    return [...entries]
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
        .slice(0, Math.max(0, max));
}

export function historyKey(projectName: string, timelineId: string): string {
    return `${projectName} ${timelineId}`;
}
```

- [ ] **Step 4: Run the tests and confirm they pass**

Run: `cd AutoSubs-App && npx vitest run src/lib/caption-snapshots.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Create the store**

Read `AutoSubs-App/src/stores/settings-store.ts` first and copy its persistence idiom exactly — the `createTauriStorage` helper, the `persist` middleware options, and the hydration function. Then create `AutoSubs-App/src/stores/caption-history-store.ts`:

```ts
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { createTauriStorage } from '@/lib/tauri-storage';
import { SnapshotEntry } from '@/types';
import { pruneHistory } from '@/lib/caption-snapshots';

const STORE_FILE = 'autosubs-caption-history.json';
const STORE_KEY = 'history';
const MAX_ENTRIES_PER_TIMELINE = 10;

interface CaptionHistoryStore {
    entriesByKey: Record<string, SnapshotEntry[]>;
    addEntry: (key: string, entry: SnapshotEntry) => void;
    removeEntry: (key: string, entryId: string) => void;
    clearKey: (key: string) => void;
}

export const useCaptionHistoryStore = create<CaptionHistoryStore>()(
    persist(
        (set) => ({
            entriesByKey: {},
            addEntry: (key, entry) =>
                set((state) => ({
                    entriesByKey: {
                        ...state.entriesByKey,
                        [key]: pruneHistory(
                            [entry, ...(state.entriesByKey[key] ?? [])],
                            MAX_ENTRIES_PER_TIMELINE,
                        ),
                    },
                })),
            removeEntry: (key, entryId) =>
                set((state) => ({
                    entriesByKey: {
                        ...state.entriesByKey,
                        [key]: (state.entriesByKey[key] ?? []).filter((e) => e.id !== entryId),
                    },
                })),
            clearKey: (key) =>
                set((state) => {
                    const next = { ...state.entriesByKey };
                    delete next[key];
                    return { entriesByKey: next };
                }),
        }),
        {
            name: STORE_KEY,
            storage: createTauriStorage(STORE_FILE),
            partialize: (state) => ({ entriesByKey: state.entriesByKey }),
        },
    ),
);
```

If `createTauriStorage` takes a different argument list than `(STORE_FILE)`, match the call in `settings-store.ts` exactly.

- [ ] **Step 6: Typecheck and run the whole suite**

Run: `cd AutoSubs-App && npx tsc --noEmit && npx vitest run`
Expected: no type errors; all tests pass.

- [ ] **Step 7: Commit**

```bash
git add AutoSubs-App/src/lib/caption-snapshots.ts AutoSubs-App/src/lib/caption-snapshots.test.ts AutoSubs-App/src/stores/caption-history-store.ts
git commit -m "feat: add caption snapshot history store"
```

---

## Task 10: Timeline Subtitles panel

**Files:**
- Create: `AutoSubs-App/src/components/dialogs/timeline-subtitles/timeline-subtitles-panel.tsx`
- Create: `AutoSubs-App/src/components/dialogs/timeline-subtitles/track-color-row.tsx`
- Create: `AutoSubs-App/src/components/dialogs/timeline-subtitles/snapshot-history-list.tsx`

**Interfaces:**
- Consumes: everything from Tasks 1, 8 and 9
- Produces: `<TimelineSubtitlesPanel />`, mounted by whichever dialog host the app uses

- [ ] **Step 1: Study an existing dialog**

Read `AutoSubs-App/src/components/dialogs/caption-style/animated-preset-picker.tsx` and note the shadcn/ui primitives in use, how it reads presets from `PresetsContext`, and how it reports errors. Match those conventions; do not introduce a new UI library or error pattern.

- [ ] **Step 2: Build the track colour row**

Create `track-color-row.tsx`:

```tsx
interface TrackColorRowProps {
    trackIndex: number;
    captionCount: number;
    enabled: boolean;
    color: string;
    onToggle: (enabled: boolean) => void;
    onColorChange: (hex: string) => void;
}

export function TrackColorRow({
    trackIndex, captionCount, enabled, color, onToggle, onColorChange,
}: TrackColorRowProps) {
    return (
        <div className="flex items-center gap-3 py-2">
            <input
                type="checkbox"
                checked={enabled}
                onChange={(e) => onToggle(e.target.checked)}
                aria-label={`Include track V${trackIndex}`}
            />
            <span className="w-16 font-medium">V{trackIndex}</span>
            <span className="text-muted-foreground flex-1 text-sm">
                {captionCount} caption{captionCount === 1 ? '' : 's'}
            </span>
            <input
                type="color"
                value={color}
                onChange={(e) => onColorChange(e.target.value)}
                aria-label={`Colour for track V${trackIndex}`}
                className="h-8 w-12 cursor-pointer rounded border"
            />
        </div>
    );
}
```

- [ ] **Step 3: Build the history list**

Create `snapshot-history-list.tsx`:

```tsx
import { SnapshotEntry } from '@/types';

interface SnapshotHistoryListProps {
    entries: SnapshotEntry[];
    onRestore: (entry: SnapshotEntry) => void;
    busy: boolean;
}

export function SnapshotHistoryList({ entries, onRestore, busy }: SnapshotHistoryListProps) {
    if (entries.length === 0) {
        return <p className="text-muted-foreground py-4 text-sm">No snapshots yet.</p>;
    }
    return (
        <ul className="divide-y">
            {entries.map((entry) => (
                <li key={entry.id} className="flex items-center gap-3 py-2">
                    <div className="flex-1">
                        <div className="text-sm">{entry.label}</div>
                        <div className="text-muted-foreground text-xs">
                            {new Date(entry.createdAt).toLocaleString()}
                        </div>
                    </div>
                    <button
                        type="button"
                        disabled={busy}
                        onClick={() => onRestore(entry)}
                        className="rounded border px-3 py-1 text-sm disabled:opacity-50"
                    >
                        Restore
                    </button>
                </li>
            ))}
        </ul>
    );
}
```

- [ ] **Step 4: Build the panel**

Create `timeline-subtitles-panel.tsx`. The restyle handler must follow the snapshot-then-mutate ordering from the Global Constraints:

```tsx
import { useCallback, useEffect, useMemo, useState } from 'react';
import { TimelineCaption, SnapshotEntry } from '@/types';
import { listCaptions, snapshotCaptions, restyleSubtitles, restoreSnapshot } from '@/api/resolve-api';
import { resolveCaptionColor, hexToRgb01, Rgb01 } from '@/lib/caption-colors';
import { makeSnapshotEntry, historyKey } from '@/lib/caption-snapshots';
import { useCaptionHistoryStore } from '@/stores/caption-history-store';
import { usePresets } from '@/contexts/PresetsContext';
import { TrackColorRow } from './track-color-row';
import { SnapshotHistoryList } from './snapshot-history-list';

interface TimelineSubtitlesPanelProps {
    projectName: string;
    timelineId: string;
}

export function TimelineSubtitlesPanel({ projectName, timelineId }: TimelineSubtitlesPanelProps) {
    const { presets } = usePresets();
    const [captions, setCaptions] = useState<TimelineCaption[]>([]);
    const [presetId, setPresetId] = useState('builtin:shorts-bold');
    const [trackColors, setTrackColors] = useState<Record<number, string>>({});
    const [disabledTracks, setDisabledTracks] = useState<Record<number, boolean>>({});
    const [busy, setBusy] = useState(false);
    const [status, setStatus] = useState<string | null>(null);

    const key = historyKey(projectName, timelineId);
    const entries = useCaptionHistoryStore((s) => s.entriesByKey[key] ?? []);
    const addEntry = useCaptionHistoryStore((s) => s.addEntry);

    const refresh = useCallback(async () => {
        try {
            setCaptions(await listCaptions());
        } catch (err) {
            setStatus(`Could not read timeline: ${String(err)}`);
        }
    }, []);

    useEffect(() => { void refresh(); }, [refresh]);

    const tracks = useMemo(() => {
        const counts = new Map<number, number>();
        for (const c of captions) counts.set(c.trackIndex, (counts.get(c.trackIndex) ?? 0) + 1);
        return [...counts.entries()].sort((a, b) => a[0] - b[0]);
    }, [captions]);

    const selectedTracks = useMemo(
        () => tracks.map(([i]) => i).filter((i) => !disabledTracks[i]),
        [tracks, disabledTracks],
    );

    const handleRestyle = useCallback(async () => {
        const preset = presets.find((p) => p.id === presetId);
        if (!preset) { setStatus('Pick a preset first.'); return; }

        setBusy(true);
        setStatus(null);
        try {
            // Snapshot BEFORE mutating. If this throws, no restyle is attempted.
            const snapshot = await snapshotCaptions(selectedTracks);
            addEntry(key, makeSnapshotEntry('restyle', snapshot));

            const fallback: Rgb01 = {
                r: Number(preset.macroSettings.FillColorRed ?? 1),
                g: Number(preset.macroSettings.FillColorGreen ?? 1),
                b: Number(preset.macroSettings.FillColorBlue ?? 1),
            };
            const rules = { trackColors };
            const resolvedColors: Record<string, Rgb01> = {};
            for (const c of captions) {
                if (disabledTracks[c.trackIndex]) continue;
                resolvedColors[c.captionId] = resolveCaptionColor({
                    captionId: c.captionId,
                    trackIndex: c.trackIndex,
                    rules,
                    fallback,
                });
            }

            const res = await restyleSubtitles({
                trackIndices: selectedTracks,
                macroSettings: preset.macroSettings,
                resolvedColors,
            });
            setStatus(
                res.failed > 0
                    ? `${res.restyled} restyled, ${res.failed} failed.`
                    : `${res.restyled} captions restyled.`,
            );
            await refresh();
        } catch (err) {
            setStatus(`Restyle failed: ${String(err)}`);
        } finally {
            setBusy(false);
        }
    }, [presets, presetId, selectedTracks, trackColors, captions, disabledTracks, key, addEntry, refresh]);

    const handleRestore = useCallback(async (entry: SnapshotEntry) => {
        setBusy(true);
        setStatus(null);
        try {
            const res = await restoreSnapshot(entry.captions);
            setStatus(
                res.missing > 0
                    ? `${res.restored} restored, ${res.missing} no longer on the timeline.`
                    : `${res.restored} captions restored.`,
            );
            await refresh();
        } catch (err) {
            setStatus(`Restore failed: ${String(err)}`);
        } finally {
            setBusy(false);
        }
    }, [refresh]);

    return (
        <div className="space-y-6 p-4">
            <section>
                <h3 className="mb-2 font-semibold">Captions on timeline</h3>
                {captions.length === 0
                    ? <p className="text-muted-foreground text-sm">No AutoSubs captions found.</p>
                    : tracks.map(([trackIndex, count]) => (
                        <TrackColorRow
                            key={trackIndex}
                            trackIndex={trackIndex}
                            captionCount={count}
                            enabled={!disabledTracks[trackIndex]}
                            color={trackColors[trackIndex] ?? '#FFE64A'}
                            onToggle={(on) =>
                                setDisabledTracks((d) => ({ ...d, [trackIndex]: !on }))}
                            onColorChange={(hex) =>
                                setTrackColors((c) => ({ ...c, [trackIndex]: hex }))}
                        />
                    ))}
                <p className="text-muted-foreground mt-2 text-xs">
                    Colour follows the track. A caption moved to another track takes that
                    track&apos;s colour on the next restyle.
                </p>
            </section>

            <section>
                <h3 className="mb-2 font-semibold">Restyle</h3>
                <select
                    value={presetId}
                    onChange={(e) => setPresetId(e.target.value)}
                    className="w-full rounded border px-2 py-1"
                    aria-label="Preset"
                >
                    {presets.map((p) => (
                        <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                </select>
                <button
                    type="button"
                    disabled={busy || captions.length === 0}
                    onClick={handleRestyle}
                    className="mt-3 rounded border px-4 py-2 disabled:opacity-50"
                >
                    {busy ? 'Working…' : 'Apply to timeline'}
                </button>
            </section>

            <section>
                <h3 className="mb-2 font-semibold">History</h3>
                <SnapshotHistoryList entries={entries} onRestore={handleRestore} busy={busy} />
            </section>

            {status && <p className="text-sm" role="status">{status}</p>}
        </div>
    );
}
```

Note the hook name `usePresets` — confirm it against `PresetsContext.tsx` and correct the import if it differs.

**Remove All is deliberately absent from this panel.** Per Task 7, restore cannot resurrect deleted captions, so shipping the button would offer an undo that silently fails. Add it only once caption recreation exists.

- [ ] **Step 5: Typecheck and build**

Run: `cd AutoSubs-App && npx tsc --noEmit && npm run build:web`
Expected: both succeed.

- [ ] **Step 6: Verify end to end (manual, requires Resolve)**

1. Start the dev server in Resolve: `Workspace > Scripts > AutoSubs (Dev)`.
2. Run the app: `npm run dev:win`.
3. Open the Timeline Subtitles panel on a project with captions on two tracks.
4. Confirm the inventory shows the right per-track counts.
5. Assign different colours per track, apply Shorts Bold, confirm the timeline updates and each track takes its colour.
6. Confirm a snapshot appears in History; click Restore; confirm captions revert.
7. Confirm a caption longer than 36 characters wraps rather than overflowing.

- [ ] **Step 7: Commit**

```bash
git add AutoSubs-App/src/components/dialogs/timeline-subtitles/
git commit -m "feat: add Timeline Subtitles restyle and history panel"
```

---

## Deferred

Tracked deliberately, not forgotten:

- **Caption recreation on restore**, which is what would make Remove All genuinely undoable. Needs the media-pool template appended at each snapshot's frame range with text and settings re-applied.
- **Reverting the `load-dynamic` build workaround** (commit `f883b79`) before any upstream PR.
- **Two spec decisions never confirmed by the user:** that track-keyed colour recolours moved captions on the next restyle, and that `LayoutWidth: 0.80` is the right Shorts safe-zone width. Both are cheap to change; neither has been validated against a real Shorts export.
