# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A take-home challenge submission (brief: `Code Challenge 28 Oct.pdf`): a web app for staff to request commission quotes for loans, plus a **mock** of a third-party vendor Commission Quote API. The codebase will be extended in a live pair-programming session, so changes should keep the existing structure easy to walk through.

TypeScript npm-workspaces monorepo, Node 22.19+ (`.nvmrc`; jsdom's undici dependency needs it). Vitest everywhere, Express 5 backends, React 19 + Vite front-end, Zod for schemas.

## Commands

Run from the repo root. Copy `.env.example` to `.env` first; both backends need `VENDOR_API_KEY` and exit at startup without it (they read `../../.env` via `--env-file`). Optional `VENDOR_FAILURE_RATE` (0–1, default 0.2) sets the mock vendor's random failure rate; set it to `1` to see the UI's error state, since retries hide most failures. Likewise `VENDOR_TIMEOUT_RATE` (default 0.05) makes the vendor never respond; `1` shows the UI's timeout error.

```bash
npm install
npm run dev            # vendor-api :4001, quote-service :4000, web :5173 (concurrently)
npm test               # every package's Vitest suite
npm run check          # format:check + lint + typecheck + test (what CI runs, plus build)
npm run build          # web: tsc + vite build; backends: esbuild bundle to dist/server.cjs
npm run lint | typecheck | format | format:check
docker compose up --build   # whole app via nginx on :8080 (needs VENDOR_API_KEY in .env or the shell)
```

Single package / single test:

```bash
npm test -w packages/quote-service
npm test -w packages/quote-service -- tests/services/vendor-client.test.ts
npm test -w packages/web -- -t "newest request wins"
```

CI (`.github/workflows/ci-checks.yml`) runs format:check, lint, typecheck, test and build on Node 22 and 24, so code must pass Prettier. A `DockerSmokeTest` job builds the images with Compose and requests a quote through nginx.

Docker Desktop is installed on the dev machine, so test Docker, nginx or Compose changes locally before pushing: `docker compose up --build --detach --wait`, then `curl` http://localhost:8080 (the page, and `POST /api/quotes`), and `docker compose down` when done. To exercise an error path, recreate just the vendor with a setting forced on, e.g. `VENDOR_TIMEOUT_RATE=1 docker compose up -d --wait vendor-api` (expect a 504 after about 8s), then run it again without the variable to restore the defaults. Recreating a container discards its logs, so read `docker compose logs` before recreating it. A shell started before Docker was installed may not have `docker` on its PATH (it lives in `C:\Users\Mace\AppData\Local\Programs\DockerDesktop\resources\bin`).

Docker: `docker/backend.Dockerfile` builds either backend (`PACKAGE` build arg) into an image holding only Node and the esbuild bundle (the bundle is self-contained, so no `node_modules`). `docker/web.Dockerfile` serves the Vite build with nginx (`docker/nginx.conf`), which proxies `/api` to quote-service; only nginx publishes a port. All images build from the repo root because the workspaces share one lockfile, so a new workspace package needs its `package.json` copied in both Dockerfiles before `npm ci`. Compose passes unset optional settings as empty strings, so the backends treat an empty env var as unset.

On Windows the checkout uses CRLF (`core.autocrlf=true`) while Prettier writes LF, so a repo-wide `npm run format` or `format:check` touches or flags every file. Format and check only the files you changed; git stores LF either way.

## Git

Always commit directly to `main`. Don't create feature branches, even though `main` is the default branch.

## Architecture

Request flow: browser → `POST /api/quotes` (Vite dev proxy) → **quote-service** → `POST /quotes` → **vendor-api** (mock).

- **`packages/contract`** is the single source of truth: `QuoteRequestSchema`, `QuoteResponseSchema`, `QuoteErrorSchema`, the error codes and their HTTP statuses (`QUOTE_ERROR_STATUS`), the loan limits, `API_KEY_HEADER` (`api-key`, the header name the brief's contract specifies) and `REQUEST_ID_HEADER` (`x-request-id`). It is consumed as TypeScript source (no build step). The front-end form, quote-service route and mock vendor all validate with these same schemas, so change limits/messages here, never locally.
- **`packages/vendor-api`** stands in for the external vendor. API-key auth middleware is mounted before all quote routes (constant-time compare; missing and wrong keys both return 401). It simulates latency, random 500s and random hangs (the quote is issued, but no response is sent); `createApp({ failureRate, timeoutRate, latencyMs })` makes these deterministic in tests, so tests expecting a reply must pass `timeoutRate: 0`. For an exact sequence of outcomes, pass `random`: a scripted source for the failure and hang rolls (a new quote rolls for failure, then for a hang; a replayed `Idempotency-Key` rolls only for a hang). It honours `Idempotency-Key` with an in-memory FIFO cache.
- **`packages/quote-service`** is our backend and the **only** holder of the vendor API key (injected once in `server.ts`, kept private in `VendorQuoteClient`). Layers: route (validate, then map errors) → `QuoteService` (deliberate pass-through seam for future caching/audit/rate-limiting) → `VendorQuoteClient`. The route depends on the `QuoteProvider` interface, so tests inject stubs. `tests/end-to-end.test.ts` is the one suite that runs quote-service against the real mock vendor (vendor-api exports `createApp` as `@commission-quote/vendor-api/app` for it), so it is what catches the two sides drifting apart.
  - `vendor-client.ts` holds all resilience logic: per-attempt timeout, an 8s overall deadline, bounded retry with jittered backoff honouring `Retry-After`, one idempotency key shared across retries, and validation of the vendor response. Every failure becomes a typed `VendorClientError` (`VENDOR_TIMEOUT` / `SERVICE_UNAVAILABLE` / `VENDOR_ERROR`); 4xx and malformed bodies are not retried.
  - Error responses all go through `send-error.ts`, which adds the request ID. Unexpected errors go to `middleware/error-handler.ts` as 500 `INTERNAL_ERROR` with details logged only. Express 5 forwards errors thrown or rejected by a handler, so async routes just `throw`; only errors raised in a later callback (e.g. the vendor's `setTimeout`) still need `next(err)`.
- **`packages/web`**: `api/quoteApi.ts` is the only network seam and turns every outcome (backend envelope, proxy HTML error page, network failure, 15s client timeout) into a `QuoteResult` union, so the UI renders exactly one error shape (`Alert`). `hooks/useQuote.ts` owns the idle/loading/success/error state and aborts superseded or unmounted requests so only the newest response renders. `QuoteForm` keeps inputs as strings and converts them to numbers at submit before running the shared schema.

## Conventions

- Apps are built by `createApp(...)` in `app.ts` without listening; `server.ts` is a thin launcher. Tests live in each package's `tests/` folder, mirroring `src/`: a test for `src/services/vendor-client.ts` is `tests/services/vendor-client.test.ts`, importing from `../../src/...`. Tests that span several files (e.g. `end-to-end.test.ts`) and shared helpers (`test-server.ts`) sit at the top of `tests/`. They hit the app in-process or on an ephemeral port (`tests/test-server.ts`), never a fixed port.
- Logging is pino, set up in each backend's `logger.ts` (duplicated, like `test-server.ts`), with `pino-http` assigning each request an ID that is echoed in `x-request-id`, put in error bodies and forwarded to the vendor. Use `req.log` inside a request so lines carry the `reqId`; quote-service passes it down as a `QuoteContext` (`requestId`, `log`) through `QuoteService` to `VendorQuoteClient`. Never use `console.*`. Logs are silent under Vitest; assert on them with `captureLogs()` from `test-server.ts`.
- Randomness and timing are made deterministic through injected config (failure rate 0/1, fixed latency, fast backoff), not sleeps or probabilistic assertions.
- `commissionRate` is a 0–1 fraction in the contract, formatted as a percentage only in `QuoteResult.tsx`; currency is AUD.
- Never do arithmetic on money as float dollars. Use `packages/contract/src/money.ts`: `toCents` on the way in, integer maths in cents (rates as basis points, via `applyBasisPoints`, rounding half up), `fromCents` only for the JSON contract and display. The wire format stays decimal numbers because that's the vendor's contract.
- The README has an "AI usage" section required by the brief; keep it accurate when AI-assisted changes land.
