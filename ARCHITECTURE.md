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
