# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A take-home challenge submission (brief: `Code Challenge 28 Oct.pdf`): a web app for staff to request commission quotes for loans, plus a **mock** of a third-party vendor Commission Quote API. The codebase will be extended in a live pair-programming session, so changes should keep the existing structure easy to walk through.

TypeScript npm-workspaces monorepo, Node 22.19+ (`.nvmrc`; jsdom's undici dependency needs it). Vitest everywhere, Express 4 backends, React 19 + Vite front-end, Zod for schemas.

## Commands

Run from the repo root. Copy `.env.example` to `.env` first; both backends need `VENDOR_API_KEY` and exit at startup without it (they read `../../.env` via `--env-file`). Optional `VENDOR_FAILURE_RATE` (0–1, default 0.2) sets the mock vendor's random failure rate; set it to `1` to see the UI's error state, since retries hide most failures.

```bash
npm install
npm run dev            # vendor-api :4001, quote-service :4000, web :5173 (concurrently)
npm test               # every package's Vitest suite
npm run check          # format:check + lint + typecheck + test (what CI runs, plus build)
npm run build          # web: tsc + vite build; backends: esbuild bundle to dist/server.cjs
npm run lint | typecheck | format | format:check
```

Single package / single test:

```bash
npm test -w packages/quote-service
npm test -w packages/quote-service -- src/__tests__/vendor-client.test.ts
npm test -w packages/web -- -t "newest request wins"
```

CI (`.github/workflows/ci.yml`) runs format:check, lint, typecheck, test and build on Node 22 and 24, so code must pass Prettier.

On Windows the checkout uses CRLF (`core.autocrlf=true`) while Prettier writes LF, so a repo-wide `npm run format` or `format:check` touches or flags every file. Format and check only the files you changed; git stores LF either way.

## Git

Always commit directly to `main`. Don't create feature branches, even though `main` is the default branch.

## Architecture

Request flow: browser → `POST /api/quotes` (Vite dev proxy) → **quote-service** → `POST /quotes` → **vendor-api** (mock).

- **`packages/contract`** is the single source of truth: `QuoteRequestSchema`, `QuoteResponseSchema`, `QuoteErrorSchema`, the error codes and their HTTP statuses (`QUOTE_ERROR_STATUS`), the loan limits, and `API_KEY_HEADER` (`api-key`, the header name the brief's contract specifies). It is consumed as TypeScript source (no build step). The front-end form, quote-service route and mock vendor all validate with these same schemas, so change limits/messages here, never locally.
- **`packages/vendor-api`** stands in for the external vendor. API-key auth middleware is mounted before all quote routes (constant-time compare; missing and wrong keys both return 401). It simulates latency and random 500s; `createApp({ failureRate, latencyMs })` makes these deterministic in tests. It honours `Idempotency-Key` with an in-memory FIFO cache.
- **`packages/quote-service`** is our backend and the **only** holder of the vendor API key (injected once in `server.ts`, kept private in `VendorQuoteClient`). Layers: route (validate, then map errors) → `QuoteService` (deliberate pass-through seam for future caching/audit/rate-limiting) → `VendorQuoteClient`. The route depends on the `QuoteProvider` interface, so tests inject stubs. `__tests__/end-to-end.test.ts` is the one suite that runs quote-service against the real mock vendor (vendor-api exports `createApp` as `@commission-quote/vendor-api/app` for it), so it is what catches the two sides drifting apart.
  - `vendor-client.ts` holds all resilience logic: per-attempt timeout, an 8s overall deadline, bounded retry with jittered backoff honouring `Retry-After`, one idempotency key shared across retries, and validation of the vendor response. Every failure becomes a typed `VendorClientError` (`VENDOR_TIMEOUT` / `SERVICE_UNAVAILABLE` / `VENDOR_ERROR`); 4xx and malformed bodies are not retried.
  - Unexpected errors go to `middleware/error-handler.ts` as 500 `INTERNAL_ERROR` with details logged only. Express 4 doesn't catch async rejections, so async handlers must call `next(err)` themselves.
- **`packages/web`**: `api/quoteApi.ts` is the only network seam and turns every outcome (backend envelope, proxy HTML error page, network failure, 15s client timeout) into a `QuoteResult` union, so the UI renders exactly one error shape (`Alert`). `hooks/useQuote.ts` owns the idle/loading/success/error state and aborts superseded or unmounted requests so only the newest response renders. `QuoteForm` keeps inputs as strings and converts them to numbers at submit before running the shared schema.

## Conventions

- Apps are built by `createApp(...)` in `app.ts` without listening; `server.ts` is a thin launcher. Tests hit the app in-process or on an ephemeral port (`__tests__/test-server.ts`), never a fixed port.
- Randomness and timing are made deterministic through injected config (failure rate 0/1, fixed latency, fast backoff), not sleeps or probabilistic assertions.
- `commissionRate` is a 0–1 fraction in the contract, formatted as a percentage only in `QuoteResult.tsx`; currency is AUD.
- The README has an "AI usage" section required by the brief; keep it accurate when AI-assisted changes land. `claude_changes.md` records an earlier Claude Code review session.
