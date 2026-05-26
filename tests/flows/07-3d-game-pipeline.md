# Flow Test 07: Make a 3D Game with Three.js

## Objective
Test the full `/make-game` pipeline for a 3D game using Three.js.

## Test Prompt
"/make-game 3d space-explorer"

## Steps

### Phase 1: Scaffold
- [ ] Skill detects "3d" engine selection
- [ ] Copies `templates/threejs-3d/` to target directory
- [ ] Updates package.json name and index.html title
- [ ] Runs `npm install` successfully
- [ ] Dev server starts without errors

### Phase 2: Implementation
- [ ] Game uses Three.js with event-driven modular architecture
- [ ] EventBus singleton for cross-module communication
- [ ] GameState singleton with reset()
- [ ] Constants.js with all configuration values
- [ ] Game.js orchestrator manages lifecycle
- [ ] `render_game_to_text()` exposed on window
- [ ] `advanceTime(ms)` exposed on window
- [ ] Core loop: input, movement, scoring, fail condition, restart

### Phase 3: Assets (if Meshy API key available)
- [ ] Prompts for MESHY_API_KEY or offers library fallback
- [ ] Replaces BoxGeometry/SphereGeometry with real models
- [ ] Animated player character (idle/walk/run)
- [ ] Uses SkeletonUtils.clone() for animated models

### Phase 4: Design + Audio
- [ ] Visual polish applied (lighting, particles, effects)
- [ ] Web Audio API BGM and SFX added
- [ ] Audio activates on first user interaction

### Phase 5: Build + Deploy
- [ ] `npm run build` succeeds
- [ ] Deploys to here.now (or GitHub Pages)
- [ ] Live URL returned and game is playable

## Success Criteria
- [ ] All Phase 1-2 checkboxes pass (minimum viable)
- [ ] 0 build failures in final state
- [ ] <= 2 clarifying questions
- [ ] Game runs in browser with working 3D controls
- [ ] WASD movement + mouse camera control functional

## Anti-patterns
- Using `.clone(true)` instead of `SkeletonUtils.clone()` for animated models
- Hardcoded camera positions instead of OrbitControls
- Missing delta time capping (physics death spiral)
- Not disposing Three.js resources on cleanup
