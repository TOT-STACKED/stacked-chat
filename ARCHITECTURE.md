# Stacked Chat: back-end architecture

## How requests are routed (strangler pattern)

`server.js` is still the front door (plain Node `http`). Before running any legacy route it asks the
modern handler (`src/index.ts`) whether it owns the URL: `/api/v1/*` and `/healthz` today. If so,
Fastify handles it. Everything else falls through to the legacy code unchanged. Routes move into
`src/modules/<feature>/` one at a time behind the **same URLs**, so the live widget never breaks.

Safety nets:
- If `dist/` (the compiled TypeScript) or its dependencies are missing, the legacy server boots anyway.
- `DISABLE_MODERN_API=1` in the host environment switches the modern API off without a code change.
- `tests/legacy-smoke.test.ts` boots the real server and parses every inline `<script>` on `/`, `/admin`
  and `/app` (client JS lives in template literals, which `node --check server.js` cannot see).

## Layout

```
server.js                 legacy monolith + strangler hook
src/
  index.ts                createModernHandler(): handles(url) / handle(req, res)
  app.ts                  Fastify app: zod validation, OpenAPI, error envelope, log redaction
  config.ts               env schema (zod)
  lib/                    infrastructure clients (Supabase REST)
  modules/<feature>/      routes + service + zod schema + tests per feature
tests/                    vitest
supabase/migrations/      numbered SQL, applied in order
```

Build: `npm install` runs `postinstall` -> `tsc` -> `dist/`. Run: `node server.js`.
Test: `npm test`. Typecheck: `npm run typecheck`.

## Conventions

- Every route declares zod schemas (request + response); the OpenAPI document at
  `/api/v1/openapi.json` is generated from them.
- Errors: `{ "error": { "code", "message", "details?" } }`.
- Never log credentials (redaction is configured and tested).
- No service-role key in any browser-facing code or template.

## Identity & tenancy (Phase 1)

Organisation -> site (a venue row; ids unchanged) -> team -> member. Roles: `owner`, `hq_admin`
(organisation-wide), `site_manager`, `staff`, `kiosk` (site-level; staff may be org-wide).
You can only grant roles *below* your own (owners can grant any); the last owner can't be removed.

- **Who is calling:** a Supabase session token (`Authorization: Bearer <jwt>`, verified against Supabase
  Auth; only a *confirmed* email counts) or an API key (`X-API-Key: sk_live_...`, stored hashed, scoped,
  revocable, optionally limited to one site).
- **Data access:** the server uses the service-role key; **row-level security denies the public key
  everything**. A signed-in user may read only their own membership rows.
- **API conventions:** `Idempotency-Key` on POSTs, per-caller rate limits (`X-RateLimit-*`, `Retry-After`),
  errors as `{ "error": { code, message } }`, OpenAPI at `/api/v1/openapi.json`.

## Environment variables

| Variable | Purpose |
|---|---|
| `SUPABASE_SERVICE_KEY` | **Server-only.** Service-role/secret key. Without it identity endpoints answer 503. |
| `STACKED_ADMIN_PASSWORD`, `CRON_SECRET` | Legacy `/admin` login and digest cron. Unset = that feature is off (no defaults). |
| `SUPABASE_URL`, `SUPABASE_KEY` | Project URL and the *anon* key (used only to ask Supabase Auth who a session is). |
| `DISABLE_MODERN_API=1` | Kill switch: run legacy routes only. |
| `LOG_LEVEL` | pino level (default `info`). |

## Migrations

Numbered files in `supabase/migrations/`, applied in order. `001_baseline` documents what production
already had; `002` is the RLS lockdown (already applied). Apply new ones by pasting the file into the
Supabase SQL editor (or via a Supabase branch). The whole chain is tested on an embedded Postgres
(`tests/db`), including the legacy-data backfill and the "public key can touch nothing" checks.
`supabase/audits/rls_audit.sql` is a read-only report of RLS state and grants.


## Billing

Per-venue subscription billing lives in `src/modules/billing/` (Stripe over fetch, no SDK). It is self-contained: pure pricing and gating rules, an idempotent subscription sync, a signed webhook, and fair-use metering, behind `BillingStore` / `StripeApi` interfaces so tests use in-memory fakes. Billing stays off, and fails closed, unless every Stripe setting is present. See `docs/BILLING.md` for pricing, endpoints, setup and the test-mode walkthrough.

## Knowledge

`src/modules/knowledge/` is a catalogue (`knowledge_items`) over the content the chat already reads (`documents`, `videos`, `images`). The catalogue adds a title, a status (draft/published) and an audience (the whole company or one site). A draft lives only in the catalogue, never in the tables the chat reads, so it can never be answered from; publishing copies it in, unpublishing removes it. Existing content is adopted into the catalogue automatically the first time Manage lists it. The legacy chat hides content published for a different site (`modern.knowledgeExcludedFor`, fails open). API keys with `kb:read` can list published items. Team and role targeting come later, with chat sign-in on the new accounts.

Uploads: `POST /api/v1/orgs/:orgId/knowledge/upload?filename=...` takes the raw file (PDF, .docx, .txt/.md, up to 10 MB), reads the text out on the server (`extract.ts`: pdf.js and mammoth, loaded on demand), and saves it as a DRAFT for a person to review before publishing. File type is decided from the file's first bytes, not its name. Scanned PDFs (no text layer) are refused with a clear message; the original file is not kept yet.

## Insights

`src/modules/insights/` reads the chat's stored conversations and answers: what is asked most, what the AI could not answer, and usage by team and site. Same-meaning questions are grouped by a key of their meaningful words (`analyze.ts`). "Could not answer" is detected from the AI's own reply (the phrase list the old admin used). Site managers see only the venues they run. The screen shows aggregates only, never who asked.

"Write the answer" creates a DRAFT in Knowledge (`source: ai_draft`, `source_question` = the question key, so it is never drafted twice). With `ANTHROPIC_API_KEY` set, a model writes a short starting point using only the company's own published documents, with `[CONFIRM: ...]` wherever policy is unknown (`drafter.ts`); without it, or on any failure, the draft is a blank template. Nothing an AI writes is ever published automatically.
