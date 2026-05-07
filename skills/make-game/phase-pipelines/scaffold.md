# Scaffold phase

After the idea has been solidified, scaffold the project. The exact steps depend on the tech stack chosen in `docs/tech.md`.

## When to use

- Idea phase exit criteria are met (`docs/gameplan.md`, `docs/tech.md`, ADR-0001 exist)
- Project source files do not yet exist, or dependencies are not installed
- The user is ready to start building

## Inputs

- `docs/gameplan.md` (game definition)
- `docs/tech.md` (engine, language, libraries, tooling)
- `docs/architectural-decisions/0001-*.md` (locked engine/language/art-style)
- The current working directory

## Disambiguation: two kinds of "templates"

Two folders in this plugin both contain the word **templates**. They are different things — do not confuse them:

- **Project starters** at the **repo root** `templates/` (e.g. `templates/phaser-2d/`, `templates/threejs-3d/`). Runnable starter projects to clone or scaffold from. _This step uses these._
- **Doc skeletons** at `skills/make-game/templates/` (`gameplan.md`, `tech.md`, `milestone.md`, `adr.md`, `state.md`). Empty markdown shells the skill mandates. _Used in idea/development phases for writing docs._

When this pipeline says "starter," it means the first; when it says "doc skeleton," it means the second.

## Steps

**1. Re-read `docs/tech.md`**

Confirm the engine, language, and tooling. The scaffold method follows directly from this file.

**2. Prefer `/use-template` if a starter matches and `/use-template` is available**

If `templates/phaser-2d/` or `templates/threejs-3d/` (or any other starter in the repo root `templates/` folder) matches the project's stack, run `/use-template <starter-id> [project-name]`. This is a ~10-second copy + `npm install` and avoids latent setup bugs from improvised scaffolding.

Use `/use-template` when:

- Stack matches a starter (Phaser 4 / Three.js browser games)
- The project does not need a custom build pipeline

Skip to step 3 when:

- No starter matches the chosen engine (Unity, Unreal, Godot, custom stacks)
- The project requires a non-standard build setup

**3. If no starter matches, find the engine's official scaffolding tool**

Do **not** scaffold by hand. Hand-rolled `package.json`, `vite.config.js`, `tsconfig.json`, engine entry points, etc. drift from the framework's current expectations and cause version mismatches the moment a second library is added. The correct move is always to use the engine/framework's **official scaffolding command** (or its official editor flow).

Order of preference:

1. **The engine's official `create` / `init` / `-createProject` command.** Search the official docs (or ask the user for a link) for the _current_ recommended command — installation patterns shift between versions, so do not rely on embedded knowledge.
2. **The build tool's official scaffolder** when the engine is "just a library" loaded into a JS project (e.g. Three.js). Use `npm create vite@latest` (or the framework's recommended bundler init), then `npm install three` (or the relevant library) on top. Do not hand-write Vite/Webpack/Rollup config when an official template exists.
3. **Ask the user to run the editor/installer themselves** when the engine has a GUI-driven setup or requires a license/seat (Unity Hub, Unreal launcher, Godot editor's "New Project" dialog). Provide exact menu steps and the directory you want the project created in, then wait for them to confirm before continuing.

Examples of correct scaffolding commands (always re-check the official docs for the current syntax before running):

- **Phaser 4 (browser):** `npm create @phaserjs/game@latest` (also available via `npx @phaserjs/create-game@latest`, `yarn create @phaserjs/game`, `pnpm create @phaserjs/game@latest`, `bun create @phaserjs/game@latest`).
- **Three.js (browser, library on top of a bundler):** `npm create vite@latest` → pick the appropriate template (e.g. `vanilla`, `vanilla-ts`, `react`) → `cd <project>` → `npm install three`. Do not write `vite.config.js` from scratch unless a non-default plugin is required.
- **Unity (CLI project creation):**
  - Windows: `"C:\Program Files\Unity\Hub\Editor\<version>\Editor\Unity.exe" -createProject "C:\path\to\NewProject" -quit`
  - macOS: `/Applications/Unity/Hub/Editor/<version>/Unity.app/Contents/MacOS/Unity -createProject ~/path/to/NewProject -quit`
  - Linux: `~/Unity/Hub/Editor/<version>/Editor/Unity -createProject ~/path/to/NewProject -quit`
  - If the Unity version, Hub install path, or license is unknown, ask the user to create the project from Unity Hub's "New project" dialog instead.
- **Godot:** ask the user to create the project from the Godot editor's Project Manager. The CLI `godot --headless` workflow is fragile across versions; the editor flow is the supported path.
- **Unreal:** ask the user to create the project from Unreal Engine's Project Browser. Do not attempt CLI scaffolding.

**4. Scaffold the project**

- **Never roll your own configuration when an official scaffolder exists.** Hand-written configs are the #1 source of version-mismatch bugs (TypeScript ↔ bundler, engine ↔ runtime, plugin ↔ build tool). Run the official command and let it generate `package.json`, lockfile, build config, entry point, and `.gitignore`.
- Never write configuration files that the framework auto-generates — let the tool generate them, then commit them.
- For files you must write yourself, copy from the framework's _current_ official example before improvising.
- For GUI-editor scaffolds: produce step-by-step instructions and, if the project ends up in a different directory, give the user a follow-up prompt to start a new session there. **Do not proceed to step 5 until the user confirms scaffolding finished and you can `ls` the generated project files.**
- If you cannot find an official scaffolder _and_ the user cannot point you to one, stop and ask the user how they want to initialize the project rather than improvising a hand-rolled setup.

**5. Set up asset and binary conventions early**

Run the [asset-pipeline sub-pipeline](../sub-pipelines/asset-pipeline.md) once during scaffold. Establishing folder layout, naming, and Git LFS now is much cheaper than retrofitting later.

**6. Smoke test**

Boot the game in the browser (or the engine's play mode). Confirm:

- No build errors
- No console errors at startup
- The initial scene renders something — even a placeholder cube or empty scene with the camera live counts

If the smoke test fails, fix it before declaring scaffold done. A "compiles clean but crashes on boot" state is the most common scaffold-phase trap.

**7. Bootstrap `AGENTS.md` and `CLAUDE.md`**

Run the [agents-bootstrap sub-pipeline](../sub-pipelines/agents-bootstrap.md). This produces the project-root files that enforce `make-game` rules across every future session and every agent tool. Do not skip — it's the strongest cross-session enforcement mechanism in the skill, and it's much cheaper to write now than to retrofit later.

**8. Update `docs/STATE.md`**

Phase: `scaffold` → `development`. Set the next step to the first AC of milestone 01.

## Outputs

- Initial project files committed
- Dependencies installed
- Asset folder layout in place
- Boot smoke test passing
- `AGENTS.md` and `CLAUDE.md` at project root (filled, no placeholders)
- `docs/STATE.md` flipped to development phase

## Exit criteria

- Game boots in browser (or engine play mode); initial scene renders
- No console errors
- `AGENTS.md` exists at the project root and is filled in
- `CLAUDE.md` points to `AGENTS.md`
- A future agent can run the project with one well-known command (`npm run dev`, engine-specific equivalent) without further setup
