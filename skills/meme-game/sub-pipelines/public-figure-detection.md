# Public-Figure Detection (shared)

Single source of truth for detecting whether a game concept names a public figure or a public company. Both `/viral-game` (during its concept phase, for both Form A and Form B) and `/meme-game` (when called without an explicit name list) consume this. Keep the logic in this one file; both skills should reference it rather than duplicating.

## When to run

- `/viral-game` — once during concept parsing, before any code-writing step. Sets `hasPublicFigures` and `publicFigureSlugs` on the pipeline.
- `/meme-game` — only if the user invoked it without explicit names (`/meme-game <path>` with no name list). When the user *did* pass names, skip detection and trust the input.
- Autonomous `agents/game-creator.md` orchestrator — once during pipeline init.

## Inputs

- The user's prompt text (Form A in viral-game), OR the abstracted tweet concept + raw tweet text (Form B), OR the `progress.md` / `docs/gameplan.md` contents (meme-game when invoked on an existing project).
- Plugin root path so the manifest can be resolved.

## Detection tiers

Match against these three sources, in order. Stop accumulating slugs once the input is exhausted; do not infer beyond what is literally written.

### 1. Pre-built character slugs

Read `assets/characters/manifest.json` (relative to the plugin root). Match each manifest slug against the input. Match on:

- Exact slug (`trump`, `altman`, `musk`)
- Full canonical name (`Donald Trump`, `Sam Altman`, `Elon Musk`)
- Common short forms recorded in the manifest entry (e.g. `Sam`, `Elon`)

Add every match to the slug list.

### 2. Recognizable public figures by name

Beyond the manifest, accept explicit mentions of recognizable public figures in any of these categories:

- Politicians (heads of state, party leaders, sitting/former presidents)
- Tech CEOs and named founders (especially of public AI labs and major tech companies)
- World leaders (UN, IMF, etc.)
- Entertainers with global recognition (athletes, actors, musicians)

Add the slugified name to the slug list (`Donald Trump` → `trump`, `Sam Altman` → `altman`).

### 3. Public-company → CEO mapping

When a known company name appears, add the **CEO's slug** to the list (the company itself isn't a character — its CEO is the recognizable figure):

| Company | CEO slug |
|---|---|
| OpenAI | `altman` |
| Anthropic | `amodei` |
| xAI | `musk` |
| Meta / Facebook | `zuckerberg` |
| Microsoft | `nadella` |
| Google / Alphabet | `pichai` |
| NVIDIA | `huang` |

Unknown company → no mapping; skip silently. Do not invent CEOs for companies not in this table.

## Output

- `hasPublicFigures: boolean` — true if at least one slug was matched, false otherwise.
- `publicFigureSlugs: string[]` — deduplicated, in input order. May be empty.

Pass both into the rest of the pipeline (Step 1 conditional scaffolding hints, Step 1.6 hand-off, etc.).

## Hard rules

- **Do not over-detect.** A prompt like `maze-tank` (retro Atari maze game) must NOT match — no public figures, no companies, no auto-injection. Generic concepts stay generic. The most important regression case is the prompt that names no real people — it must come out of detection with `hasPublicFigures = false`.
- **Do not infer from topic.** "basketball" does not imply LeBron. "AI startup" does not imply Altman. Only match what is literally in the input.
- **Do not match fictional characters.** Mario, Master Chief, Pikachu, etc. are out of scope — they belong to `/add-assets` (pixel art), not this detection or `/meme-game`.
- **Ambiguous matches**: if a name *might* be a public figure but doesn't match a manifest slug or one of the categories above, surface the candidates to the user with `AskUserQuestion` rather than guessing. Don't burn Meshy credits or run WebSearch on a guess.

## Self-check before returning

- For prompts with no real names (`maze-tank`, `asteroid-dodge`, `pong`), the output is `hasPublicFigures = false` with an empty slug list.
- For prompts with one explicit name (`trump-runner`), the output has exactly one slug (`['trump']`).
- For prompts naming a company (`OpenAI dodger`), the output has the CEO's slug (`['altman']`), not a company slug.
- For prompts naming both a person and their company (`Sam Altman, OpenAI clicker`), the output deduplicates to a single `altman` entry.
