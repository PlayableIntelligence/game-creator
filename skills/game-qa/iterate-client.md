# Iterate Client -- Quick Feedback Loop

The standalone iterate client (`scripts/iterate-client.js`) is designed for tight implement-then-test cycles during development. Use it after **every meaningful code change** to catch issues immediately, rather than waiting for the full browser test suite (`npm test`).

## When to Use

| Task | Tool |
|------|------|
| Verify a code change didn't break anything | **Iterate client** -- fast, captures state + errors |
| Full regression suite for CI/CD | **`npm run test`** -- comprehensive browser test suite |
| Subjective visual evaluation | **Visual inspection** (screenshots + Read, see `visual-inspection.md`) -- judgment of aesthetics |
| During subagent implementation steps | **Iterate client** -- run after each small change |

## Usage

```bash
# Basic: press space 3 times, capture screenshots each time
node scripts/iterate-client.js --url http://localhost:3000 \
  --actions-json '[{"buttons":["space"],"frames":4}]' \
  --iterations 3

# With action file
node scripts/iterate-client.js --url http://localhost:3000 \
  --actions-file scripts/example-actions.json --iterations 5

# Click a start button first, then perform actions
node scripts/iterate-client.js --url http://localhost:3000 \
  --click-selector "#play-btn" \
  --actions-json '[{"buttons":["right"],"frames":30},{"buttons":["space","right"],"frames":10}]'

# Debug: run headed (visible browser)
node scripts/iterate-client.js --url http://localhost:3000 \
  --actions-json '[{"buttons":["space"],"frames":4}]' \
  --headless false
```

## Action Format

```json
{
  "steps": [
    { "buttons": ["space"], "frames": 4 },
    { "buttons": [], "frames": 30 },
    { "buttons": ["right"], "frames": 30 },
    { "buttons": ["space", "right"], "frames": 10 },
    { "buttons": ["left_mouse_button"], "frames": 2, "mouse_x": 480, "mouse_y": 270 }
  ]
}
```

Supported buttons: `up`, `down`, `left`, `right`, `space`, `enter`, `escape`, `w`, `a`, `s`, `d`, `f`, `m`, `left_mouse_button`, `right_mouse_button`.

## Output

```
output/iterate/
├── shot-0.png          # Canvas screenshot after iteration 0
├── state-0.json        # render_game_to_text() output
├── shot-1.png
├── state-1.json
├── errors-0.json       # Console errors (only if errors occurred)
└── errors-boot.json    # Boot-time errors (only if errors occurred)
```

The client **breaks on the first new console error** -- fix it before continuing.

## Integration with AI Agents

The iterate client is the primary feedback mechanism for AI agents during game development:

1. Agent makes a code change
2. Agent runs iterate client with relevant actions
3. Agent reads screenshots (visually) and state JSON (structurally) to verify the change
4. If errors detected, agent reads the error JSON and fixes
5. Repeat until stable
