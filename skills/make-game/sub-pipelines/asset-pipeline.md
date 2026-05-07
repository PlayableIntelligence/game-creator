# Asset pipeline

Conventions and flow for adding, organizing, and swapping game assets (art, audio, fonts, models, shaders, data).

## When to use

- Adding any new asset to the project
- The user wants to swap AI or placeholder assets for final art
- Asset folders are getting messy
- Setting up a new project (run during scaffold phase to establish conventions early)

## Inputs

- `docs/tech.md` — engine determines folder conventions
- `docs/gameplan.md` — art style determines what asset categories are expected
- The asset(s) being added or replaced

## Steps

1. **Use the engine's expected asset layout.** Unity uses `Assets/`, Unreal uses `Content/`, Godot uses `res://`, web/JS projects typically use `public/assets/` or `src/assets/`. Match what the engine expects — do not invent a layout.
2. **Use category subfolders.** Standard categories:
   - `art/{sprites,textures,models,vfx}`
   - `audio/{sfx,music,vo}`
   - `fonts/`
   - `shaders/`
   - `data/` (configs, JSON, balance tables)

   Create only what's needed. Don't pre-create empty category folders.
3. **Apply the project naming convention.** Default: `<category>_<subject>_<variant>.<ext>` — for example `sfx_jump_01.wav`, `sprite_player_idle.png`, `tex_grass_tileable.png`. Lowercase, snake_case, no spaces. If the project already has a different convention in use, follow that and note it in `docs/tech.md`.
4. **Tag placeholders unambiguously.** Any AI or temporary asset gets a `_placeholder` suffix or lives in `art/_placeholder/`. This makes the "swap to final" step trivially greppable later.
5. **Configure binary storage if needed.** For projects with binary assets >1MB or more than ~50 binary files: set up Git LFS and add the relevant patterns to `.gitattributes`. Do this once per project, early — retrofitting is painful.
6. **Capture import settings as code or data where possible.** Unity `.meta` files, Unreal asset properties, Godot `.import` files — commit them. Do not rely on agents or users reconfiguring import settings each time an asset is added.
7. **Update `docs/gameplan.md`** if a new asset category is being introduced (e.g. first time adding voice-over or shaders). This signals to future sessions that the category is expected.

## Outputs

- Asset(s) added in the correct folder with the correct name
- LFS configured if it wasn't already
- (Optional, on first run) `docs/assets.md` capturing conventions if the project doesn't already have them documented in `docs/tech.md`

## Exit criteria

- The asset is loadable in-engine without further setup
- A future agent can find the asset by following the naming convention without asking the user
- Placeholders are clearly distinguishable from final art
