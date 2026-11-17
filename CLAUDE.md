# Blender workflow

# Project Context: Post-Apo Isometric Grid RPG (Phaser 3 Migration)

## Overview
We are migrating an existing pure-JavaScript isometric post-apocalyptic turn-based RPG from Three.js (`Oldgame/`) to **Phaser 3 + TypeScript + Vite**. All graphics and audio in the original game are procedurally generated in code.

## Status: Amiga port paused (browser version first)
- The A1200 + PiStorm Lite 32 (miniGL) port is **paused**. Backup of that state: branch `backup/amiga-minigl` (commit `74ba0af`); notes in `docs/AMIGA_MINIGL.md`.
- Focus is the **browser version**. New code does not need to follow miniGL limits (textures <= 256 px, integer-only math, 50 Hz ticks, no FPU). Existing fixed-point code in `src/core/frontend/` and `src/core/campaign/region.ts` stays as is; don't rewrite it just to remove that.
- The `?profile=amiga` profile is kept but not maintained.

## Tech Stack & Environment
- **Language:** TypeScript (strict mode).
- **Engine:** Phaser 3 (WebGL/Canvas renderer, NO physics engine needed - pure grid logic).
- **Bundler:** Vite (`npm run dev` / `npm run build`).
- **Audio:** Pure Web Audio API synthesizer (`src/audio/SoundManager.ts`) migrated directly from `Oldgame/`.

## Architecture & Separation of Concerns (CRITICAL)
1. **`src/core/` (Pure Game Logic):**
   - Must contain ZERO Phaser, DOM, or Three.js dependencies.
   - Handles 2D grid coordinates (`gx, gy`), A* pathfinding, turn state machine (`EXPLORATION`, `PLAYER_TURN`, `ENEMY_TURN`, `DIALOGUE`, `INVENTORY`), Action Points (AP), combat math, loot tables, and Line of Sight (Bresenham).
2. **`src/audio/` (Procedural Sound):**
   - Encapsulate all Web Audio API sound synthesis extracted from `Oldgame/`. Expose clean methods (e.g., `playShoot()`, `playStep()`, `playClick()`).
3. **`src/scenes/` (Phaser 3 Rendering & UI):**
   - `WorldScene.ts`: Renders the isometric 2D grid, procedural pixel-art tiles/entities (using `Phaser.GameObjects.Graphics` and `generateTexture()`), path previews, and smooth tweens.
   - `UIScene.ts`: Runs in parallel to render HUD (AP counter, HP/Radiation bars, inventory, combat log, End Turn button).

## Isometric Projection & Pixel Art Rules
1. **Crisp Pixels:** `pixelArt: true`, `roundPixels: true`. Scene coordinates use the `480x270` design grid (`BASE_W x BASE_H`).
   - **Default resolution: 1920x1080** (Full HD = design grid x4). Scaling goes both ways from it: down to **HD 1280x720** and **640x480**, up to **QHD 2560x1440** and **4K 3840x2160**. These five presets are the resolution choices in Options (`RES_PRESETS` in `src/scenes/ui/Settings.ts`; URL `?res=640x480|hd|fhd|qhd|4k`).
   - The canvas is the preset size; `ZOOM = min(canvasW / 480, canvasH / 270)` and can be fractional (HD 2.67, QHD 5.33). Non-16:9 presets (640x480) are letterboxed: cameras get a centered `480x270 * ZOOM` viewport (`fitViewport` / `VX, VY, VW, VH` in `Kit.ts`). Never assume canvas size = `BASE * ZOOM` or that `ZOOM` is an integer; use `CANVAS_W/H` for full-canvas layers.
2. **Isometric Math:** Keep game logic in orthogonal grid coordinates `(gx, gy)`. Convert to screen coordinates only in the rendering layer:
   - `isoX = (gx - gy) * (tileWidth / 2)`
   - `isoY = (gx + gy) * (tileHeight / 2)`
   - Always sort sprite depth (`setDepth`) by `gx + gy` so entities render properly behind/in front of walls.
3. **Procedural Visuals:** Recreate the original Three.js procedural geometry/colors as crisp 2D isometric diamonds, blocks, and sprites via Phaser Graphics.

## Migration Rules (from `Oldgame/`)
- **`Oldgame/` was removed from the repo (2026-11-16).** The last commit that contains it is `58aaef7`; read a file from history with `git show 58aaef7:Oldgame/<path>` (fetch that commit first in a shallow clone). Comments in `src/` and `tests/` that cite `Oldgame/...` paths refer to that state.
- **Source Reference:** Read game rules, stats, combat formulas, map generators, and audio synthesis from `Oldgame/` (in history, see above).
- **Ignore 3D Overhead:** Discard all `THREE.Scene`, `THREE.Mesh`, cameras, and 3D lighting code.
- **Step-by-Step Execution:** Migrate one module at a time. Never rewrite the entire project in a single pass.

## Workflow & Token Economy
- **Do Not Read:** Never read `node_modules/`, `dist/`, or lockfiles unless explicitly asked.
- **Verification:** Run `npm run build` or `npx tsc --noEmit` after structural changes to ensure zero TypeScript errors.

## Session Start: Unmerged Work From Other Chats
Every cloud chat starts from a fresh clone of `main` on its own `ccr-*` branch, so work from earlier chats is invisible until merged.
- **At the start of each session**, run `git fetch origin` and list remote branches with commits not in `main` (`git log --oneline origin/main..origin/<branch>` for each `origin/ccr-*` and other feature branches; skip `backup/*`).
- If any exist, show the user each branch with its commit subjects and **ask whether to merge them into the current branch before starting work**. Do not merge without the user's answer.
- At the end of a chat, remind the user to merge the open PR so the next chat sees the changes.

## Pull Requests: Create Automatically
The user wants a PR to `main` after every pushed change, without being asked (standing permission).
- After each commit + push to the session's `ccr-*` branch, check whether that branch has an **open** PR to `main`. If it does, the new commits are already in it (update its title/description if the scope changed). If not (none yet, or the previous one was merged/closed), **create a new PR** right away.
- Before creating, run `git log --oneline origin/main..HEAD` so the PR describes only commits not yet in `main`. If the branch's previous PR was merged, fast-forward the branch to `origin/main` first (`git merge --ff-only origin/main`) when it has no unmerged commits.
- PR description in Polish: sections **Zmiany** and **Testy** (what was run: `tsc`, `build`, Playwright checks), plus any limitations.
- Give the user the PR link in the reply. Do not merge PRs yourself.

## Game Design Notes (remembered decisions)
- **Food supplies of Przystań** (`src/core/campaign/food.ts`, `CampaignState.food` in days): survivors eat 1 day of supplies per day (rest, contract travel days, travel events that add days); 12% daily chance of extra loss. Start 8, granary max 20. Starvation: -1 rep with Ocaleni per hungry day.
- **Forage contract (`forage`, "Zaopatrzenie")**: always on the board when food <= `FOOD_LOW` (4), 30% chance when <= 7, removed when > 12. Not part of `SIDE_TYPES`. Mission: collect 3-4 supply caches (`Mission.supplies`, kind `item` + `objective`) and extract. Reward `reward.food` (days); retreat gives food per collected cache. Supplies go to the granary, not the backpack.
