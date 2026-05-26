# Flow Test 04: Deploy Game to here.now

## Objective
Test the full deployment flow for a built game.

## Prerequisites
- A game built with `/make-game` or `/quick-game` (e.g., from flow 01)
- Game has a working `npm run build` producing `dist/`
- Internet access for here.now deployment

## Steps

### Phase 1: Build Verification
- [ ] Navigate to the game directory
- [ ] Run `/game-deploy` (or `/game-creator:game-deploy`)
- [ ] Skill detects the game engine and build tool
- [ ] `npm run build` produces `dist/` without errors

### Phase 2: Deployment
- [ ] Skill selects here.now as default deployment target
- [ ] Runs `npx here-now dist/` (or equivalent)
- [ ] Deployment completes without errors
- [ ] Returns a live URL

### Phase 3: Verification
- [ ] Live URL is accessible in a browser
- [ ] Game loads and is playable at the deployed URL
- [ ] No console errors on the deployed version

## Success Criteria
- [ ] All checkboxes pass
- [ ] 0 build failures
- [ ] <= 1 clarifying question (deployment target selection)
- [ ] Live URL returned and functional

## Anti-patterns
- Deploying without building first
- Deploying `src/` instead of `dist/`
- Not verifying the deployed URL works
