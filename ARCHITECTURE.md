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

## Settings

Manage → Settings (owners and HQ admins): Company (rename the company and venues), Chat and branding (per venue: chat name, welcome heading and message, main colour, logo link), API keys, and Billing. The chat page is built by pasting branding values straight into HTML, CSS and attributes, so `src/modules/branding/validate.ts` keeps them to plain text (no angle brackets, quotes, backslashes, braces, backticks or `$`), colours to `#RRGGBB`, and logos to `https://` links. Removing "Powered by Stacked Chat" (`white_label`) is deliberately not self-serve. Webhooks are not built yet.

## Chat (the staff app)

`web/chat/` is the staff-facing chat, served at `/chat/` (the bare `/chat` path still belongs to the old widget's API). It signs in with the same email-code accounts as Manage (one shared session), and uses `/manage/auth.js`, `api.js` and `dom.js` so there is one copy of each.

`src/modules/chat/` answers. For each question it finds what this person may see: published knowledge for the whole company, their venue, or their team (`retrieve.ts`, drafts never), picks the best passages by word overlap, and asks the model with a strict prompt (`prompt.ts`): answer only from that knowledge, cite the source, allergens only from the company's own documents, and a fixed "I don't have that in your knowledge base yet" when it has nothing. The reply, sources, a matching video, and a photo (only if asked for) come back; the conversation is saved to `conversations` (Insights reads it) and the question is metered for fair use. Nothing is pasted into the page as HTML: the page builds DOM nodes from text.

Venue branding from Settings (name, colours, welcome text, logo) styles each venue's chat. Conversations are private to the person and venue. Ported from the old chat: the vendor playbook and NPS (below). Not ported: the Slack hand-off. Env: `ANTHROPIC_API_KEY`, optional `CHAT_MODEL`.


## What was retired (2026-10-16)

The old chat widget is gone: its page template, the operator app shell, and every endpoint only it used (`/chat`, `/history`, `/save-*`, venue sign-up and team endpoints, `/kb-*`, `/storage/sign-upload`, `/admin-summary`, the weekly digest, vendor playbook and Slack/NPS helpers). `/` and `/app` now redirect to `/chat/`, and `/chat/<venue>` opens the new chat on that venue. `server.js` shrank from about 7,700 to about 2,000 lines: it now only loads the modern API and serves the **Stacked team admin dashboard** at `/admin` (password-protected: vendor intelligence, sign-ups, adoption, content), which stays until the Console replaces it.

Everything removed is recoverable from the git tag `legacy-chat-widget` (for example the tech-support vendor playbook, NPS ratings, and the weekly digest, if we port them).


## Vendor playbook and ratings (in the chat)

`src/modules/vendors/` holds Stacked's hospitality-technology support playbook, maintained by Stacked and not by customers: detailed troubleshooting profiles for the main vendors (`data/profiles.json`), support pages for about 117 vendors (`data/support-urls.json`) and about 225 recognised product names. When someone reports a technology fault, the chat gives the model the matching vendor notes (current message first, then the person's recent messages, then the venue's recorded tech stack), and returns a vendor support link as a button (the model is told never to write web addresses). A venue's tech stack (EPOS, payments, rota...) is set in Manage, Settings, Tech stack (`venues.tech_stack`), so the chat never asks "which till do you use?". Sources are shown only when the answer cites a document.

Ratings: when the person explicitly asks to rate a vendor the model adds `[NPS:vendor]`; the page shows a 0 to 10 card (also offered once after a couple of questions about a vendor). `POST /api/v1/chat/nps` saves to `nps_scores` and copies to the partner portal (`STACKCOLLECT_SUPABASE_URL` and `_KEY`, best effort, never blocks). Ratings are only ever triggered by what the person said, never a vendor the assistant mentioned in passing.


## Console (Stacked staff only)

`/console/` (web/console) and `src/modules/console/`: the staff-only replacement for the old admin dashboard. Access is by verified email on the `STACKED_STAFF_EMAILS` list (comma-separated); with the list empty the Console is closed to everyone, and a customer, even a company owner, gets 403. Views: **Overview** (customers, venues, people, monthly revenue, trial pipeline, questions, answer rate, and a "needs attention" list: payment failed or overdue, trial ending with no card, over the fair-use guides, cancelled), **Customers** (billing state, usage and flags per company, then a detail page with venues, people and that customer's unanswered questions), **Vendors** (vendor intelligence: mentions, problem types, example questions with emails and phone numbers removed, and NPS per technology partner) and **Gaps** (questions the AI could not answer across all customers, to decide what to teach the vendor playbook next). It reads everything with the service key in one load per view: fine at this size (usage covers the most recent 5,000 conversations in the period).


## server.js is now a front door (2026-10-16)

The old admin dashboard (`/admin`, its password login and its routes) is retired; the Console replaces it. `server.js` is about 80 lines: it starts the server, hands `/chat/`, `/manage/`, `/console/`, `/api/v1/*`, `/billing/webhook` and `/healthz` to the compiled app in `dist/`, answers `/health` for the host (even if the app failed to load), and redirects `/` and `/app` to `/chat/` and `/admin` to `/console/`. No page or route is defined in it any more. `STACKED_ADMIN_PASSWORD` is no longer used and can be deleted from the hosts. Everything that was removed is recoverable from the git tags `legacy-chat-widget` (the whole old server, admin included).


## Asking a person (hand-off)

Under the latest answer the chat offers **Ask my manager** (and, when the question was a technology fault, **Ask Stacked support**). `POST /api/v1/chat/help` takes the latest question and the assistant's answer from the person's own conversation, records a row in `tickets`, and then either emails the venue's managers and company admins (`chat/help.ts`: site managers first, never the asker, each once; the email replies straight to the person and links to Knowledge so the answer can be added for everyone) or posts a short alert to Stacked's Slack (`SLACK_WEBHOOK_URL`). A question to a manager stays inside the company: nothing about it goes to Stacked's Slack. Limited to 5 requests an hour per person. Text typed by the person is cleaned and HTML-escaped in the email.

## Adding customers, and how invitations become access

Stacked staff add a customer in the Console (Customers, Add customer): `POST /api/v1/console/customers` creates the organisation, its first venue and an **owner who is invited by email**, can start the 30-day trial, and pings Stacked's Slack (`console/customers.ts`). There is no self-serve sign-up: customers are added by Stacked, and everyone else joins by invitation.

An invited person is stored as `invited` and becomes `active` the first time they sign in with that email (the one-time code proves the address is theirs): `linkUser` activates invited rows and only links the rest (a disabled person stays disabled). That check runs at most once a minute per person, so an invitation sent while someone is already signed in is picked up without a restart. (This was missing before 2026-10-16: invited people could not get in.)

## Sensitive topics (2026-10-17)

Some questions should not be handled by the AI alone. `src/modules/sensitive/` holds four topics, each with a mode:

- **allergens** (`confirm`): the AI still answers, only from the company's own documents (the allergen rule in `chat/prompt.ts` is always on), and the reply gets "Always confirm with your manager or the kitchen before serving." (before any `Source:` line, not repeated if the answer already says it).
- **incidents**, **hr**, **legal** (`manager`): the AI is not called. The person gets a fixed reply (incidents includes "call 999") and a promoted **Ask my manager** button. These do not count as AI questions (no `onAnswered`), are saved in the conversation so the button can send them, and are not Insights gaps.

Detection (`topics.ts`) is plain keyword matching on what the person typed, not another AI call, so it is instant, free and testable. Priority when several match: incidents, hr, legal, then allergens. It deliberately errs towards sending a borderline question to a person.

Company admins (owner, hq_admin) switch each topic on or off under Settings, Sensitive topics (`GET /api/v1/orgs/:orgId/sensitive-topics`, `PUT .../:topic`). **Everything is ON by default**: the table `sensitive_topic_settings` (migration 012) only stores the switches an admin has turned off. Reads are cached 30 seconds and cleared on every change; if the database cannot be read, every topic counts as ON (the safe way round). The hand-off email to managers is flagged with the topic while it is on. The chat API returns `sensitive: { topic, label, mode } | null` so the screen can show "This one needs a person" or "Check before you serve".

Shared front-end note: `web/manage/dom.js` makes `Element.append/prepend` ignore null, undefined and false, so optional pieces can never print the words "null" or "false" on a page.

## Owner sign-up (2026-10-17)

A business owner starts their own 30-day trial at **`/start/`** (the front page `/` now redirects there; the staff chat is `/chat/`, owners and managers sign in at `/manage/`, and both sign-in screens link to `/start/`). The page (`web/start/`, plain HTML/CSS/JS reusing Manage's styles) posts one form to the public `POST /api/v1/signup`. That runs `signup/service.ts`, which is exactly Console "Add customer" (`createCustomers`): the company, its first venue, the owner as an **invited** member, the trial with no card, and a Slack alert marked "self-serve sign-up". The owner gets a **welcome email** (`welcomeEmail`, not an "invited by the Stacked team" email) with a link to `/manage/`; signing in with the emailed one-time code activates them, so only whoever can read that inbox can use the account.

Safeguards: an address that already belongs to anyone (`Repo.emailInUse`, any status) creates nothing and sends nothing; the response is the same `{ ok: true }` either way, so it reveals nothing about who is a customer; a hidden `website` field that is filled in, or a form submitted in under 800 ms, gets the same `{ ok: true }` and creates nothing; names must be plain text (no `<>`, no web addresses); limits per hour of 5 per IP, 3 per email and 100 in total (429 with Retry-After); the page's content policy allows no outside connections. No database change. Not done on purpose: no card at sign-up, no email verification step beyond the sign-in code, no CAPTCHA (add Cloudflare Turnstile if abuse appears).

## Pictures (dishes, drink specs)

- **Upload:** `POST /api/v1/orgs/:orgId/knowledge/upload-image?filename=…[&site_id=…]` takes the raw PNG/JPEG/WebP (sniffed from the bytes, max 10 MB), stores it in the private bucket at `images/<orgId>/<ts>-<name>` via `storage.uploadObject`, and adds a DRAFT knowledge item of kind `image`. The Manage page shrinks big phone photos to 2000px JPEG first.
- **Details:** an image's `description` (up to 4000 chars) is searched like a document passage (`retrievePassages`), so staff can ask "how much coffee liqueur in an espresso martini?". The picture behind the top passages is shown with the answer (`imagesBehind`), or on request ("photo of…", `pickMedia`).
- **Read the text from a picture:** `POST …/knowledge/:id/read-picture` fetches the stored picture, asks the model (`vision.ts`, image block, 5 MB cap) to copy out the writing, and returns it. Nothing is saved: the manager checks it, edits the description, then publishes.
- **Previews:** the detail endpoint returns a short-lived signed `preview_url`; Manage's CSP allows images from the Supabase origin for this.

## Operations: checklists

- **Tables (migration 013):** `checklists` (title, kind opening/closing/custom, items `[{id,text}]`, `site_id` null = every venue, active) and `checklist_runs` (one shared run per checklist, per venue, per UK day; `ticks` = `{itemId: {by, at}}`, `completed_by/at`, `note`).
- **Managers:** `GET/POST /api/v1/orgs/:orgId/checklists`, `PATCH/DELETE …/:id`, `GET …/board?days=7` (today per venue they run, plus recent). Same write rule as people and knowledge (`canManageMembers`): admins for the whole company, site managers for their own venue.
- **Staff:** `GET /api/v1/chat/checklists?site_id=`, `POST …/:id/tick`, `POST …/:id/complete` (in the chat routes, any member of the venue). Finishing with items unticked needs a note. A finished run is locked for the day.
- **Manage:** Operations screen (today board, checklists, last 7 days). **Chat:** a clipboard button in the header (only shown when the venue has lists), with a count of lists not finished.
- Items keep their id when a list is edited, so earlier ticks survive. Ticks for removed items are ignored.

### Checklist reminders

- **Set per checklist:** `due_time` ("HH:MM", UK time) and `remind_days` (0 = Sunday … 6 = Saturday). No due time = no reminder (migration 014).
- **The job** (`operations/reminders.ts`) runs every 5 minutes inside the server (`src/index.ts`; `DISABLE_REMINDERS=1` switches it off) and on `POST /api/v1/internal/operations/remind` with `x-cron-secret` (an optional external scheduler). From the due time until 3 hours after it, for every venue where the run is not finished, it emails that venue's active site managers, or the company's owner/HQ admins if the venue has none.
- **Once only:** the first server to insert a `checklist_reminders` row for (checklist, venue, day) sends; everyone else skips. A failed email is logged and not retried that day.
- Needs email (`RESEND_API_KEY`) to be configured; otherwise it does nothing. Manage's board marks a list "Overdue" using the same rule.
