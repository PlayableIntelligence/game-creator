# Skill Trigger Test Suite

Manual test prompts to verify skills trigger correctly. Run each prompt against the plugin and verify the expected skill loads (or doesn't load).

## How to Use

1. Install the plugin: `npx skills add OpusGameLabs/game-creator`
2. For each test case, enter the prompt in your AI coding agent
3. Verify the correct skill loads (check the skill name in the agent's response)
4. Mark pass/fail

---

## make-game

(Multi-session game-dev workflow: idea → scaffold → development phases with milestones, ADRs, `docs/STATE.md`.)

**Should trigger:**
- "make a game"
- "build me a game"
- "create a new game"
- "make a 2D platformer"
- "build a 3D space shooter"
- "I want to make a flappy bird clone"
- "create a browser game from scratch"
- "let's plan out a game"
- "I want to design a game I'll work on for a while"

**Should NOT trigger:**
- "improve my existing game" → `improve-game`
- "add a new feature to my game" → `add-feature`
- "fix the bug in my game" → (no skill)
- "explain how games work" → (no skill)

---

## quick-game

**Should trigger:**
- "quick game"
- "fast game"
- "rapid prototype a game"
- "make a game quickly"
- "speed run a game build"

**Should NOT trigger:**
- "make a polished game" → `make-game`
- "build a production game" → `make-game`

---

## improve-game

**Should trigger:**
- "improve my game"
- "make my game better"
- "audit my game"
- "what should I fix in my game"
- "enhance the gameplay"

**Should NOT trigger:**
- "add a jetpack feature" → `add-feature`
- "make the background prettier" → `design-game`
- "add music to my game" → `add-audio`
- "review my game code" → `review-game`

---

## add-feature

**Should trigger:**
- "add a jetpack feature"
- "add double jump"
- "I want to add a power-up system"
- "add multiplayer"
- "add a new weapon"

**Should NOT trigger:**
- "add background music" → `add-audio`
- "add pixel art sprites" → `add-assets`
- "add 3D models" → `add-3d-assets`
- "improve the whole game" → `improve-game`

---

## add-assets

**Should trigger:**
- "add pixel art to my game"
- "replace shapes with sprites"
- "add character art"
- "make the player look like a real character"
- "add enemy sprites"

**Should NOT trigger:**
- "add 3D models" → `add-3d-assets`
- "add a jetpack feature" → `add-feature`
- "make the background prettier" → `design-game`

---

## add-3d-assets

**Should trigger:**
- "add 3D models to my game"
- "replace cubes with real models"
- "add a character model"
- "find a 3D model of a tree"

**Should NOT trigger:**
- "add pixel art" → `add-assets`
- "generate a 3D model with Meshy" → `meshyai`
- "create a 3D environment" → `worldlabs`

---

## add-audio

**Should trigger:**
- "add music to my game"
- "add sound effects"
- "add audio"
- "I want background music"
- "add a jump sound"

**Should NOT trigger:**
- "explain how Web Audio API works" → (no skill)
- "add a feature" → `add-feature`

---

## design-game

**Should trigger:**
- "make my game look better"
- "add visual polish"
- "add particles"
- "improve the UI"
- "add screen transitions"
- "make it juicy"

**Should NOT trigger:**
- "improve gameplay mechanics" → `improve-game`
- "add pixel art sprites" → `add-assets`

---

## monetize-game

**Should trigger:**
- "monetize my game"
- "add Play.fun to my game"
- "register on play.fun"
- "add the play.fun SDK"
- "launch a playcoin"

**Should NOT trigger:**
- "deploy my game" → (use `/monetize-game` which includes deploy, or direct deploy)
- "explain what play.fun is" → (no skill)

---

## qa-game

**Should trigger:**
- "add tests to my game"
- "write Playwright tests"
- "add QA tests"
- "test my game"

**Should NOT trigger:**
- "review my game code" → `review-game`
- "run the existing tests" → (no skill, just `npm run test`)

---

## review-game

**Should trigger:**
- "review my game code"
- "code review"
- "check my architecture"
- "audit the codebase"

**Should NOT trigger:**
- "fix the bugs" → (no skill)
- "improve my game" → `improve-game` (also implements fixes)
- "add tests" → `qa-game`

---

## record-promo

**Should trigger:**
- "record a promo video"
- "capture gameplay footage"
- "make a marketing video"
- "record my game"

**Should NOT trigger:**
- "take a screenshot" → (no skill)
- "add a video player to my game" → `add-feature`

---

## use-template

**Should trigger:**
- "use the flappy bird template"
- "clone a template"
- "start from a template"
- "use template tower-defense"

**Should NOT trigger:**
- "make a game from scratch" → `make-game`
- "show me the gallery" → (no skill)

---

## meshyai

**Should trigger:**
- "generate a 3D model"
- "use Meshy to create a character"
- "create a 3D model of a dragon"
- "generate a GLB model"

**Should NOT trigger:**
- "find a 3D model online" → `game-3d-assets`
- "create a 3D environment" → `worldlabs`
- "add 3D models to my game" → `add-3d-assets`

---

## worldlabs

**Should trigger:**
- "generate a 3D world"
- "create an environment"
- "make a 3D scene"
- "use World Labs"

**Should NOT trigger:**
- "generate a 3D character model" → `meshyai`
- "add 3D models to my game" → `add-3d-assets`

---

## fetch-tweet

**Should trigger:**
- "fetch this tweet from https://x.com/..."
- "fetch this tweet: https://x.com/user/status/123"

**Should NOT trigger:**
- "post a tweet" → (no skill)
- "search Twitter" → (no skill)

---

## Negative Tests (No Skill Should Trigger)

These prompts should NOT trigger any game-creator skill:

- "What is the capital of France?"
- "Write a Python script to sort a list"
- "Explain quantum computing"
- "Help me with my React app"
- "Design a database schema"
- "Write a poem about games" (mentions "games" but not a game creation task)
- "What's the best game engine?" (informational, not actionable)
- "Run my existing tests" (use `npm run test`, not a skill)
