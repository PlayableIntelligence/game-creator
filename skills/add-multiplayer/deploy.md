# Deploy: PartyKit Server + Client

End-to-end walkthrough: local dev → first deploy → client redeploy. Covers Cloudflare login, URL capture, `.env` handling, and the most common deploy failures.

## Prerequisites

- Node.js 18+
- Cloudflare account (free tier — no credit card required for prototyping)
- The game's existing deploy mechanism configured (here.now / GitHub Pages / Vercel — same as the deploy detection used by `monetize-game`)

## Step 1: Local Development

Get the server running locally before deploying. PartyKit's dev mode is a local Cloudflare Workers emulator.

```bash
cd <game-path>/multiplayer-server
npm install
npx partykit dev
```

Output:

```
[partykit] Starting development server...
[partykit] Listening on http://127.0.0.1:1999
[partykit] Press Ctrl+C to stop
```

Leave this terminal running.

In a second terminal, point the client at the local server. Add to `<game-path>/.env`:

```
VITE_MULTIPLAYER_SERVER_URL=http://127.0.0.1:1999
```

(`partysocket` accepts `http://` and rewrites to `ws://` for the actual connection.)

Then start the client:

```bash
cd <game-path>
npm run dev
```

Open `http://localhost:3000` in two browser tabs. Both should fire `network:connected` (visible in the console) and see each other in `window.render_game_to_text().remotePlayers`.

If two tabs do not see each other locally, debug **before** deploying — the production deploy will not surface different bugs.

## Step 2: PartyKit Login

PartyKit was acquired by Cloudflare in 2024. As of 2026, the **default login provider (`clerk`) is broken** — it redirects through `https://dashboard.partykit.io/patience` ("under construction") and never completes. Use the **GitHub device-code flow** instead, which is reliable and independent of the deprecated dashboard:

```bash
cd <game-path>/multiplayer-server
npx partykit login --provider github
```

Output looks like:

```
We will now open your browser to https://github.com/login/device
Please paste the code XXXX-XXXX (copied to your clipboard) and authorize the app.
```

Open `https://github.com/login/device` (the CLI tries to auto-open; if that fails, navigate manually). Paste the code, authorize the app, and the CLI completes with:

```
Congratulations, you're all set!
Your device is now connected.
```

Credentials are saved to `~/.partykit/config.json`. Subsequent `npx partykit deploy` runs reuse them without prompting.

**Do not run `npx partykit login` without `--provider github`** — the default `clerk` flow will hang forever on the broken dashboard redirect.

## Step 3: First Deploy

```bash
npx partykit deploy
```

Successful output:

```
[partykit] Building...
[partykit] Uploading...
[partykit] Deployed to:
  https://<game-name>-multiplayer.<cf-username>.partykit.dev
```

Capture this URL — it's the value for `Constants.MULTIPLAYER.SERVER_URL` and `VITE_MULTIPLAYER_SERVER_URL`.

The `<game-name>` portion is whatever was set in `multiplayer-server/partykit.json`'s `name` field. The `<cf-username>` is the Cloudflare account's subdomain (visible in the dashboard sidebar).

## Step 4: Wire the Deployed URL Into the Client

Update three places:

**1. `src/core/Constants.js`:**

```diff
 MULTIPLAYER: {
-  SERVER_URL: 'https://<project>.<user>.partykit.dev',
+  SERVER_URL: 'https://<game-name>-multiplayer.<cf-username>.partykit.dev',
   ...
 },
```

**2. `<game-path>/.env`** (replace the localhost URL from Step 1):

```
VITE_MULTIPLAYER_SERVER_URL=https://<game-name>-multiplayer.<cf-username>.partykit.dev
```

**3. `<game-path>/.env.example`** (committed, with placeholder):

```
VITE_MULTIPLAYER_SERVER_URL=https://your-project.your-username.partykit.dev
```

Confirm `.env` is in `.gitignore` (the env-files rule requires this). If not, add it:

```bash
echo ".env" >> <game-path>/.gitignore
```

The `Constants.MULTIPLAYER.SERVER_URL` is the deployed default; `VITE_MULTIPLAYER_SERVER_URL` lets developers override locally. NetworkManager prefers the env var when present.

## Step 5: Rebuild and Redeploy the Client

```bash
cd <game-path>
npm run build
```

If the build fails, the most likely cause is a syntax error in `NetworkManager.js` or `MultiplayerClient.js`. Fix and rebuild before continuing.

Detect the existing host using the same logic as `monetize-game`:

**here.now (default):**

```bash
~/.agents/skills/here-now/scripts/publish.sh dist/
```

**GitHub Pages:**

```bash
npx gh-pages -d dist
```

**Vercel:**

```bash
vercel --prod
```

If the existing deploy mechanism is unclear, ask the user before proceeding.

## Step 6: Verify End-to-End

1. Open the deployed game URL in two browser tabs (or two devices).
2. Confirm `network:connected` fires on both.
3. Move the local entity in tab A and confirm tab B's remote-player rendering updates within `1000 / TICK_RATE_HZ * 2` ms (≈100ms at default 20Hz).
4. Close tab A and confirm tab B receives `network:player-left`.
5. Reopen tab A and confirm tab B receives `network:player-joined`.

## Step 7: Cost Awareness

Cloudflare Workers free tier (as of 2026):

- **100,000 requests / day** across all Workers in the account
- **1 GB Durable Object SQLite storage**
- **30 seconds of CPU / day**

Each multiplayer message is one Worker request. At a 20Hz tick, one always-on player generates ~1.7M requests/day — **above the free tier**. For prototyping with bursty play sessions (a few minutes at a time), free tier is comfortable. For production, upgrade to Workers Paid ($5/month flat) which raises the cap to 10M requests/day.

To stay under the free tier:

- Lower `TICK_RATE_HZ` in `Constants.js` (10Hz halves traffic; 5Hz quarters it).
- Add session timeouts so idle rooms hibernate (PartyKit does this automatically when `options.hibernate: true`).

The Cloudflare project is owned by the user, not OpusGameLabs. Costs accrue to their Cloudflare account.

## Re-deploys

Subsequent deploys are one command:

```bash
cd <game-path>/multiplayer-server && npx partykit deploy
```

The URL stays the same. No client rebuild required for server-only changes.

## Switching Modes (realtime ↔ turn-based)

The two server templates are interchangeable. To switch, replace `multiplayer-server/src/server.ts` with the other template (see `partykit-server.md`), update `NetworkManager` instantiation in `main.js` to the matching mode, then redeploy both server and client.

## Troubleshooting

### `partykit: command not found`

**Cause:** `npm install` was skipped or failed in `multiplayer-server/`.
**Fix:** `cd multiplayer-server && npm install`.

### `npx partykit login` redirects to `dashboard.partykit.io/patience` and hangs

**Cause:** The default `clerk` provider was retired after Cloudflare absorbed PartyKit. The dashboard the OAuth callback expects no longer exists.
**Fix:** Run `npx partykit login --provider github` instead — it uses GitHub's device-code OAuth flow and writes credentials to `~/.partykit/config.json` cleanly.

### `npm install` in `multiplayer-server/` reports security vulnerabilities

**Cause:** `partykit` pulls in older transitive deps (wrangler, esbuild). The vulnerabilities are flagged by npm audit but are not exploitable in the server template's usage.
**Fix:** Ignore the warning. **Do not run `npm audit fix --force`** — it'll attempt major-version bumps that break the partykit toolchain.

### `partykit dev` silently picks up the parent `.env`

**Cause:** PartyKit's dev server walks upward looking for `.env` files. Logs `Loading environment variables from ../.env` when it does.
**Effect:** Your client's `VITE_*` vars leak into the dev server's process env. Harmless for the standard template (server doesn't read them), but worth knowing if you ever store secrets in the client `.env`.
**Fix:** If isolation matters, put a separate `multiplayer-server/.env` and add `multiplayer-server/.env.local` to override.

### Deploy hangs at "Uploading..."

**Cause:** Slow network, or Cloudflare API is rate-limiting.
**Fix:** Cancel (Ctrl+C), wait 30s, retry. If persistent, check `https://www.cloudflarestatus.com/`.

### `Authentication failed` on deploy

**Cause:** Stale Wrangler credentials, or the session was logged out.
**Fix:** `npx wrangler logout && npx wrangler login`, then retry `npx partykit deploy`.

### Browser console: "WebSocket connection failed: SSL_PROTOCOL_ERROR"

**Cause:** Mixed content — the deployed game is HTTP but the server URL is HTTPS, or vice versa.
**Fix:** Confirm both are HTTPS. Use the full `https://` URL in `Constants.MULTIPLAYER.SERVER_URL`. `partysocket` derives `wss://` automatically.

### Browser console: "Failed to construct 'WebSocket': The URL ... is invalid"

**Cause:** `SERVER_URL` contains a placeholder like `<project>.<user>` that wasn't replaced after deploy.
**Fix:** Update `Constants.MULTIPLAYER.SERVER_URL` with the actual deployed URL.

### Two tabs connect but never see each other in production

**Cause:** They joined different rooms. URL-based room detection isn't wired by default; both tabs default to `'lobby'`.
**Fix:** Confirm both `window.render_game_to_text().multiplayer.roomId === 'lobby'`. If you wired room-from-URL parsing, ensure both tabs use the same query param.

### `Error: Could not deploy: project name conflicts`

**Cause:** `multiplayer-server/partykit.json` has a `name` that's already taken in the user's CF account.
**Fix:** Rename to `<game-name>-multiplayer-<random-suffix>` and retry.

### Deploy succeeds but the deployed Worker logs nothing in `wrangler tail`

**Cause:** The DO is hibernated and you haven't sent traffic yet.
**Fix:** Connect a client first; `wrangler tail` only shows live invocations.

### "Free tier exhausted" after a long testing session

**Cause:** Sustained 20Hz ticks from a 24h session.
**Fix:** Either upgrade to Workers Paid, lower `TICK_RATE_HZ`, or add a session timeout that disconnects idle clients.

### Local dev: `EADDRINUSE` on port 1999

**Cause:** A previous `partykit dev` is still running (or another tool is on 1999).
**Fix:** `lsof -i :1999` to find the PID, `kill <pid>`. Or pass `--port 2000` to `partykit dev` and update `VITE_MULTIPLAYER_SERVER_URL` to match.

### Server connects but never sends `welcome`

**Cause:** A server-side exception in `onConnect` is throwing silently.
**Fix:** `wrangler tail` (or PartyKit's dev console) shows the stack. Most common cause is a typo in the type imports — confirm `src/types.ts` matches what `server.ts` imports.

### Client reconnects in a tight loop

**Cause:** Server is rejecting all connections (e.g., `room-full` due to a stuck phantom peer that didn't get cleaned up).
**Fix:** Restart the DO: in the Cloudflare dashboard, navigate to the Worker, then "Durable Objects" → delete the room instance. Or call `partykit deploy` to redeploy (which evicts existing DO instances).
