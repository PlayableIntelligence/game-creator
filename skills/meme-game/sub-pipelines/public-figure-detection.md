# Public-Figure Detection

Detection logic for the `/meme-game` audit phase: when the user invokes `/meme-game <path>` without an explicit name list, scan the project's documentation to figure out which public figures (if any) the game already features, before asking the user.

## When to run

Only inside the [audit phase](../phases/audit.md), and only when `$ARGUMENTS` did not include explicit names. When the user *did* pass names (`/meme-game <path> trump,musk`), skip detection and trust the input.

## Inputs

- `docs/gameplan.md` (or legacy `design-brief.md`) — describes the game concept; usually the strongest signal.
- `docs/STATE.md` (or legacy `progress.md`) — may already record detected slugs from a prior session.
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

Pass both back into the audit phase. If `hasPublicFigures` is true, the resolve and wire phases proceed against `publicFigureSlugs`. If false, the audit phase falls through to a single `AskUserQuestion` asking the user which characters to feature.

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
