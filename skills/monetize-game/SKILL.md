---
name: monetize-game
description: Register your game on Play.fun (OpenGameProtocol), add the browser SDK, and get a monetized play.fun URL. Use when the user says "monetize my game", "add Play.fun", "add rewards", "register on Play.fun", or "get a play.fun URL". Requires Play.fun MCP server for game registration.
argument-hint: "[game-path]"
license: MIT
metadata:
  author: OpusGameLabs
  version: 1.3.0
  mcp-server: play-fun
  tags: [game, monetize, playfun, rewards, sdk]
compatibility: Requires Play.fun MCP server (play-fun), Node.js, and internet access for auth and deployment.
---

# Monetize Game (Play.fun / OpenGameProtocol)

Register your game on [Play.fun](https://play.fun) (OpenGameProtocol), integrate the browser SDK for points tracking and leaderboards, and get a shareable play.fun URL. This is the link you post to Moltbook.

**What you'll get:**
1. Your game registered on Play.fun with anti-cheat config
2. The Play.fun browser SDK integrated into your game (points widget, leaderboard, wallet connect)
3. A rebuilt + redeployed game with the SDK active
4. A play.fun game URL to share on Moltbook and social media

## Prerequisites

- A deployed game with a public URL (run `/game-creator:viral-game` first for a one-shot deploy, or ensure your game is deployed to here.now / GitHub Pages / Vercel / etc.)
- Node.js installed

## Instructions

### Step 0: Locate the game

Parse `$ARGUMENTS` to find the game project directory. If not provided, check the current working directory for a `package.json` with Phaser or Three.js dependencies.

Read `package.json` to confirm this is a game project. Read `vite.config.js` or similar to determine the deployed URL (look for `base` path).

### Step 1: Authenticate with Play.fun

Check if the user already has Play.fun credentials:

```bash
node skills/playdotfun/scripts/playfun-auth.js status
```

**If credentials exist and are valid**, skip to Step 2.

**If no credentials**, walk the user through authentication:

> To register your game on Play.fun, you need to authenticate first.
>
> I'll start a local auth server. Click the link below to log in:

```bash
node skills/playdotfun/scripts/playfun-auth.js callback &
```

Then tell the user:

> Open this URL in your browser:
> **https://app.play.fun/skills-auth?callback=http://localhost:9876/callback**
>
> Log in with your Play.fun account. The credentials will be saved automatically.
> Tell me when you're done.

**Wait for user confirmation.** Then verify:

```bash
node skills/playdotfun/scripts/playfun-auth.js status
```

If verification fails, offer the manual method as a fallback:

> If the callback didn't work, you can paste your credentials manually.
> Go to your Play.fun dashboard, copy your API credentials (base64 format), and I'll save them:
> ```
> node skills/playdotfun/scripts/playfun-auth.js manual <your-base64-credentials>
> ```

### Step 2: Determine the game URL

Find the deployed game URL. Check in this order:

1. Check for a here.now deploy state file:
   ```bash
   cat .herenow/state.json 2>/dev/null | jq -r '.publishes | to_entries[0].value.siteUrl // empty'
   ```
   If found, the URL is the `siteUrl` value (e.g., `https://<slug>.here.now/`)

2. Look for a GitHub Pages URL by running:
   ```bash
   GITHUB_USER=$(gh api user --jq '.login' 2>/dev/null)
   REPO_NAME=$(basename $(git remote get-url origin 2>/dev/null) .git 2>/dev/null)
   ```
   If both resolve, the URL is `https://$GITHUB_USER.github.io/$REPO_NAME/`

3. Check `vite.config.js` for a `base` path that hints at the deployment URL

4. Ask the user for their game URL if it can't be determined

Verify the URL is accessible:

```bash
curl -s -o /dev/null -w "%{http_code}" "$GAME_URL"
```

### Step 3: Register the game on Play.fun

Read the game's `package.json` for the name and description. Read `src/core/Constants.js` (or equivalent) to determine reasonable anti-cheat limits based on the scoring system.

Use the Play.fun MCP `register_game` tool if available. Otherwise, use the API directly:

Load the `playdotfun` skill for API reference. Register the game via `POST https://api.play.fun/games` with:

```json
{
  "name": "<game-name>",
  "description": "<game-description>",
  "gameUrl": "<deployed-url>",
  "platform": "web",
  "isHTMLGame": true,
  "iframable": true,
  "maxScorePerSession": <based on game scoring>,
  "maxSessionsPerDay": 50,
  "maxCumulativePointsPerDay": <reasonable daily cap>
}
```

**Anti-cheat guidelines** (from the playdotfun skill):
- Casual clicker/idle: `maxScorePerSession: 100-500`
- Skill-based arcade (flappy bird, runners): `maxScorePerSession: 500-2000`
- Competitive/complex: `maxScorePerSession: 1000-5000`

Save the returned **game UUID** — you'll need it for the SDK integration.

**Tell the user:**
> Your game is registered on Play.fun!
> **Game ID**: `<uuid>`
> **Name**: `<name>`

### Step 4: Add the Play.fun Browser SDK

Integrate the SDK into the game. This is a lightweight addition — the SDK loads from CDN and provides a points widget overlay.

#### 4a. Add the SDK script and meta tag to `index.html`

Retrieve the user's Play.fun **public API key** from stored credentials:

```bash
node skills/playdotfun/scripts/playfun-auth.js get-key
```

The script prints only the public API key to stdout. If no key is found, prompt the user to authenticate first (Step 1).

> **Security note**: The `x-ogp-key` is a **public client identifier** — analogous to a Stripe publishable key or Firebase API key. It is designed to be embedded in client-side HTML and does not grant write access, authentication, or any privileged operations. The secret key (used for server-side API calls) is never embedded in game files.

Then add before the closing `</head>` tag:

```html
<meta name="x-ogp-key" content="<PUBLIC_API_KEY>" />
<script src="https://sdk.play.fun/latest"></script>
```

**Important**: The `x-ogp-key` meta tag must contain the **user's Play.fun public API key** (not the game ID or secret key). Do NOT leave the placeholder — always substitute the actual key from `playfun-auth.js get-key`.

#### 4b. Create `src/playfun.js` integration module

Create a module that wires the Play.fun SDK into the game's EventBus:

```js
// src/playfun.js
// Play.fun (OpenGameProtocol) integration
// Wires game events to Play.fun points tracking

import { eventBus, Events } from './core/EventBus.js';

const GAME_ID = '<game-uuid>';

let sdk = null;
let initialized = false;

export async function initPlayFun() {
  if (typeof OpenGameSDK === 'undefined' && typeof PlayFunSDK === 'undefined') {
    console.warn('Play.fun SDK not loaded — skipping monetization');
    return;
  }

  const SDKClass = typeof PlayFunSDK !== 'undefined' ? PlayFunSDK : OpenGameSDK;
  sdk = new SDKClass({
    gameId: GAME_ID,
    ui: { usePointsWidget: true },
  });

  await sdk.init();
  initialized = true;
  console.log('Play.fun SDK initialized');

  wireEvents();
}

function wireEvents() {
  // addPoints() — call frequently during gameplay to buffer points locally (non-blocking)
  if (Events.SCORE_CHANGED) {
    eventBus.on(Events.SCORE_CHANGED, ({ score, delta }) => {
      if (sdk && initialized && delta > 0) {
        sdk.addPoints(delta);
      }
    });
  }

  // savePoints() — ONLY call at natural break points (game over, level complete)
  // WARNING: savePoints() opens a BLOCKING MODAL — never call during active gameplay!
  if (Events.GAME_OVER) {
    eventBus.on(Events.GAME_OVER, () => {
      if (sdk && initialized) {
        sdk.savePoints(); // Uses buffered points from addPoints() calls
      }
    });
  }

  // Save on page unload (browser handles this gracefully)
  window.addEventListener('beforeunload', () => {
    if (sdk && initialized) {
      sdk.savePoints();
    }
  });
}
```

**Critical SDK behavior:**

| Method | When to use | Behavior |
|--------|-------------|----------|
| `addPoints(n)` | During gameplay | Buffers points locally, non-blocking |
| `savePoints()` | Game over / level end | **Opens blocking modal**, syncs buffered points to server |

⚠️ **Do NOT call `savePoints()` on a timer or during active gameplay** — it interrupts the player with a modal dialog. Only call at natural pause points (game over, level transitions, menu screens).

**Important**: Read the actual `EventBus.js` to find the correct event names. Common patterns:
- `SCORE_CHANGED` / `score:changed` with `{ score, delta }` or `{ score }`
- `GAME_OVER` / `game:over`

Adapt the event names and payload destructuring to match what the game actually emits. If the game doesn't emit a delta, compute it by tracking the previous score.

#### 4c. Wire into main.js

Add the Play.fun init call to the game's entry point (`src/main.js`):

```js
import { initPlayFun } from './playfun.js';

// After game initialization
initPlayFun().catch(err => console.warn('Play.fun init failed:', err));
```

The `initPlayFun()` call should be non-blocking — if the SDK fails to load (e.g., ad blocker), the game still works.

#### 4d. Safe area insets

The Play.fun SDK automatically sets CSS custom properties on the game iframe's `document.documentElement` when running inside the dashboard:

- `--ogp-safe-top-inset` — space below the Play.fun header bubbles (~68px on mobile)
- `--ogp-safe-bottom-inset` — space above Safari bottom controls (~148px on mobile)

Both default to `0px` when not in the dashboard. The game templates already read these values in `Constants.js` (via `SAFE_ZONE.TOP` / `SAFE_ZONE.BOTTOM` for Phaser, or CSS `var()` for Three.js HTML overlays).

**Verify** that all UI elements (score, buttons, touch controls) are positioned within the safe area — not clipped behind the Play.fun header or Safari bottom bar. If the game has custom HUD positioning, update it to reference `SAFE_ZONE` constants or the CSS variables.

### Step 5: Rebuild and redeploy

```bash
cd <project-dir> && npm run build
```

If the build fails, fix the integration code and retry.

Then redeploy. Use `npm run deploy` if available, otherwise detect the platform:

**here.now (default):**
```bash
~/.agents/skills/here-now/scripts/publish.sh dist/
```

**GitHub Pages (if project uses it):**
```bash
npx gh-pages -d dist
```

### Step 6: Confirm and share

Verify the deployment is live (here.now deploys are instant; GitHub Pages may take 1-2 minutes):

```bash
curl -s -o /dev/null -w "%{http_code}" "$GAME_URL"
```

**Tell the user:**

> Your game is monetized on Play.fun!
>
> **Play your game**: `<game-url>`
> **View on Play.fun**: `https://play.fun/games/<game-uuid>`
>
> **What's live:**
> - Points widget overlay (bottom-right corner)
> - Leaderboard tracking
> - Wallet connect for claiming rewards
> - Points buffered during gameplay, saved on game over
>
> **Share on Moltbook**: Post your game URL to [moltbook.com](https://www.moltbook.com/) — 770K+ agents on the agent internet ready to play and upvote.
>
> **Next steps:**
> - Launch a playcoin for your game (token rewards for players)
> - Check your leaderboard on Play.fun
> - Share the play.fun URL on social media

## Example Usage

```
/monetize-game examples/flappy-bird
```
Result: Auth with Play.fun → registers game with anti-cheat limits (maxScorePerSession: 1000) → adds SDK to index.html + creates `src/playfun.js` → wires score events to `addPoints()`, game-over to `savePoints()` → rebuilds → redeploys → live at `https://play.fun/games/<uuid>`. Points widget visible in-game.

## Troubleshooting

### Auth callback blocked by browser
**Cause:** Pop-up blockers or strict CORS policies prevent the localhost:9876 OAuth callback from completing.
**Fix:** Try the manual paste flow instead — run the auth script with `--manual` flag, copy the token from the dashboard at https://play.fun/dashboard, and paste it when prompted.

### Game registration returns 4xx error
**Cause:** Missing required fields (name, description, or URL) or the game URL is not publicly accessible.
**Fix:** Ensure the game is deployed and accessible at the provided URL before registering. Check that all required fields are filled in. If using here.now, verify the deployment hasn't expired.

### SDK not loading (ad blockers)
**Cause:** Browser ad blockers and privacy extensions block the Play.fun SDK CDN (`sdk.play.fun`).
**Fix:** The SDK integration should be non-blocking — if it fails to load, the game still works. Add a try/catch around SDK initialization and log a warning. Test with ad blockers disabled to verify SDK functionality.

### savePoints modal appears during gameplay
**Cause:** The SDK's point-saving UI overlay triggers at unexpected times, interrupting the player.
**Fix:** Only call `savePoints()` during natural game pauses (game over screen, level complete). Never call it during active gameplay. Use the `silent: true` option if available to suppress the modal.

### API key not found
**Cause:** Credentials not configured or expired since last session.
**Fix:** Visit https://play.fun/dashboard to refresh creator credentials. Re-run the auth flow with `playfun-auth.js` or manually update the `.env` file with fresh `PLAYFUN_API_KEY` and `PLAYFUN_SECRET_KEY` values.

## Security Notes

- **Public API key in HTML**: The `x-ogp-key` meta tag contains a public client identifier, not a secret. It is equivalent to a Stripe publishable key or Firebase web API key — designed for client-side use, safe to deploy publicly. It cannot be used to modify game data, access user accounts, or perform privileged operations.
- **Secret key handling**: The Play.fun secret key (used for server-side API registration) is only used during the `register_game` API call and is never written to game source files or deployed artifacts.
- **Credential storage**: Credentials are managed by `playfun-auth.js` in a local credential store. The agent never reads internal agent configuration files (e.g., `~/.claude.json`).
- **Financial operations**: All wallet-connect and reward-claiming operations are initiated by the end player through the Play.fun SDK UI. The game developer's code does not handle funds, private keys, or wallet operations — the SDK mediates all financial interactions client-side.
- **Deployment**: Only the public API key and game ID are present in deployed files. No secrets are included in build artifacts.
