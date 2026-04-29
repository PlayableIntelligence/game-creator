# Plus Proxy Protocol

Wire format for clients (CLI scripts, future SDKs) talking to `plus.gamecreator.dev`.

This file is the source of truth for the proxy contract. The backend (in a private repo, hosted at `gamecreator.dev`) implements it; the client scripts (`scripts/plus-*.mjs`) consume it. If they disagree, this file wins.

## Base URL

- Production: `https://plus.gamecreator.dev`
- Staging: `https://plus-staging.gamecreator.dev`
- Local dev: `http://localhost:8787`

Override with `GCPLUS_PROXY` env var. Default in clients: production.

## Authentication

All authenticated endpoints take `Authorization: Bearer <token>`.

Tokens are issued by `POST /v1/signup`, stored client-side at `~/.gcplus/token` (or `$GCPLUS_TOKEN` env var if set — env wins).

Token format: `gcplus_live_<32 hex chars>` (production) or `gcplus_test_<32 hex chars>` (staging).

## Endpoints

### `POST /v1/signup`

Public. Creates a new user, returns bearer token.

```http
POST /v1/signup HTTP/1.1
Content-Type: application/json

{
  "email": "user@example.com",
  "promo_code": "OPENGAMEPROTOCOL"   // optional, may grant free credits
}
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "token": "gcplus_live_abc...",
  "user_id": "u_xyz",
  "balance_credits": 500,
  "welcome_url": "https://plus.gamecreator.dev/welcome?token=<one-time-magic>",
  "first_topup_url": "https://plus.gamecreator.dev/topup?session=<id>"
}
```

Errors:
- `409 Conflict` if email already registered (suggest `/v1/login` instead)
- `429 Too Many Requests` rate-limited (10 signups/IP/hour)

### `POST /v1/login`

Public. Existing user requesting a new bearer token (e.g., lost their token, switching machines). Sends a magic link to email.

```http
POST /v1/login
Content-Type: application/json

{ "email": "user@example.com" }
```

```http
HTTP/1.1 200 OK
{ "magic_url_sent": true }
```

The user opens the email, clicks the link, receives a fresh token via the welcome page.

### `GET /v1/balance`

Authenticated. Returns balance + recent ledger entries.

```http
GET /v1/balance HTTP/1.1
Authorization: Bearer gcplus_live_...
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "balance_credits": 1840,
  "balance_usd": 18.40,
  "daily_remaining_credits": 4350,
  "recent_jobs": [
    { "id": "job_a1", "kind": "marble.generate", "credits": -150, "status": "completed", "at": "2026-04-27T10:15:00Z" },
    { "id": "job_b2", "kind": "meshy.text-to-3d", "credits": -50, "status": "completed", "at": "2026-04-27T09:50:00Z" }
  ]
}
```

### `POST /v1/topup`

Authenticated. Creates a Stripe Checkout session, returns the URL.

```http
POST /v1/topup
Authorization: Bearer gcplus_live_...
Content-Type: application/json

{ "amount_usd": 20, "return_to": "cli" }
```

`return_to` accepts `"cli"` (success page tells user to return to terminal) or a URL (Stripe redirects there post-payment).

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "session_id": "cs_test_a1b2",
  "checkout_url": "https://checkout.stripe.com/c/pay/cs_test_a1b2",
  "credits_on_success": 2000,
  "expires_at": "2026-04-27T20:00:00Z"
}
```

Allowed amounts: `5`, `20`, `50`, `100`. Other amounts → `400 Bad Request`.

### `POST /v1/marble/worlds:generate`

Authenticated. Passthrough to `https://api.worldlabs.ai/marble/v1/worlds:generate`.

Request body is forwarded as-is (after auth headers stripped/replaced). Proxy-side:

1. Auth check → 401 if invalid token
2. Daily-cap check → 429 if `daily_remaining_credits < required`
3. Pre-debit minimum credits (150 for 1.1 Plus, 15 for Draft, 150 for Standard)
4. Forward to upstream with `WLT-Api-Key: <our-key>`
5. On 2xx: return upstream response, write `jobs` row
6. On 4xx/5xx: refund credits, return upstream error verbatim

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "operation_id": "...",            // upstream Marble's operation
  "job_id": "job_xyz",              // ours — use to query mirrored assets
  "pre_debit_credits": 150,
  "balance_after": 1690
}
```

Special errors:
- `402 Payment Required` if balance < pre_debit_credits
  ```json
  { "error": "insufficient_credits", "needed": 150, "balance": 80, "topup_url": "https://plus.gamecreator.dev/topup?session=...&amount=20" }
  ```
- `429 Too Many Requests` if daily cap or per-minute rate hit

### `POST /v1/marble/media-assets:prepare_upload`

Authenticated. Passthrough for image upload preparation. **No credits debited** (free, part of generation).

Request/response identical to upstream Marble.

### `GET /v1/marble/operations/:operation_id`

Authenticated. Passthrough. Polls upstream operation status, also reconciles credits if completed.

Reconciliation: when `done: true` and Marble 1.1 Plus generation, count actual cubes from response (TBD: exact field — likely `metadata.cube_count` or derive from `world_prompt`). Debit additional credits if cube_count > 1, mark job completed.

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "operation_id": "...",
  "done": true,
  "metadata": {...},
  "response": {...},                 // Marble's payload
  "_plus": {
    "job_id": "job_xyz",
    "final_credits": 210,            // 150 base + 2×30 for 2 extra cubes
    "asset_mirror_urls": {            // ← our mirror, 30d retention
      "spz_full": "https://plus.gamecreator.dev/v1/jobs/job_xyz/assets/scene.spz",
      "spz_500k": "https://plus.gamecreator.dev/v1/jobs/job_xyz/assets/scene-500k.spz",
      "collider": "https://plus.gamecreator.dev/v1/jobs/job_xyz/assets/scene-collider.glb",
      "pano":     "https://plus.gamecreator.dev/v1/jobs/job_xyz/assets/scene-pano.jpg"
    }
  }
}
```

Clients should download from `_plus.asset_mirror_urls` rather than Marble's signed URLs — those expire; ours don't.

### `POST /v1/meshy/text-to-3d`

Authenticated, **v2 upstream**. Passthrough for Meshy text-to-3D. Pre-debit 47 cr for preview (`mode: "preview"`) on Meshy-6, 12 cr on Meshy-5; 23 cr for refine (`mode: "refine"`). The proxy auto-injects `moderation: true` unless explicitly overridden.

Same pattern as Marble: pre-debit, settle on success via reconciler, refund on failure. Body shape passes through unchanged (see Meshy docs).

### `POST /v1/meshy/image-to-3d`

Authenticated, **v1 upstream**. 12-70 cr pre-debit depending on `ai_model` (meshy-5/6) and `should_texture` flag.

### `POST /v1/meshy/rigging`

Authenticated, **v1 upstream**. Auto-rig humanoid GLB. 12 cr pre-debit. Body needs either `model_url` or `input_task_id` (a prior text/image-to-3d task).

### `POST /v1/meshy/animations`

Authenticated, **v1 upstream**, **plural path**. Apply ONE animation per call. 7 cr per task. Body needs `rig_task_id` and `action_id` (integer from Meshy's animation library at `https://api.meshy.ai/web/public/animations/resources`). Submit N times for N clips.

### `POST /v1/meshy/retexture`

Authenticated, **v1 upstream**. Apply new textures to an existing model. 23 cr pre-debit.

### `GET /v1/jobs/:job_id`

Authenticated. Returns job state snapshot.

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "job_id": "job_xyz",
  "kind": "marble.generate",
  "status": "completed",
  "upstream_id": "<marble op id or meshy task id>",
  "pre_debit_cr": 288,
  "final_cr": 220,
  "asset_dir": "data/assets/u_.../job_.../",
  "response": { ... rewritten with our mirror URLs ... },
  "error": null,
  "created_at": "...",
  "completed_at": "..."
}
```

### `GET /v1/jobs/:job_id/stream`

Authenticated. **Server-Sent Events** stream of live progress until terminal state.

- For Meshy jobs: proxies Meshy's native SSE upstream. Events carry `progress: 0–100`, real-time.
- For Marble jobs: synthesized from our DB every 2s. Events carry `{status, elapsed_ms, p50_eta_ms}` (no real %).

Stream closes on terminal status (`completed | failed`).

```bash
curl -N -H "Authorization: Bearer $TOKEN" http://localhost:8787/v1/jobs/job_xyz/stream
data: {"job_id":"job_xyz","status":"in_progress",...}
data: {"status":"IN_PROGRESS","progress":42,...}
data: {"status":"SUCCEEDED","progress":100,...}
```

### `DELETE /v1/jobs/:job_id`

Authenticated. Cancel an in-progress job.

- **Meshy jobs**: fires the upstream DELETE (Meshy's undocumented cancel endpoint). The reconciler picks up `CANCELED` and settles to `consumed_credits`. Cancellation is **billable** for any work already done.
- **Marble jobs**: returns `400 Bad Request` — Marble has no cancellation API. Operations continue and credits stay billed.

### `GET /v1/jobs/:user_id/:job_id/:filename`

**Public** (job_id is unguessable, 16-char hex). Streams a mirrored asset. Filenames are stable per kind:

- Marble: `world.spz`, `world-500k.spz`, `world-100k.spz`, `collider.glb`, `thumbnail.webp`
- Meshy: `model.glb`, `model.fbx`, `model.usdz`, `model.obj`, `thumbnail.webp`, `texture-base_color.png` (etc.)

In dev served from local disk at `ASSET_STORAGE_DIR`; in prod swap to S3/R2 + CDN with the same path scheme.

## Admin endpoints

Authenticate with header `x-admin-token: <ADMIN_TOKEN env>`. Disabled (`503`) if `ADMIN_TOKEN` is not set in env.

### `POST /v1/admin/grant`

Pre-fund an account with credits without going through Stripe. Dev / support use only.

```http
POST /v1/admin/grant
x-admin-token: <token>
Content-Type: application/json

{ "user_id": "u_...", "credits": 1000, "reason": "support-credit" }
```

### `GET /v1/admin/metrics`

JSON snapshot of operational state. Used by the dashboard at `GET /admin`.

```json
{
  "generated_at": "2026-04-29T19:00:00Z",
  "upstream": {
    "meshy_balance": 1905,
    "meshy_balance_usd": 38.10,
    "meshy_low_warning": false,
    "marble_balance_note": "No API — check platform.worldlabs.ai/billing"
  },
  "spend_today":  { "gross_cr", "settled_cr", "refunded_cr", "net_cr", "net_usd", "by_kind" },
  "spend_7d":     { ..., "daily": [{ "date", "net_cr", "jobs" }] },
  "jobs_today":   { "submitted", "completed", "failed", "in_progress", "success_rate" },
  "in_progress":  [{ "job_id", "kind", "age_min", "upstream_id" }],
  "recent_failures": [...],
  "stuck":        [...],
  "perf":         { "marble.generate": { "p50_sec", "p95_sec", "sample_n" }, ... },
  "drift":        { "sum_balance_cr", "sum_ledger_cr", "delta", "consistent" }
}
```

### `GET /admin`

Single-page HTML dashboard. Polls `/v1/admin/metrics` every 10s. Token is entered on first visit and saved to localStorage.

### `POST /v1/rotate-token`

Authenticated. Issues a new bearer token, invalidates the current one.

```http
HTTP/1.1 200 OK
{ "token": "gcplus_live_<new>", "rotated_at": "..." }
```

### `DELETE /v1/account`

Authenticated. Deletes user. Refunds all unused credits to original payment method (Stripe). Purges assets after 30 days. GDPR-compliant.

## Error envelope

All 4xx/5xx responses use a uniform shape:

```json
{
  "error": "code_string",
  "message": "human readable",
  "request_id": "req_...",
  "...": "additional fields per error type"
}
```

Common error codes:

| Code | Status | Meaning |
|---|---|---|
| `invalid_token` | 401 | Bearer token missing or invalid |
| `insufficient_credits` | 402 | Balance < required pre-debit |
| `daily_cap_hit` | 429 | User exceeded daily credit cap |
| `rate_limited` | 429 | Too many requests/minute |
| `upstream_failed` | 502 | Marble or Meshy returned 5xx |
| `upstream_timeout` | 504 | Upstream took too long (Marble: 20min, Meshy: 10min) |
| `asset_expired` | 410 | Mirror retention elapsed |
| `account_frozen` | 403 | Chargeback or fraud flag |

## Idempotency

`POST /v1/marble/worlds:generate` and `POST /v1/meshy/*` accept `Idempotency-Key: <uuid>` header. Same key within 24h returns the cached response without re-billing.

Clients SHOULD set this for retries (network errors, etc.). The `plus-generate-world.mjs` script generates a UUID per invocation and includes it.

## Asset mirroring details

When an upstream task completes, the reconciler triggers `AssetMirrorService.mirror(job)`:

1. Downloads all asset URLs from the upstream response to `ASSET_STORAGE_DIR/<user_id>/<job_id>/<filename>`
2. Rewrites the response object so URLs point at our backend (`ASSET_BASE_URL/<user_id>/<job_id>/<filename>`)
3. Sets `jobs.asset_dir`

The rewrite happens in-place — clients reading `GET /v1/jobs/:jobId.response` see only mirrored URLs, never the upstream CDN URLs.

**Why this matters most for Meshy**: their CDN URLs are CloudFront-signed with expiration in 2126, but the underlying files are deleted from their servers after **3 days** (non-Enterprise). Without mirroring, GLBs vanish.

**For Marble**: URLs are unsigned and stay valid as long as the world record exists, but `DELETE /worlds/:id` (or sufficiently old worlds) wipes them. Mirroring is insurance.

Storage costs are tiny (a typical Marble world is ~37MB; at $0.023/GB/month that's $0.0008/month/world). Retention strategy is TBD; for now everything is kept indefinitely.

## Local dev

The backend lives in a separate **private** repo. To point the public client scripts at a local instance instead of the hosted `gamecreator.dev`:

```bash
GCPLUS_PROXY=http://localhost:8787 \
GCPLUS_TOKEN=gcplus_test_<your-token> \
node scripts/plus-generate-world.mjs --prompt "..." --image ./ref.jpg
```

`GCPLUS_TOKEN` is obtained by running `node scripts/plus-auth.mjs signup` (which hits `GCPLUS_PROXY` if set, else production). The script also caches the token at `~/.gcplus/token`.
