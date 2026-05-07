# `<Game Name>`

> **Source:** `<prompt or tweet URL>`
> **Engine:** `<Phaser 3 | Three.js>`
> **Detected public figures:** `<comma-separated slugs, or "none">`
> **Monetization intent:** `<none | playfun | subgames | both>`

## Pitch

One or two sentences that capture the hook. What is this game, and why would someone want to play it for 30 seconds?

## Core gameplay loop

Named verbs only. Example: "tap to flap → dodge pipes → score on each pipe → die on collision → restart."

## Win / lose / progression

- How a session ends.
- What carries between sessions (high score, unlocks). For one-shot viral games this is usually just `bestScore`.

## Art style (one line)

`<pixel art | photo-composite caricatures (meme-pass) | low-poly Three.js | 3D Gaussian Splat>`. Mention the palette tag (`DARK` / `BRIGHT` / `RETRO`) for 2D.

## Stack (frozen for `/viral-game`)

- 2D engine: Phaser 3 (or Three.js for 3D)
- Bundler: Vite
- Hosting: here.now (default)
- Monetization: per `MONETIZATION_INTENT`
- Tests: Playwright

> Stack is opinionated and locked for `/viral-game`. If you want to change it, switch to `/make-game`.

## Open questions

Anything the concept phase couldn't answer from the prompt alone. If you need to ask the user, ask now — don't pile up questions for later phases.

---

*This is the slim, one-shot gameplan written by `/viral-game`. If this project outgrows the one-shot model and you want milestones, ADRs, or multi-session iteration, switch to `/make-game` — it can read this file as input and graduate the project.*
