# Audio system — not yet wired

This folder is a placeholder. The plus-template ships without a built-in
audio system; CLAUDE.md rule 5 lists `audio/` as a canonical directory,
so leaving it as a stub-with-pointer matches the documented architecture
without requiring every game built on this template to start with a Web
Audio scaffold they may not need.

## To add audio to a game built on this template

Run the `/add-audio` skill from this directory. It ports the
flappy-bird-flavored Web Audio system: `AudioManager.js` (master gain,
context init), `music.js` (procedural BGM via step sequencer), and
`sfx.js` (one-shot oscillators). It also wires the EventBus listeners
in `main.js` so events like `BIRD_FLAP` / `SCORE_CHANGED` trigger sounds
without coupling gameplay to audio.

The reference implementation lives at
`examples/flappy-bird/src/audio/` and the skill body is in
`skills/game-audio/SKILL.md`.
