# PR #21 Audit — `feat/game-creator-plus`

**PR:** https://github.com/OpusGameLabs/game-creator/pull/21 (draft)
**Branch:** `feat/game-creator-plus` @ `4d0b18d`
**Diff:** 60 files, +8,328 / −18 (single commit)
**Audit date:** 2026-04-29

This PR introduces three coupled pieces:

1. **Skill** — `skills/game-creator-plus/` (SKILL.md + 5 companions)
2. **Template** — `templates/plus-template/` (Three.js + Spark 2 + Rapier splat runtime)
3. **Proxy-aware scripts** — `scripts/plus-*.mjs` and edits to `meshy-generate.mjs` / `worldlabs-generate.mjs`

The proxy backend lives in a separate private repo, audited locally at `../plus-backend`. Findings below cover both sides; backend items are tagged `[backend]`.

---

## 1. Blockers

### 1.1 Missing script `scripts/plus-bake-lightness.mjs`
Referenced 4× as a documented step / next-step hint, never committed.

- `skills/game-creator-plus/SKILL.md:117,166,214`
- `scripts/plus-generate-world.mjs:683` (post-generation hint)

The bake logic exists in-browser at `templates/plus-template/src/world/BakeLightness.js` (invoked via `?bake=lightness`), but the CLI wrapper the docs promise does not.

**Fix:** either build the headless wrapper (Playwright boots the template, navigates with `?bake=lightness`, captures the downloaded `<slug>-lightness.json`), or strip the references and re-document the in-browser bake as the canonical path.

### 1.2 `meshy-generate.mjs` proxy-path bug
`resolvePath()` strips only `/v2`:

```js
// scripts/meshy-generate.mjs:121
return path.replace(/^\/v2/, '');
```

But the script's actual paths for image-to-3d, rigging, animations, retexture are `/v1/...` (lines 480, 490, 536, 546, 639, 649, 690-693). In proxy mode they resolve to `https://plus.gamecreator.dev/v1/meshy/v1/image-to-3d` → 404. Only text-to-3d works.

The same predicate guards the `Idempotency-Key` header (line 196), so retries for `/v1/*` endpoints can double-bill even if the path were corrected.

**Fix:**
```js
return path.replace(/^\/v[12]/, '');
// and
if (useProxy && /\/v[12]\/(text-to-3d|image-to-3d|rigging|animations|retexture)/.test(path)) {
  reqHeaders['Idempotency-Key'] = randomUUID();
}
```

### 1.3 64MB `cathedral.spz` committed as raw binary
`git check-attr filter` returns `unspecified` for `cathedral.spz`, `cathedral-100k.spz`, `cathedral-500k.spz`, and `bloody.vrm`. The file at `templates/plus-template/public/assets/worlds/cathedral.spz` is real gzip data (verified via `hexdump`), not an LFS pointer. `.gitattributes` covers `.glb` / `.gltf` / `.fbx` / `.obj` / audio / video — but not `.spz` or `.vrm`.

The PR description acknowledges the 64MB size; once merged it's permanent in history.

**Fix:**
1. Add to `.gitattributes`:
   ```
   *.spz filter=lfs diff=lfs merge=lfs -text
   *.vrm filter=lfs diff=lfs merge=lfs -text
   ```
2. `git rm --cached` the four binaries, re-add via LFS before merge.
3. Or skip the 64MB tier entirely — the 1.3MB `-100k` and 7.6MB `-500k` cover demo needs.

### 1.4 `[backend]` `GET /v1/balance` does not exist
- `plus-auth.mjs:140` (`whoami`/`balance` commands) hits this endpoint
- `proxy-protocol.md:74-96` and `credit-flow.md:172` both spec it

Backend has only `GET /v1/me/usage` (`plus-backend/src/me/me.controller.ts:22`). Result: `node scripts/plus-auth.mjs balance` always 404s.

**Fix on plus-backend:** add `GET /v1/balance` returning `{balance_credits, balance_usd, daily_remaining_credits, recent_jobs}`, or rewrite the script + docs to use `/v1/me/usage`.

---

## 2. Payment integration (specific)

The Stripe / credit-ledger plumbing on the backend is sound (atomic webhook handler with PG unique-constraint idempotency, `payment_intent_data.metadata` propagation, defense-in-depth re-derive of credits from `amount_total`, dispute claw-back via `forceDebit`). What's broken is the **end-to-end UX wrapping it.**

### 2.1 `[backend]` Stripe success/cancel pages are 404s
`stripe.service.ts:108-115` builds:

- `success_url`: `${baseUrl}/topup/success?session_id={CHECKOUT_SESSION_ID}`
- `cancel_url`:  `${baseUrl}/topup/cancel`

Grep confirms **no controller serves `/topup/success` or `/topup/cancel`** anywhere in the backend. A user who actually pays $20 via Stripe lands on a 404. This is the single worst UX failure in the system.

**Fix on plus-backend:** add a `TopupUiController` analogous to `MeUiController` with two static pages. Success page should poll `/v1/balance` until the webhook fires (10–30s typical), then say "credits ready, return to your terminal".

### 2.2 `[backend]` Signup grants 0 credits, not the promised 500
- `auth.service.ts:58` creates user with `balance_cr: 0`
- `proxy-protocol.md:46` says signup response includes `balance_credits: 500`
- `credit-flow.md:65-67` says "first $5 of credits is on us"

Backend grants nothing. The starter-credit promise is a hard contract violation — first-time users hit 402 on their first generation attempt and can't actually try the product before paying.

**Fix on plus-backend:** in `AuthService.signup()`, `await this.credit.credit(user.user_id, 500, "starter-grant", { em })` after the user save. Wrap in a single transaction. Add a flag (`users.starter_granted_at`) so the grant is single-use even across delete-then-resignup attempts.

### 2.3 `[backend]` `welcome_url` and `first_topup_url` always null
`auth.controller.ts:31-32`:

```ts
welcome_url: null, // step 6 — Stripe Checkout link
first_topup_url: null, // step 6 — Stripe Checkout link
```

`credit-flow.md:64-83` describes a UX that depends on these being populated: browser opens welcome page → free $5 displayed → optional $20 topup button → Stripe Checkout. As shipped, signup completes with no welcome flow at all.

Even if populated, there's no `/welcome` controller (only `/me` and `/admin`).

**Fix on plus-backend:** at end of `signup()`, optionally call `stripe.createTopup(user, 20, 'cli')` to mint a session and return its URL as `first_topup_url`. Add `/welcome?token=<one-time>` page that confirms account + balance and shows the topup button.

### 2.4 `[backend]` 402 response missing `topup_url`
`credit.service.ts:60-65` throws:

```ts
{ error: 'insufficient_credits', needed: cr, balance: u.balance_cr }
```

No `topup_url`. Public-side scripts (`plus-generate-world.mjs:286`, modified `meshy-generate.mjs` / `worldlabs-generate.mjs` 402 handlers) fall back to `${GCPLUS_PROXY}/topup` — a hardcoded URL with no Stripe session behind it. Users get an unactionable error mid-generation.

**Fix on plus-backend:** intercept the 402 at the controller (or wrap `credit.debit()` call in `marble.service.ts` / `meshy.service.ts`), call `stripe.createTopup(user, 20, 'cli')` to mint a session inline, and re-throw with `topup_url` populated. Cost: one Stripe API call per insufficient-balance hit (rare).

### 2.5 `[backend]` No daily-cap enforcement
- `credit-flow.md:248` documents "Daily cap per user: 5000 cr/day default ($50)"
- `proxy-protocol.md:91` returns `daily_remaining_credits` in the balance response

Reality: `credit.service.ts:debit()` only checks `balance_cr < cr`. No `users.daily_spent_cr` field, no per-day window query, no cap. A stuck client retry loop can drain the entire balance.

**Fix on plus-backend:** add a daily-window query against `credit_ledger` (`SUM(-delta_cr) WHERE delta_cr < 0 AND at >= NOW() - INTERVAL '24 hours'`) inside the same transaction as `debit()`. Cache the result on `users.daily_spent_cr` + `users.daily_spent_at` for hot-path performance, recompute when the date rolls over. Reject with `429 daily_cap_hit` when exceeded.

### 2.6 `[backend]` Stripe reconciliation has no cron
`stripe.service.ts:reconcile()` exists and is wired to `GET /v1/admin/metrics/stripe-reconcile` (`admin.controller.ts:165`), but no `@Cron` decorator triggers it. `credit-flow.md` and the skill operations section imply automatic alerting.

**Fix on plus-backend:** add a `@Cron(CronExpression.EVERY_DAY_AT_3AM)` job in `ReconciliationService` (or new `StripeReconcileService`) that calls `stripe.reconcile(1, ...)` and logs at WARN if `consistent === false`. Wire to PagerDuty/Slack when ready.

### 2.7 `[backend]` No automated chargeback freeze
`credit-flow.md:251`: "chargeback → freeze account, refund all unused credits, ban user_id from re-signup".

Reality: `stripe.service.ts:handleDisputeFundsWithdrawn()` claws back credits via `forceDebit` (allows negative) but doesn't set a freeze flag. There's no `users.frozen_at` column, no AuthGuard check. A user with a chargeback can keep using their token; if they've burned through credits already, the negative balance just blocks new generations.

**Fix on plus-backend:** add `users.frozen_at` column, set it in `handleDisputeFundsWithdrawn`, check it in `AuthGuard.validateBearer` and return 403 `account_frozen` (already in the error-code table at `proxy-protocol.md:351`).

### 2.8 `[backend]` Card-only — Apple Pay / Google Pay / Klarna disabled
`stripe.service.ts:132`: `payment_method_types: ['card']`. Comment at lines 53-58 spells out the v22 upgrade path. Ships card-only — breaks expectations for EU/JP users.

Not a launch blocker (US/UK users mostly fine), but worth doing before scaling marketing.

### 2.9 `[backend]` No rate limit on `/v1/topup`
Global ThrottlerModule cap is 200/min (`app.module.ts:42`) — too high for a payment-creation endpoint. Easy to spam-create Checkout sessions (harmless individually, session-table pollution).

**Fix on plus-backend:** `@Throttle({ topup: { ttl: 60_000, limit: 5 } })` on `StripeController.topup`.

### 2.10 Negative balance has no user-facing surface
`credit.service.ts:90-117` (`forceDebit`) explicitly allows negative balance for refunds + chargebacks. The user's next generation hits 402 with no context — they don't know it's because Stripe clawed money back.

**Fix on public side:** `plus-auth.mjs balance` should call out negative balance prominently with a "this came from a refund/dispute on TBD-date — see /me page for details" line. **Fix on plus-backend:** include `last_clawback_at` and `last_clawback_reason` in the balance response.

### 2.11 Idempotency on `/v1/topup`
- Backend: `stripe.service.ts:161` uses `randomUUID()` per call as the Stripe SDK idempotency key. Per-call uniqueness defeats the point of idempotency.
- Public-side: `plus-auth.mjs:162` doesn't send any `Idempotency-Key` header.

A user double-clicking topup creates two open Checkout sessions. Stripe doesn't double-bill (each session is independent), but it's confusing and pollutes the session table.

**Fix:**
- Backend: accept `Idempotency-Key` header on `POST /v1/topup`, fall back to `randomUUID()` if absent.
- Public-side: generate one UUID per `topup` invocation in `plus-auth.mjs`, send it.

### 2.12 `metadata.credits_cr` is dead code (observation, not a bug)
`stripe.service.ts:122` writes it; webhook (line 322-323) explicitly re-derives from `amount_total` for tier-drift defense. The metadata write is forensics-only — leave it, but the comment at line 32-33 should clarify "this is for audit logs, not used in fulfillment".

---

## 3. Should-fix (non-payment)

### 3.1 `[backend]` `POST /v1/login` (magic-link) documented, not implemented
`proxy-protocol.md:56-72` describes the lost-token recovery path. `auth.controller.ts` ships only `signup` and `rotate-token`. Anyone who loses `~/.gcplus/token` is locked out forever.

### 3.2 `[backend]` `DELETE /v1/account` documented, not implemented
`proxy-protocol.md:324-326` claims GDPR-compliant deletion + Stripe refund. Not implemented.

### 3.3 `_plus` envelope missing on operation polls
`proxy-protocol.md:170-192` says `GET /v1/marble/operations/:opId` returns:

```json
{ ..., "_plus": { "job_id": "...", "final_credits": 210, "asset_mirror_urls": {...} } }
```

`MarbleService.getOperation()` (`plus-backend/src/marble/marble.service.ts:185-196`) returns the raw upstream payload. Mirror runs async via `ReconciliationService.tick()` (every 30s) → `AssetMirrorService.mirror()` → URLs land on `Job.response`, served by `GET /v1/jobs/:jobId`.

`plus-generate-world.mjs:631-650` polls `/operations/:opId` and reads `op._plus.asset_mirror_urls` — always undefined in proxy mode. Script silently downloads from Marble's CDN URLs (which expire after world deletion). Mirror benefit is never realized.

Also: `reconciliation.service.ts:165,238` have `// TODO #33: trigger asset mirror here` comments — synchronous mirror on settle was planned but not wired. Phase 2 of `tick()` does pick it up on the next 30s cycle.

**Fix:** pick one —
1. Backend wraps `getOperation()` to add `_plus` envelope when op is linked to a job (synthesize from `Job` row + AssetMirrorService output);
2. Script also fetches `GET /v1/jobs/:plusJobId` after operation completes to read rewritten URLs;
3. Docs change to "asset mirror URLs are available via `/v1/jobs/:jobId` after reconciliation, expect up-to-30s lag" + script updated.

### 3.4 plus-template `render_game_to_text()` misses CLAUDE.md required fields
CLAUDE.md rule 6 mandates: coordinate-system note, game mode (`playing`/`game_over`), score, player position/velocity. `templates/plus-template/src/main.js:224-248` returns boot status + bbox + player position/grounded — no `mode`, no `score`, no coordinate-system note. Every game scaffolded from this template inherits the gap.

### 3.5 plus-template has no `audio/` directory
CLAUDE.md rule 5 lists `audio/` as canonical. The template is pitched as production-ready ("ready for boss fights"). Without an audio system, every game built on it has to add Web Audio glue from scratch.

**Fix:** port `examples/flappy-bird/src/audio/` (AudioManager + EventBus listeners + BGM + SFX) into the template, or document the omission with a "see add-audio skill" pointer.

### 3.6 Pricing tables disagree
- `SKILL.md:194-201` says Marble 1.1 Plus = "150 cr base + 30 cr/cube"
- `credit-flow.md:25` says Plus is variable 148–288 cr preauth max
- Backend `priceForMarbleRequest()` (`marble.service.ts:48`) implements the credit-flow numbers (288 / 281)

SKILL.md is the simplified-and-wrong copy. Strike the row or align it with credit-flow + backend.

### 3.7 "Talk-to-Claude topup" is aspirational
`SKILL.md:3` and `credit-flow.md:60` framing implies Claude can drive the topup. In practice the user runs `plus-auth.mjs topup --amount 20`, gets a Stripe URL, opens it, pays. Claude cannot charge a card on the user's behalf — and shouldn't try. Soften to "Claude prints a one-click Stripe URL".

### 3.8 Version drift in plus-template vs CLAUDE.md tech stack
- CLAUDE.md table: `three ^0.183.0`, `vite ^7.3.1`
- `templates/plus-template/package.json`: `three ^0.180.0`, `vite ^5.4.0`

Either bump the template or add a footnote.

### 3.9 CLAUDE.md "production checklist" leaks ops detail
The new section in CLAUDE.md (lines around the diff for 305-310) lists specifics: "Rotate Stripe sk_live_ key", "IP allowlist Stripe webhook IPs at WAF", "automatic_payment_methods (Apple Pay, Google Pay, Klarna)". This belongs in the private backend repo, not the public-facing CLAUDE.md.

### 3.10 Stale CLAUDE.md note
"...lives in a separate **private** repo … `OpusGameLabs/plus-backend` (TBD)" — the repo exists at `../plus-backend`. Drop the "TBD".

---

## 4. Backend follow-up summary

Tagged `[backend]` items consolidated, in priority order. These are the changes needed in `../plus-backend` for the public-side contract to actually work:

| # | Severity | Item |
|---|---|---|
| 1.4 | blocker | Add `GET /v1/balance` (or rewrite scripts to `/v1/me/usage`) |
| 2.1 | blocker | Add `/topup/success` and `/topup/cancel` controllers (post-payment 404) |
| 2.2 | blocker | Grant 500 cr starter credit on signup |
| 2.3 | blocker | Populate `welcome_url` + `first_topup_url` on signup; add `/welcome` page |
| 2.4 | should-fix | Include `topup_url` in 402 `insufficient_credits` envelope |
| 2.5 | should-fix | Enforce daily-cap (proxy-protocol claims `daily_remaining_credits`) |
| 2.6 | should-fix | `@Cron` for `stripe.reconcile()` + alert on drift |
| 2.7 | should-fix | Add `users.frozen_at` + AuthGuard check on chargeback |
| 2.9 | should-fix | Rate-limit `/v1/topup` (5/min/user) |
| 2.11 | should-fix | Honor client-supplied `Idempotency-Key` on `/v1/topup` |
| 3.1 | should-fix | Implement `POST /v1/login` (magic link) |
| 3.2 | should-fix | Implement `DELETE /v1/account` (or strike from docs) |
| 3.3 | should-fix | `_plus` envelope on `/v1/marble/operations/:opId` (or doc + script change) |
| 2.8 | nice-to-have | Stripe SDK v22 upgrade for Apple Pay / Google Pay / Klarna |

---

## 5. Quick wins for this PR

Things that can land in this PR without backend changes:

- **`.gitattributes`** — add `*.spz` and `*.vrm` LFS rules; re-add the 4 binaries via LFS. (1.3)
- **Drop `cathedral.spz`** (64MB tier) from committed assets if `-100k` and `-500k` cover demo needs.
- **`meshy-generate.mjs:121,196`** — fix `^/v[12]` strip + idempotency predicate. (1.2)
- **`plus-bake-lightness.mjs`** — either build it or strip 4 references and document `?bake=lightness` URL flow. (1.1)
- **`templates/plus-template/src/main.js:224`** — add `mode`, `score`, coord-system comment to `render_game_to_text()`. (3.4)
- **`SKILL.md:194-201`** — strike or fix Marble 1.1 Plus pricing row. (3.6)
- **`SKILL.md:3` + `credit-flow.md:60`** — soften "talk-to-Claude topup" wording. (3.7)
- **CLAUDE.md** — drop production-checklist section + "TBD" wording. (3.9, 3.10)

---

## 6. What's good

For the record, these are well-done and shouldn't change:

- **Atomic webhook handling** with PG unique-constraint idempotency (`stripe.service.ts:210-249`) — race-free, replay-safe.
- **`payment_intent_data.metadata` propagation** so refund/dispute webhooks (which carry the charge, not the session) can identify the user without an extra Stripe API call.
- **Defense-in-depth credit re-derivation** from `amount_total` instead of trusting `metadata.credits_cr`.
- **Marble Plus preauth-max + settle-actual** (`priceForMarbleRequest` returns 288/281 max; reconciler settles via `actualCostForMarble`) — correctly handles the variable-cost path.
- **Cathedral pattern** as a product story — clean, defensible, and the prompt-augmentation logic in `plus-prompt-templates.mjs` is well-structured.
- **EventBus + GameState + Constants singletons** in plus-template all match CLAUDE.md architecture rules.
- **`AssetMirrorService`** — the path-traversal guard at `asset-mirror.controller.ts:34`, the storage-layout decision (`{user_id}/{job_id}/{filename}`), and the response-rewrite-in-place pattern are all solid.
- **Reconciliation cron + stuck-job auto-cancel** — well-thought-out timing (Marble at 2h45m to beat 3h upstream expiry, Meshy at 30m).
