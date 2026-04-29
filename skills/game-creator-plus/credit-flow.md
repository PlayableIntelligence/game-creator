# Credit Flow & Pricing

How OGP Plus credits work end-to-end. No UI — every interaction is via Claude conversation + browser link.

## Pricing model

- **1 Plus-credit = $0.01 USD**
- Topup tiers: $5 / $20 / $50 / $100 → 500 / 2000 / 5000 / 10000 credits
- Stripe fees passed through (~3% + $0.30 — minimum $5 topup keeps the floor at <10% effective fee)
- No subscription, no monthly minimum, credits never expire

### Per-operation cost table

Markup is **17%** over our actual upstream cost. Verified 2026-04-29 against
docs.worldlabs.ai/api/pricing and docs.meshy.ai/en/api/pricing.

Marble billing rate: 1 Marble cr = $0.0008. Meshy billing rate: 1 Meshy cr ≈ $0.02 (Pro plan implied).

| Operation | Upstream | Plus credits | Notes |
|---|---|---|---|
| **Marble 1.0-draft** (text) | $0.18 | **22 cr** | Fast, ~30s when healthy |
| **Marble 1.0-draft** (image) | $0.12 | **14 cr** | |
| **Marble 1.0 / 1.1** (text) | $1.26 | **150 cr** | Standard, ~10 min |
| **Marble 1.0 / 1.1** (image) | $1.20 | **140 cr** | |
| **Marble 1.1-plus** (text) | $1.26–$2.46 | **148–288 cr** | Variable — preauth max, settle on completion |
| **Marble 1.1-plus** (image) | $1.20–$2.40 | **140–281 cr** | |
| **Meshy text-to-3D** preview (meshy-6) | $0.40 | **47 cr** | Default art-style |
| **Meshy text-to-3D** preview (low-poly) | $0.10 | **12 cr** | |
| **Meshy text-to-3D** refine (PBR maps) | $0.20 | **23 cr** | Separate task; preview required first |
| **Meshy image-to-3D** w/ tex (meshy-6) | $0.60 | **70 cr** | |
| **Meshy image-to-3D** w/o tex (meshy-6) | $0.40 | **47 cr** | |
| **Meshy image-to-3D** w/ tex (other) | $0.30 | **35 cr** | |
| **Meshy image-to-3D** w/o tex (other) | $0.10 | **12 cr** | |
| **Meshy rigging** | $0.10 | **12 cr** | Auto-rig humanoid |
| **Meshy animation** (per clip) | $0.06 | **7 cr** | Multiplied by N clips |
| **Meshy retexture** | $0.20 | **23 cr** | |
| **Meshy remesh** | $0.10 | **12 cr** | |
| Lightness bake | $0 | 0 cr | Client-side, free |
| Splat-fog setup | $0 | 0 cr | Client-side, free |
| Asset mirror to Plus storage | $0.001 | 1 cr | Per asset, 30-day retention |

**Marble Plus is variable** because the model auto-expands during generation — we don't know the final cost until done. We **preauth the max** (288 cr text / 281 cr image), then settle to the actual cost on completion and refund the delta. UX: "Up to $2.88, charged actual."

### Worked example: full cathedral game

```
Generate splat (1.1 Plus text, ~mid-expansion) 220 cr  ($1.85)
Generate boss enemy (Meshy text + rig + 2 anim)
   preview                                      47 cr  ($0.40)
   rig                                          12 cr  ($0.10)
   2 anim clips × 7                             14 cr  ($0.12)
Generate 3 props (Meshy text-to-3d preview)    141 cr  ($1.20)
Asset mirroring (5 assets × 1 cr)                5 cr  ($0.04)
──────────────────────────────────────────────────────
Total                                          439 cr  ($3.71)
```

Round to **$5 topup** = 500 credits, leaves 61 credits buffer for re-rolls.

## End-to-end UX (the no-UI flow)

### First-time signup

```
User: I want to make a splat-based dungeon crawler
Claude: I'll use game-creator-plus for that. First time? Let me set up your
        account — it takes 30 seconds and the first $5 of credits is on us.

  Run this:
    node scripts/plus-auth.mjs signup --email rshtirmer@gmail.com

User: [runs command]
        → Receives token, saved to ~/.gcplus/token
        → Browser opens https://plus.gamecreator.dev/welcome?token=<one-time>
        → Welcome page shows free $5 credit, optional $20 topup button

User: ok, $20 topup. [clicks Stripe Checkout]
        → Pays $20.00 via Stripe
        → Stripe webhook → ledger += 2000 credits
        → Welcome page polls /v1/balance, shows "2500 credits ready"

Claude: You're set — 2500 credits. Now let's design the dungeon...
```

### Mid-session topup

```
User: generate the cathedral
Claude: [calls plus-generate-world.mjs]
        → POST /v1/marble/worlds:generate
        → Proxy: balance check, 150 cr available? No (only 80 left).
        → Returns 402 Payment Required + topup URL

Claude: You're at 80 credits, need 150. Quick top-up:
        https://plus.gamecreator.dev/topup?session=<id>&amount=20

User: [opens link, pays $20]
        → Webhook credits 2000 cr
        → Claude polls balance (or user says "done")
Claude: Great — 2080 credits. Generating now... [retries the same call]
```

### Balance check

```
User: how much do I have left?
Claude: [calls plus-auth.mjs balance]
        Balance: 1840 credits ($18.40)
        Recent: cathedral world (-150), boss enemy rig (-130), 3 props (-150)
```

### BYO-key fallback

```
User: I don't want to pay through your service, I have my own keys
Claude: All good — set WORLDLABS_API_KEY and MESHY_API_KEY in .env, the
        plus skill will auto-detect and skip the proxy. You lose:
          - Asset mirroring (Meshy 3-day expiry will bite you)
          - Talk-to-Claude topup convenience
          - Failed-job auto-refunds (your provider's terms apply directly)
        But all the cathedral-pattern logic still runs.
```

## Backend wire format (for `plus-auth.mjs` and proxy clients)

### Signup

```http
POST /v1/signup
Content-Type: application/json

{ "email": "user@example.com", "promo_code": null }
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "token": "gcplus_live_abc123...",
  "user_id": "u_xyz",
  "balance_credits": 500,
  "welcome_url": "https://plus.gamecreator.dev/welcome?token=<one-time>",
  "first_topup_url": "https://plus.gamecreator.dev/topup?session=<id>"
}
```

### Topup (returns Stripe Checkout URL)

```http
POST /v1/topup
Authorization: Bearer gcplus_live_abc123...
Content-Type: application/json

{ "amount_usd": 20, "return_to": "cli" }
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "session_id": "cs_test_...",
  "checkout_url": "https://checkout.stripe.com/c/pay/cs_test_...",
  "credits_on_success": 2000,
  "expires_at": "2026-04-27T20:00:00Z"
}
```

### Balance

```http
GET /v1/balance
Authorization: Bearer gcplus_live_abc123...
```

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "balance_credits": 1840,
  "balance_usd": 18.40,
  "recent_jobs": [
    { "id": "job_...", "kind": "marble.generate", "credits": -150, "at": "..." },
    { "id": "job_...", "kind": "meshy.text-to-3d", "credits": -50, "at": "..." }
  ]
}
```

### Marble passthrough (proxy mode)

```http
POST /v1/marble/worlds:generate
Authorization: Bearer gcplus_live_abc123...
Content-Type: application/json

{ "world_prompt": {...}, "model": "marble-1.1-plus", ... }
```

Proxy logic:
1. Auth check, balance check (≥ 150 cr for 1.1 Plus base)
2. **Pre-debit** balance by 150 cr, write `job` row (status=pending)
3. Forward to `api.worldlabs.ai/marble/v1/worlds:generate` with our upstream key
4. On 2xx: return Marble's response, mark job in_progress, link job_id to operation_id
5. On 4xx/5xx: **refund** credits, mark job failed, return error to client
6. Async poller: when Marble operation completes, count actual cubes, **reconcile** ledger if cube count > 1 (debit additional cr per extra cube). If user balance now negative, mark job pending_payment — assets locked until topup.

The reconciliation step is critical: 1.1 Plus is variable-cost. We pre-debit the minimum, then settle when we know the actual cube count.

### Asset mirror

```http
GET /v1/jobs/:job_id/assets/scene.spz
Authorization: Bearer gcplus_live_abc123...
```

→ Streams the SPZ from Plus storage (S3/R2/Railway disk). 30-day retention. Free for 30d, 1 cr/day after.

This is what saves users from Meshy's 3-day asset expiration. We mirror on download; users can re-fetch any time within 30 days.

## Backend implementation

The backend (NestJS proxy at `gamecreator.dev`) lives in a separate **private** repo. Public-side consumers (this skill, the template, the `scripts/plus-*.mjs` CLIs) only need the wire contract documented in [`proxy-protocol.md`](./proxy-protocol.md).

For backend operators: see the private repo's README for boot/deploy/ops runbook, env-var matrix, schema, and the test suite (40 unit + 38 e2e).

<!-- internal placeholder so the markdown closing fences don't dangle -->
<details><summary>(legacy schema sketch — kept here as historical reference; authoritative version lives in the backend repo)</summary>

```sql
-- approximate shape; see backend repo for source-of-truth migrations
create table users        (user_id text primary key, email text unique, token_hash text, balance_cr integer);
create table credit_ledger(ledger_id bigserial primary key, user_id text, delta_cr integer, reason text, job_id text, stripe_id text, at timestamptz);
create table jobs         (job_id text primary key, user_id text, kind text, status text, upstream_id text, pre_debit_cr integer, final_cr integer, request jsonb, response jsonb, asset_dir text, created_at timestamptz, completed_at timestamptz);
create table stripe_events(event_id text primary key, type text, user_id text, amount_cr integer, raw jsonb, processed_at timestamptz
);

create index on credit_ledger (user_id, at desc);
create index on jobs (user_id, created_at desc);
create index on jobs (status) where status in ('pending', 'in_progress');
```

</details>

## Risk controls

- **Daily cap per user:** 5000 cr/day default ($50). Configurable by support. Prevents API-cost runaway from a stuck loop.
- **Per-request timeout:** Marble operations cancelled after 20 min (refund). Meshy after 10 min.
- **Failed-upstream auto-refund:** any 4xx/5xx from upstream triggers a ledger refund + job=failed.
- **Stripe disputes:** chargeback → freeze account, refund all unused credits, ban user_id from re-signup until manually reviewed.
- **Idempotency:** Stripe webhooks keyed by event_id; replays are no-ops.
- **Token rotation:** users can rotate their bearer token via `/v1/rotate-token` (invalidates old).

## Open questions before launch

These are the things to lock down once Phase 2/3 are built:

1. **Promo codes** — first-100-users free $20? Influencer codes for percentage off?
2. **Tax** — Stripe Tax or self-managed? Probably Tax — simpler.
3. **Refund policy** — failed jobs auto-refund (built in). Voluntary refund for unused credits — yes, full refund within 30 days.
4. **GDPR/data deletion** — schema supports `users.deleted_at` + asset purge cron. Build before EU launch.
5. **Terms of service** — pass-through API terms (user agrees to Marble TOS + Meshy TOS by signing up).
6. **Rate limit at proxy** — 1 generation per 60s per user? Prevents accidental loops in dev.

None of these block Phase 1 (skill + scripts). They block Phase 2/3 (backend + Stripe).
