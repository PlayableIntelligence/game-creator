---
name: scaffold-gateables
description: Add gateable features to an existing browser game — skin picker, continue-after-death, bonus mode, save slots, daily challenge. Monetization-agnostic scaffolding that leaves clean hooks for any paywall, subscription, or entitlement layer. Features are scaffolded at silver and gold tiers only (bronze is the default everyone gets). Use when the user says "add gateables", "scaffold monetizable features", "add skin picker", "add continue-after-death", "make my game monetizable", or "add premium hooks". Do NOT use for Play.fun SDK integration (use monetize-game) or generic gameplay features (use add-feature).
argument-hint: "[path-to-game] [optional feature hints e.g. 'skins continue']"
license: MIT
metadata:
  author: OpusGameLabs
  version: 1.0.0
  tags: [game, gateables, monetization, skins, continue, save-slots, qol]
compatibility: Requires an existing Phaser 3 or Three.js game with game-creator architecture (EventBus, GameState, Constants.js, render_game_to_text).
---

## Performance Notes

- Take your time to understand the game before proposing features
- Quality is more important than speed — wrong gateables hurt the game permanently
- Do not skip the locked-path verification in Step 4

# Scaffold Gateables

Add gateable features to an existing game. This skill produces *hooks* — skin pickers, continue-after-death flows, bonus modes, save slots, daily challenges — each wired through EventBus with a single capability-check seam (`isEntitled(key)`). It does NOT add any specific monetization SDK (Play.fun, sub.games, Stripe, etc.); it produces the scaffolding that any paywall, subscription, or entitlement layer can later switch on.

The default state is everything locked — `isEntitled(key)` returns `false` for all keys. The game must feel completely normal in that state. When a downstream monetization layer flips an entitlement on, the gateable feature lights up.

## Core Principles

Use these to reason about what to propose and what to reject. They are rules, not guidelines.

1. **Never gate the core loop.** If the game is about jumping, everyone jumps. Gate skins, not gravity.
2. **Prefer additive over subtractive.** Add a bonus mode; don't shrink the free mode. Free players never feel punished.
3. **Match the game's rhythm.** Short sessions → session-scoped perks (continue, daily skin, daily challenge seed). Long-form → persistence (save slots, unlock tree, bonus chapters).
4. **Propose 2–3 gateables at silver and gold only.** Bronze is the default — every player gets the bronze experience by default, so no feature is scaffolded there. Aim for one or two silver conveniences and one gold spectacle. Numbers are targets — suggest what actually fits the game.
5. **Every gateable must degrade cleanly.** With `isEntitled` returning `false`, the game must feel normal — not broken, not missing.

## Tier Vocabulary

Use game-standard progression labels: **bronze** / **silver** / **gold**. This keeps the skill monetization-agnostic and reads naturally to players.

**Bronze is the default tier — every player is bronze by default.** The bronze experience IS the core game loop that everyone always gets. No feature is scaffolded at bronze; scaffold-gateables only produces features at **silver** and **gold**.

The downstream integration layer maps silver/gold to its own paid tier system:

| scaffold-gateables | sub.games | Play.fun (points-based) |
|---|---|---|
| silver | supporter ($3–8/mo) | mid-threshold points |
| gold | founder ($150/yr) | high-threshold points |

State this mapping in the Step 2 output so the handoff to `/subgames` or `/monetize-game` is explicit.

## Instructions

The user wants to add gateables to the game at `$ARGUMENTS` (or the current directory if no path given). Optional hint tokens after the path (e.g., `skins continue`) bias the proposal.

### Step 1: Understand the game

- Read `package.json` — detect engine (`phaser` → Phaser, `three` → Three.js).
- Read `src/core/Constants.js`, `src/core/EventBus.js`, `src/core/GameState.js`.
- Read `src/main.js` to find `window.render_game_to_text()` and the orchestrator entry point.
- Read `progress.md` at the project root if it exists (written by the `/viral-game` pipeline).
- Read the primary scene/system files to understand the core loop.

Then tell the creator one sentence:

> The core loop is **`<verb>`** — I will not gate it. Gateables will be additive features that layer on top.

### Step 2: Propose features

Generate 2–3 candidate gateables at silver and gold tiers anchored in the five principles. Present as a Markdown table:

| Feature | Tier | Entitlement key | What it adds | Locked path | EventBus events | GameState additions |
|---|---|---|---|---|---|---|
| Skin picker | silver | `premium_skins` | 5 cosmetic variants via a picker on GameOverScene | Default skin only; button greyed out | `skin:selected`, `skin:unlocked` | `selectedSkin: 'default'`, `unlockedSkins: ['default']` (persist through reset) |
| Continue after death | silver | `continue` | One continue per session offered on death | No continue prompt; immediate restart | `continue:offered`, `continue:accepted` | `continueOffered: false`, `usedContinue: false` (clear on reset) |
| Daily challenge mode | gold | `daily_challenge` | Unique seeded run each day with its own leaderboard | No daily challenge menu visible | `daily:opened`, `daily:completed` | `dailyChallengeSeed: null`, `dailyBestScore: 0` (persist through reset) |

Anchor picks in the principles. Reject any suggestion that gates the core loop. Never propose bronze-tier features — bronze is the default everyone gets. Prefer cosmetic > convenience > bonus > persistence for short-session games; flip the order for long-form.

**In interactive mode (user-invoked skill):** wait for creator confirmation before implementing. Let them drop, swap, or tweak suggestions.

**In pipeline mode (called from `/viral-game` Step 1.25):** auto-pick the top 2–3 and continue without prompting.

### Step 3: Implement

Follow this order strictly:

**3a. Create `src/systems/Entitlements.js`** — the single capability-check seam:

```js
// src/systems/Entitlements.js
// Single capability check for all gateable features.
// Returns false by default — every gateable must degrade cleanly when locked.
// Wire this to your monetization layer (sub.games, Play.fun, custom paywall)
// by replacing the body with real checks. See `/monetize-game` or `/subgames`.

export function isEntitled(key) {
  // TODO: wire to monetization layer.
  return false;
}
```

**3b. Add events to `src/core/EventBus.js`** (append-only, `domain:action` form).

**3c. Add state fields to `src/core/GameState.js`**. Update `reset()` to preserve persistent fields (e.g., `unlockedSkins`, `bonusModeUnlocked`) and clear transient ones (e.g., `usedContinue`, `continueOffered`).

**3d. Add constants to `src/core/Constants.js`** under a new `GATEABLES` section (skin list, continue cooldown, bonus mode config, etc.).

**3e. Create gateable modules** in the existing `src/` subdirectories matching the game's layout:

- `src/ui/SkinPicker.js` (Phaser scene or Three.js panel)
- `src/systems/ContinueFlow.js`
- `src/systems/BonusMode.js`
- etc.

Each gateable's entry point calls `isEntitled(key)` and branches:

```js
import { isEntitled } from '../systems/Entitlements.js';

function openSkinPicker() {
  if (!isEntitled('premium_skins')) {
    // Locked path: greyed-out button with lock icon, no picker opens.
    // Default skin remains selected. Game continues normally.
    return;
  }
  // Entitled path: open the picker scene.
  scene.scene.launch('SkinPickerScene');
}
```

**Never create a pre-gameplay title screen or skin-picker-first flow.** The template boots directly into gameplay. Gateable UI opens from pause menu, settings, or GameOverScene only.

**3f. Update `window.render_game_to_text()` in `src/main.js` additively** — add new observable fields (`selectedSkin`, `continueAvailable`, `bonusModeActive`) without removing existing ones. This is load-bearing for AI test harnesses.

### Step 4: Verify

- `npm run build` clean.
- `npm run dev` and play with `isEntitled` returning `false` (default). **Core loop must feel identical to pre-skill state.** If anything feels broken or missing, you gated the core loop — revert and revise.
- Temporarily edit `Entitlements.js` to `return true;` for all keys. Confirm each feature activates correctly. Revert.
- If `tests/` exists and snapshots `render_game_to_text()` via exact equality (`toEqual`), update baselines — field additions are intentional. If tests use `toMatchObject`, no update needed.
- Append a `## Gateables` section to `progress.md` at the project root with:
  - Features added (name + tier + entitlement key)
  - EventBus events added
  - GameState fields added (marked as persistent or transient)
  - Constants keys added
  - Locked-path description (one line per feature)

## Troubleshooting

### Feature works when entitled but the game breaks when locked
**Cause:** You gated part of the core loop, or the locked path is incomplete.
**Fix:** Revert. The locked path must produce normal-feeling gameplay. Test by running with `isEntitled` returning `false` — if anything is missing or broken, revise.

### Snapshot tests fail after `render_game_to_text` update
**Cause:** Tests use exact `toEqual` on output; you added new fields.
**Fix:** Regenerate baselines — the additions are intentional and backward-compatible for any consumer that tolerates extra keys.

### Skin picker blocks first play
**Cause:** Picker launches pre-gameplay.
**Fix:** Move entry point to a pause menu, settings screen, or GameOverScene. The template boots directly into gameplay and must continue to do so.

### `Entitlements.js` already exists
**Cause:** The skill has been run before, or a monetization layer is already wired.
**Fix:** Read the file. If it's a stub (`return false`), add new keys and continue. If it's wired to a real monetization layer, leave it alone and only add the new entitlement keys as new function branches.

### Proposal over-gates or feels punishing
**Cause:** You picked features that restrict the free experience.
**Fix:** Principle 2 (additive over subtractive). Free players should never feel punished by the absence of a gateable. If removing a gateable makes the game feel worse for a free player, it's gating the wrong thing.

## Output

Tell the user:

1. **What was added** — list each gateable (name, tier, entitlement key)
2. **The single wiring seam** — point at `src/systems/Entitlements.js` and explain: "Flip `isEntitled(key)` to return `true` for a key to activate that feature. Wire it to `/monetize-game` (Play.fun) or `/subgames` (subscription) next."
3. **How to test** — "Run `npm run dev` and play. Everything should feel normal (all gateables locked by default). Edit `Entitlements.js` to `return true;` temporarily to see features light up."
4. **Next step** — suggest `/monetize-game` or `/subgames` as appropriate.

## Example Usage

### Default proposal in the current game directory
```
/scaffold-gateables
```
Result: reads the game, proposes 2–3 gateables, implements them after confirmation. Creates `Entitlements.js`, new UI modules, new events and state. Game feels unchanged until the entitlement seam is flipped.

### Biased proposal with hints
```
/scaffold-gateables skins continue
```
Result: proposal biased toward a skin picker and a continue-after-death flow. Other suggestions still possible if they fit the game better.

### Explicit project path
```
/scaffold-gateables ./examples/flappy-bird
```
Result: operates on the given directory rather than the cwd.

## Tips

> Run this once per game. If you later want to add more gateables, use `/add-feature` for specific additions or run this skill again — it detects existing `Entitlements.js` and only appends new keys.
>
> Integration comes next: `/monetize-game` wires Play.fun points to gateables via `Entitlements.js`; `/subgames` (from the `subdotgames/skills` repo, separate install) wires subscription tiers. Either way, `Entitlements.js` is the only file that needs to change to turn gateables on.
