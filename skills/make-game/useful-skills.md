# Useful Skills

A catalog of additional skills that pair well with `make-game`. The `make-game` pipeline itself is engine-agnostic, but most of the skills below assume a **JavaScript browser game** (Phaser 3 for 2D, Three.js for 3D) because that is what the rest of the `game-creator` plugin specializes in.

Use this document as a menu — install only the skills relevant to the project's tech stack and current phase. Re-check after big stack decisions land in `docs/tech.md`.

## How to Install

Use the `npx skills` command:

```
npx skills add opusgamelabs/game-creator --skill <skill-name> -p -y
```

## How to Choose

1. Read `docs/tech.md` to determine the engine, language, and platform.
2. Match the project to one of the **stack groups** below and install those skills.
3. Layer in **cross-cutting** skills based on the current phase or feature work (audio, design, QA, multiplayer, monetization, deployment, promo).
4. Reference skills (marked _reference_) are deep domain knowledge loaded by other skills — install them when you need the patterns directly, otherwise the user-invocable skill above will pull them in.

---

## Generic — Any Game Project

Skills that apply regardless of engine, renderer, or platform. Safe to install on any game project.

- **game-architecture** _(reference)_ — Architecture patterns (EventBus, GameState, Constants, orchestrator) and structural best practices. Useful when planning systems, writing ADRs, or laying down `docs/gameplan.md`.
- **review-game** — Read-only code review for architecture, performance, and best practices. Run after milestones land or before refactors.
- **improve-game** — Holistic audit + implements the highest-impact improvements. Run repeatedly during the development phase.
- **add-feature** — Add a new gameplay feature following the project's existing patterns. The default tool for milestone implementation.
- **fetch-tweet** — Utility: fetch tweet content from an X/Twitter URL (used when scaffolding from a tweet-described game idea).

---

## Stack: 2D Browser Games (Phaser / JS)

Install when `docs/tech.md` calls for Phaser or any 2D HTML5 canvas game.

- **phaser** _(reference)_ — Phaser 3 patterns: scenes, lifecycle, game objects, physics, UI, performance.
- **add-assets** — Replace geometric shapes with pixel art sprites (recognizable characters, enemies, items).
- **game-assets** _(reference)_ — Pixel art generation patterns, animation, spritesheets.

---

## Stack: 3D Browser Games (Three.js)

Install when `docs/tech.md` calls for Three.js or any WebGL 3D game.

- **threejs-game** _(reference)_ — Three.js event-driven modular architecture, scene setup, camera/controls patterns.
- **threejs-perf** _(reference)_ — Performance patterns: instancing for static + moving geometry, draw call reduction, scene traversal.
- **add-3d-assets** — Replace primitive `BoxGeometry`/`SphereGeometry` with real GLB models.
- **game-3d-assets** _(reference)_ — 3D asset pipeline: GLB download, AssetLoader, animated characters, clip maps.
- **meshyai** — Generate custom GLB models from text or images via Meshy AI; auto-rig and animate. Preferred source for custom 3D assets.
- **worldlabs** — Generate photorealistic 3D environments (Gaussian Splat scenes) from prompts or reference images. Requires `WLT_API_KEY`.

---

## Cross-Cutting: Audio

Browser-game audio via the Web Audio API (zero dependencies). Works with both Phaser and Three.js projects.

- **add-audio** — Add BGM and SFX using the Web Audio API.
- **game-audio** _(reference)_ — Procedural music patterns, step sequencer, SFX synthesis.

---

## Cross-Cutting: Visual Design & Polish

Engine-agnostic for browser games — focuses on UI, particles, gradients, transitions, "juice".

- **design-game** — Audit and improve visual polish, atmosphere, and UI of an existing game.
- **game-designer** _(reference)_ — Visual polish patterns (gradients, particles, screen transitions, juice/feel).

---

## Cross-Cutting: QA & Testing

Browser-game testing via Playwright. Applies to any game running in a browser.

- **qa-game** — Add Playwright tests: gameplay verification, visual regression, performance.
- **game-qa** _(reference)_ — Playwright patterns, fixtures, deterministic test setup, FPS measurement.

---

## Cross-Cutting: Multiplayer

- **add-multiplayer** — Add real-time or turn-based multiplayer via PartyKit (Cloudflare Durable Objects). Scaffolds a room-based server, NetworkManager client, and extends the EventBus / GameState / `render_game_to_text()` shape.

---

## Cross-Cutting: Deployment

- **game-deploy** — Deploy a built browser game to here.now (default), GitHub Pages, Vercel, etc.

---

## Cross-Cutting: Promo & Recording

- **record-promo** — Record an autonomous 50 FPS promo video for social media.
- **promo-video** _(reference)_ — Playwright + FFmpeg gameplay capture pipeline.

---

## Cross-Cutting: Monetization

Install once the gameplay loop is solid and the project is moving toward release.

- **scaffold-gateables** — Add monetization-agnostic gateable features (skin picker, continue-after-death, daily challenge, save slots) at silver/gold tiers with clean `isEntitled` hooks. Run before wiring a specific paywall.
- **monetize-game** — Register the game on Play.fun (OpenGameProtocol), add the browser SDK, get a monetized `play.fun` URL.
- **sub-games** — Integrate sub.games subscriptions for tier-gated features and recurring revenue.

---

## Quickstart Alternatives

These skills bypass parts of the `make-game` pipeline. Reach for them when the user wants speed over rigor.

- **viral-game** — One-shot end-to-end pipeline (~10 minutes): tweet/story/concept → scaffold → assets → design → promo video → audio → deploy to here.now → monetize on Play.fun. Trades milestone planning, ADRs, and multi-session iteration for time-to-deploy. Reach for it when the user wants a sharable, monetized game *now* and is fine with an opinionated stack (Phaser 3 / Three.js).
- **use-template** — Clone an existing game from the template gallery as a starting point. ~10-second copy vs full-pipeline scaffold.
- **quick-game** — Rapidly scaffold a playable game with no assets/design/audio/deploy/monetize. For prototypes only.
