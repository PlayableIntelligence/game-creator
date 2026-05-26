---
name: add-audio
description: Add music and sound effects to a game using the Web Audio API — background music, gameplay themes, and SFX. Zero dependencies. Use when the user says "add music", "add sound effects", "add audio", "make it sound good", "add BGM", or "add SFX to my game". Do NOT use for gameplay features or visual design.
argument-hint: "[path-to-game]"
license: MIT
metadata:
  author: OpusGameLabs
  version: 1.3.0
  tags: [game, audio, music, sfx, web-audio-api]
---

## Performance Notes

- Take your time to do this thoroughly
- Quality is more important than speed
- Do not skip validation steps

# Add Audio

Add procedural music and sound effects to an existing game. BGM uses a Web Audio API step sequencer for looping patterns. SFX use the Web Audio API directly for true one-shot playback. No audio files or npm packages needed — everything is synthesized in the browser.

## Instructions

Analyze the game at `$ARGUMENTS` (or the current directory if no path given).

First, load the game-audio skill to get the full Web Audio patterns and integration guide.

### Step 1: Audit

- Read `src/core/EventBus.js` to see what game events exist (flap, score, death, etc.)
- Read all scene files to understand the game flow (gameplay, game over)
- Identify what music and SFX would fit the game's genre and mood

### Step 2: Plan

Present a table of planned audio:

| Event / Scene | Audio Type | Style | Description |
|---------------|-----------|-------|-------------|
| GameScene | BGM | Chiptune | Upbeat square wave melody + bass + drums |
| GameOverScene | BGM | Somber | Slow descending melody |
| Player action | SFX | Retro | Quick pitch sweep |
| Score | SFX | Retro | Two-tone ding |
| Death | SFX | Retro | Descending crushed notes |

Explain in plain English: "Background music will automatically loop during each scene. Sound effects will play when you do things like jump, score, or die. The first time you click/tap, the audio system will activate (browsers require a user interaction before playing sound)."

### Step 3: Implement

1. Create `src/audio/AudioManager.js` — AudioContext init, master gain node, BGM sequencer play/stop
2. Create `src/audio/AudioBridge.js` — wires EventBus events to AudioManager for BGM, calls SFX functions directly
3. Create `src/audio/music.js` with BGM patterns for each scene (Web Audio step sequencer — note arrays that loop continuously)
4. Create `src/audio/sfx.js` with SFX for each event (Web Audio API — OscillatorNode + GainNode + BiquadFilterNode for true one-shot playback)
5. Add audio events to `EventBus.js` if not present (`AUDIO_INIT`, `MUSIC_GAMEPLAY`, `MUSIC_GAMEOVER`, `MUSIC_STOP`, `AUDIO_TOGGLE_MUTE`)
6. Wire `initAudioBridge()` in `main.js`
7. Emit `AUDIO_INIT` on first user interaction (game starts immediately, no menu)
8. Emit music events at scene transitions and SFX events at game actions
9. Add mute toggle — `AUDIO_TOGGLE_MUTE` event, UI button, M key shortcut

### Step 4: Verify

- Run `npm run build` to confirm no errors
- List all files created/modified
- Remind the user: "Click/tap once to activate audio, then you'll hear the music"

## Example Usage

### Full audio pass
```
/add-audio examples/flappy-bird
```
Result: Creates `src/audio/AudioManager.js`, `music.js` (gameplay + game-over BGM patterns), `sfx.js` (flap, score, death, button SFX) → wires via AudioBridge → mute toggle on M key. First click activates audio.

## Troubleshooting

### No sound plays
**Cause:** AudioContext not resumed after user interaction (browser autoplay policy).
**Fix:** Ensure AudioContext.resume() is called on first user input (click/tap/keydown). Check for AUDIO_INIT event wiring.

### Audio causes lag spikes
**Cause:** Creating new OscillatorNodes every frame.
**Fix:** SFX should be one-shot (create, connect, start, stop). BGM uses a single looping sequencer. Never create nodes in update().

## Next Step

Tell the user:

> Your game now has music and sound effects! Next, run `/game-creator:qa-game` to add automated tests that verify your game boots correctly, scenes transition properly, scoring works, and visuals haven't broken.
>
> **Pipeline progress:** ~~/make-game~~ → ~~/design-game~~ → ~~/add-audio~~ → `/qa-game` → `/review-game`
