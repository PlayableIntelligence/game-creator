# Step 3 — Audio

## Files

### Created
- `src/audio/AudioManager.js` — Singleton wrapping a lazily-created `AudioContext`. Owns three GainNodes: `masterGain` (mute control, ramped via `setTargetAtTime`), `bgmGain` (-4 dB sub-bus for music), `sfxGain` (full-bus for SFX, also hosts the engine hum). Public API: `init()`, `playSfx(name, opts)`, `startBgm(name)`, `stopBgm()`, `setMuted(bool)`. Internal SFX/BGM registries decouple the manager from the actual sound recipes — `sfx.js` and `music.js` register themselves on import. Reads `gameState.isMuted` at init time so a page reloaded with mute on stays silent. Includes `import.meta.hot.dispose` to stop the BGM on HMR (no overlap stacking).
- `src/audio/sfx.js` — All SFX as pure `(ctx, dest, opts) => void` builder functions, registered with the manager on import. Six SFX: `bulletFire`, `ricochet`, `tankExplode`, `roundCountdownBeep`, `roundWinFanfare`, `roundDraw`. Shared noise-buffer cache keyed by duration to avoid recreating identical PCM on every shot.
- `src/audio/music.js` — Web Audio step sequencer. One BGM theme (`gameplay`) — 16-step bars, 120 BPM, four parallel layers (sawtooth bass with detuned partner, noise hi-hat, square lead with melody, sine kick). Look-ahead scheduler with 25 ms tick + 120 ms horizon, returns `{ stop() }` for clean cancellation. Anti-repetition is via varied bass/lead patterns within the same 16-step bar (loop length 4 sec, but the bass/lead asymmetry hides the repeat).
- `src/audio/AudioBridge.js` — Glue layer subscribing EventBus → AudioManager. Owns the engine hum (single shared sawtooth bed scaled by sqrt(thrust count) — see deviation 2). Exports `initAudioBridge()`.

### Modified
- `src/main.js` — Imports `initAudioBridge` from `./audio/AudioBridge.js` and calls it before `new Phaser.Game(...)`. Wiring is set up before any scene boots.
- `src/core/EventBus.js` — Added two new events: `TANK_THRUST_START` and `TANK_THRUST_END`. Justified below.
- `src/entities/Tank.js` — Added `_thrusting` boolean state. Tank emits `TANK_THRUST_START` / `TANK_THRUST_END` when `thrustForward || thrustBack` transitions. Also clears thrust state on `kill()` and when `input` is null (round transitions). No physics changes.
- `src/scenes/GameScene.js` — Added `_createMuteButton()` — a 28-design-px speaker icon with a circular dark backdrop in the top-right corner. Mouse click and `M` key both toggle mute (also fire `AUDIO_INIT` first so the icon works before any other input). Listens for first `keydown` *and* first `pointerdown` to fire `AUDIO_INIT` (was keyboard-only).
- `src/sprites/effects.js` — Added `SPEAKER_ON` and `SPEAKER_OFF` 16×16 pixel-art matrices. ON shows the speaker with 4 yellow sound-wave arcs; OFF shows the same speaker with an orange/red X.
- `src/sprites/registerSprites.js` — Registers `speaker_on` / `speaker_off` textures alongside the existing icon set.

## Audio elements vs brief

| Element | Trigger | Status | Recipe |
|---|---|---|---|
| Engine hum | tank thrust on/off | Done — **shared bed** (see deviation 2) | 3 oscillators (saw 90 Hz, saw 92 Hz detune, square 45 Hz) → lowpass 380 Hz → gain ramped to `0.10 * sqrt(activeCount) / 2` via `setTargetAtTime` (60 ms). Started once when first thrust event arrives, never stopped. |
| Bullet fire | TANK_FIRED | Done | Square 220→70 Hz over 60 ms (the "thunk") + bandpassed white noise burst (800–4500 Hz, 60 ms). Total 80 ms. |
| Ricochet | BULLET_RICOCHET | Done — pitch varies by bounce | Triangle ping (1.6× → 1× of base pitch; base = 820 Hz on bounce 1, 520 Hz on bounce 2) over 160 ms + ringing band-pass noise burst at base pitch (Q=18) for the metallic "tink". |
| Tank explode | TANK_DIED | Done | Square 300→40 Hz with sweeping lowpass (1800→400 Hz) over 450 ms + low-passed noise rumble (900→180 Hz) + brief high-pass "sizzle" burst (>2800 Hz, 180 ms). Total 550 ms. The most prominent SFX. |
| Countdown beep | ROUND_COUNTDOWN (per second) | Done | Sine 600 Hz, 90 ms, sharp envelope. |
| GO! beep | ROUND_STARTED | Done | Same SFX as countdown but pitched at 1200 Hz (passes through `roundCountdownBeep` with `{ pitchHz: 1200 }`). |
| Win fanfare | ROUND_ENDED with winner | Done | C-major ascending arpeggio: G3 → C4 → E4 → G4 → C5 (5 notes, 90 ms apart, 180 ms each). Each note is square + detuned triangle one octave below for body. Total ~620 ms. |
| Draw tone | ROUND_ENDED with null winner | Done | Sad sawtooth 400→200 Hz over 600 ms with sweeping lowpass (1600→700 Hz). |

BGM:
- **Gameplay theme** — 4-second loop at 120 BPM with bass + hat + lead + kick. Loops indefinitely until `MUSIC_STOP` (which `RoundSystem.endRound()` already emits). Reference vibe: clipped, military, tense, but not melodic enough to grate.
- **Victory sting** — Implemented as the `roundWinFanfare` SFX. The brief allows the same recipe; this avoids a separate scheduler instance.

## New events added

Two new events:
- `TANK_THRUST_START` — fired by Tank.update when `thrustForward || thrustBack` transitions from false → true. Payload `{ tankId, color }`.
- `TANK_THRUST_END` — fired on the inverse transition (and on tank death + `input === null`). Same payload.

**Justification**: The brief explicitly anticipates this — "emit `tank:thrust:start` and `tank:thrust:end` events from Tank when `thrustInput` transitions". Engine hum needs an event because thrust state lives inside `Tank.update()` and the audio layer should not poll Phaser entities every frame. Two events are cleaner than reinterpreting `TANK_FIRED` or per-frame inspection.

## Mute toggle UI

- **Position**: Top-right corner of GameScene (12-design-px margin from edge). Sized at 28 design pixels.
- **Visual**: Dark translucent circle backdrop (alpha 0.35, white stroke alpha 0.3) + a 16×16 pixel-art speaker icon. Two states: `speaker_on` (sound waves emitted) / `speaker_off` (orange-red X).
- **Interaction**:
  - Click on the backdrop circle → fires `AUDIO_INIT` (in case audio hasn't woken yet) + `AUDIO_TOGGLE_MUTE` + refreshes icon.
  - Window-level `keydown` listener for `m` / `M` → same behavior. Window-level (not scene keyboard) so it works even before Phaser keyboard plugin focus.
- **Persistence**: AudioManager.setMuted writes `'true'` or `'false'` to `localStorage['muted']`. GameState constructor reads this on boot. Verified across page reload.
- **Scene shutdown**: window-level keydown listener is removed in the SHUTDOWN handler so subsequent scene starts don't double-fire.

## Performance / lifecycle

- **Total active oscillators** in the worst case: 3 (engine bed, always on after first thrust) + ~6 (mid-explosion: 1 boom osc + 2 noise sources × bullet limit) + 4 (BGM kicks scheduled ~120 ms ahead, each 0.16 s, so usually 1–2 in flight) + ~5 (bullet fire / ricochet sounds in flight) = **~15-18 active sources**, well under the 20 budget. Oscillators are explicitly `stop(when)`-ed at the end of every recipe; the browser auto-disconnects them.
- **No per-frame allocation** in audio code. The shared engine bed is 3 oscillators created once on first thrust and never re-created. Noise buffers are cached by duration in `sfx.js`.
- **Mute switching uses `setTargetAtTime`** (20 ms time constant) rather than instant `gain.value = 0` to avoid the audible click on transition.
- **AudioContext is created lazily on first user input** (`keydown` or `pointerdown` in GameScene) — handles browser autoplay policy.
- **Wrapped in `try/catch`** at every public boundary. If `AudioContext` cannot be created (rare browser), `audioManager.isReady()` returns false and all `playSfx`/`startBgm` calls become no-ops — game still runs silently.
- **HMR-safe**: AudioManager has `import.meta.hot.dispose(() => audioManager.stopBgm())` so editing audio files doesn't stack scheduler timers. Verified across multiple Vite hot reloads during development.
- **Mute respect on stack**: `playSfx` early-returns when `isMuted` is true, so no nodes are created at all when muted (pure CPU savings, not just gain=0).

## Verification

Smoke-tested via headless Chromium + swiftshader against `http://localhost:3001/`:

1. **Boot**: AudioContext is null. After first `w` keypress: `ctx.state === 'running'`, `masterGain.gain.value === 0.7`, all 6 SFX + 1 BGM registered. ✓
2. **Round transitions**: `BgmGameplay` starts on `MUSIC_GAMEPLAY` (emitted by RoundSystem on countdown→playing). Stops on `MUSIC_STOP` (emitted on round end). ✓
3. **Mute via M key**: `gameState.isMuted` flips to `true`, `localStorage['muted'] === 'true'`, master gain ramps toward 0 (~0.0008 by the time we sampled, normal exponential approach). ✓
4. **Unmute**: gain restored, BGM auto-resumes if `roundState === 'playing'`. ✓
5. **Persistence**: localStorage set to `'true'`, reload → `gameState.isMuted === true` at boot, master gain pinned at 0 after first interaction. ✓
6. **Round end**: BGM cleared (`_currentBgm === null`), winner fanfare or draw tone fires. ✓
7. **Speaker icon visible** in top-right of canvas; ON state shows yellow sound waves, OFF state shows red-orange X. Both verified via cropped screenshots. ✓
8. **Zero console errors, zero page errors** across 4 separate Playwright runs. ✓

Audio waveforms themselves were not auditioned (headless Chromium has no speakers); recipes follow the brief's frequency tables and were sanity-checked by inspecting the ramped gain values + scheduled stop times in the AudioContext.

## Deviations

1. **No `engineHum` SFX in the registry** — engine hum is a *sustained* sound, not a one-shot, and lives entirely in AudioBridge.js (not sfx.js). The bridge owns the persistent oscillator bed and ramps gain on thrust events. Registering it as a `playSfx('engineHum')` SFX would require either (a) a one-shot envelope mismatch with the actual long-duration use, or (b) a stateful registry with start/stop semantics that the existing `playSfx` doesn't support. Keeping it in the bridge as the lifecycle owner is cleaner.
2. **Engine hum is a single shared bed, not per-tank** — see brief's "simpler fallback" option. Per-tank hum would mean 4 tanks × 3 oscillators = 12 always-on oscillators just for hum, plus pan management. Single bed scaled by `sqrt(activeThrustCount) / 2` gives a believable group-engine sound (one tank: 0.05 gain, four tanks: 0.10 gain) without 4× the CPU. The brief explicitly allowed this fallback. **Loose end**: hum doesn't pan with player position — all tanks contribute to a center-mixed bed.
3. **Mute click also fires `AUDIO_INIT`** — covers the edge case where the user clicks the mute button as their *first* interaction (before any keypress / canvas pointerdown wakes the context). Without this, clicking mute would persist `muted=true` to localStorage but the AudioContext would not exist yet to apply it, so the next keypress would create the context with `isMuted=true` and audio would already be off. Adding the init ensures consistency.
4. **Engine hum gain target uses `setTargetAtTime`, not exact `linearRampToValueAtTime`** — `setTargetAtTime` produces an exponential approach which is what ears expect for "engine spinning up". Linear ramps sound sterile.
5. **No master gain compressor** — small mix, only ~3-4 simultaneous sound categories at peak (BGM + hum + 1-2 SFX). A `DynamicsCompressorNode` is overkill; would just add latency. If gain spikes become a problem in future (e.g., 4 simultaneous explosions on round end) easy to add later.
6. **Win fanfare doubles as victory sting** — brief permits this ("could be the same thing"). Saves a music.js code path.
7. **No "menu" BGM** — game has no menu (boots directly into gameplay countdown per Step 1). `MUSIC_MENU` event is still in EventBus.js but unused; left there for future menu-screen feature work.

## Loose ends

- **Engine hum oscillators stay started forever after first thrust event.** They run silently (gain ≈ 0.0001) when no tank is thrusting. This is the cheapest possible setup — `OscillatorNode.stop()` is one-shot (you can't restart a stopped oscillator), so re-creating them on every thrust transition would mean thousands of oscillator allocations per round. Leaving them on at near-zero gain is the standard pattern. Total CPU: 3 sawtooths through a lowpass, negligible.
- **Mute icon doesn't reflect external state changes.** If something else (e.g., a future settings menu) sets `gameState.isMuted` directly, the icon won't refresh. The icon listens only to its own click + the `M` key, not to a "mute changed" event. Could be fixed by emitting a `mute:changed` event from `AudioManager.setMuted` and having the icon subscribe.
- **No de-dupe on overlapping ricochet SFX.** If 3 bullets hit walls in the same frame, 3 ricochet sounds layer on top — fine for impact, can briefly distort the master mix. Acceptable for the round budget.
- **BGM scheduler uses `setTimeout` for the 25 ms tick.** Browsers can throttle `setTimeout` in background tabs to 1 second. Symptom: BGM stutters when the user tabs away then returns. Standard tradeoff for Web Audio sequencers; only fix is `requestVideoFrameCallback`-based scheduling which is overkill here.
- **No volume slider.** Master volume is fixed at 0.7. Mute is binary. A future settings UI could expose a slider via `audioManager.masterGain.gain.value`.
- **Engine hum doesn't vary pitch with throttle level.** Holding `w` (forward thrust) and `s` (reverse) sound identical. Brief didn't require this; could be added by reading `Math.abs(tank.vx) + Math.abs(tank.vy)` per frame and modulating the bass oscillator frequencies.
- **The `MUSIC_MENU` and `MUSIC_GAMEOVER` events are wired in EventBus but have no audio handlers.** RoundSystem only emits `MUSIC_GAMEPLAY` and `MUSIC_STOP`. If a future menu/gameover scene is added, register the BGM and add bridge listeners.
- **`_sfxRegistry` and `_bgmRegistry` are exposed via `audioManager._sfxRegistry`** (underscore prefix only). The smoke test reads them for verification. Not part of the public API; safe to refactor later.
