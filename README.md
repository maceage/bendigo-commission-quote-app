# Commission Quote App

A take-home submission: a web application for staff to generate commission quotes for loan applications, backed by a mock of the third-party vendor Commission Quote API.

## Architecture

```
┌──────────────┐  POST /api/quotes   ┌────────────────┐  POST /quotes    ┌───────────────┐
│  Browser     │ ──────────────────► │ quote-service  │ ───────────────► │ vendor-api    │
│  (React)     │ ◄────────────────── │ (Express, :4000│ ◄─────────────── │ (Express,:4001│
│  :5173       │   JSON envelope     │  owns API key, │  api-key header  │  mock, random │
└──────────────┘                     │  retry+timeout │                  │  failures     │
        ▲                            └───────┬────────┘                  └───────────────┘
        │ same-origin /api                    │
        └────── Vite dev proxy (dev only) ────┘
```

Key points:

- **The browser never touches the vendor and never holds the API key.** All vendor communication is proxied through `quote-service`, which is the sole custodian of `VENDOR_API_KEY` (loaded from environment, injected once at startup).
- **The shared contract lives in one package** (`packages/contract`): request/response/error schemas defined once with Zod, imported by the mock vendor, the backend, and the front-end. The contract is the interface - not either implementation.
- **Resilience at one seam**: per-attempt timeouts, an overall deadline (8s), and bounded retry with jittered backoff (honouring `Retry-After`) live in `vendor-client.ts`. Every attempt of one logical request carries the same `Idempotency-Key`, so a retry after a timeout can't create a duplicate quote; the mock vendor honours it. Every failure mode is classified into a typed `VendorClientError` (`VENDOR_TIMEOUT` / `SERVICE_UNAVAILABLE` / `VENDOR_ERROR`), which the route layer maps to HTTP 504 / 503 / 502. Validation errors are 400; unexpected bugs are 500 `INTERNAL_ERROR` with details logged server-side only. The status for each code is defined once in the contract (`QUOTE_ERROR_STATUS`), and the UI receives one uniform error envelope for all of them.
- **One validation schema**: the front-end form validates with the same `QuoteRequestSchema` as the backend, so their limits and messages can't drift apart.

## Tech stack

TypeScript throughout (one language, shared types across all packages), npm workspaces monorepo:

| Package                  | Role                                                                                                      |
| ------------------------ | --------------------------------------------------------------------------------------------------------- |
| `packages/contract`      | Shared domain types + Zod schemas (single source of truth)                                                |
| `packages/vendor-api`    | Mock third-party Commission Quote API (API-key auth, simulated latency, random 20% failures and 5% hangs) |
| `packages/quote-service` | Our backend: validation, API-key custody, retry/timeout, error mapping                                    |
| `packages/web`           | React + Vite front-end (form, loading/error/success states)                                               |

Tests: Vitest. No ORM/database - deliberately out of scope for this challenge.

## Prerequisites

- **Node.js 22.19+**: the web tests' DOM environment (jsdom, via its `undici` dependency) requires it. Node also provides the built-in `--env-file` support the backends use, so no dotenv dependency is needed. An `.nvmrc` is provided.

## Setup

```bash
# 1. Install all workspace dependencies (run from the repo root)
npm install

# 2. Configure: copy the example env file and fill it in
cp .env.example .env
# The only required value is VENDOR_API_KEY (any non-empty string for local dev)
```

The `.env` file sits at the repo root; both backend services read it via `--env-file=../../.env`. It is gitignored - never commit it.

## Running the app

From the repo root:

```bash
npm run dev
```

This starts all three components with `concurrently` (colour-coded output):

- `[vendor]` - mock vendor API on **http://localhost:4001**
- `[service]` - quote-service on **http://localhost:4000**
- `[web]` - front-end on **http://localhost:5173**

Open **http://localhost:5173**, enter loan details, and press **Generate Quote**.

By default roughly 1 in 5 vendor calls hits the simulated random failure. quote-service retries up to 3 times, so a user only sees an error when every attempt fails (about 1 in 125 quotes). To see the error state on demand, set `VENDOR_FAILURE_RATE` in `.env` and restart: `1` fails every request (the UI shows "Quote service unavailable"), and a value like `0.7` gives a mix of successes and failures. It must be between 0 and 1, or the vendor exits at startup.

The vendor also never responds to about 1 in 20 calls, though it still issues the quote, like a response lost in transit. quote-service gives up on that attempt after 3s and retries with the same `Idempotency-Key`, so it receives the original quote rather than a duplicate. Set `VENDOR_TIMEOUT_RATE=1` to make every attempt hang: after about 8s the UI shows "The quote provider timed out".

All services fail fast at startup if `VENDOR_API_KEY` is missing: the process exits with a clear message rather than starting insecure. Both backends expose `GET /healthz`.

### Production build

```bash
npm run build                                   # type-checks web, bundles each backend to dist/server.cjs
VENDOR_API_KEY=... npm start -w packages/vendor-api
VENDOR_API_KEY=... npm start -w packages/quote-service
```

In production the environment supplies `VENDOR_API_KEY` (no `.env` file is read), and `packages/web/dist` is served behind a reverse proxy that routes `/api` to quote-service.

## Quality checks

```bash
npm run check   # format:check + lint + typecheck + test — the same steps CI runs
```

Individual steps: `npm run lint`, `npm run typecheck`, `npm run format` (Prettier, writes), `npm run format:check`. GitHub Actions (`.github/workflows/ci-checks.yml`) runs them, plus the build, on Node 22 and 24.

## Running the tests

From the repo root:

```bash
npm test
```

runs every package's suite. To run a single package's tests:

```bash
npm test -w packages/vendor-api
npm test -w packages/quote-service
npm test -w packages/web
```

### What is tested, and why

- **vendor-api / auth** - the security requirement: requests without a valid `api-key` header (the name the contract specifies, defined once as `API_KEY_HEADER` in the contract package) are rejected 401; wrong key is indistinguishable from missing key, and a key under any other header name is ignored.
- **vendor-api / quote** - responses validate against the shared `QuoteResponseSchema`; invalid payloads (negative amount, bad risk band, string-typed number, malformed JSON) return 400; a repeated `Idempotency-Key` returns the original quote; the simulation knobs (`failureRate: 1`, `timeoutRate: 1`) prove the random-error and never-responds behaviour deterministically.
- **quote-service / routes** - with a stubbed `QuoteProvider` (no sockets): validation happens _before_ the vendor is called; typed vendor failures map to 504/503/502; internal error details never leak to the client while still being logged server-side; an error that merely _looks_ typed (e.g. a `DOMException` with a numeric `code`) still gets a clean 500 instead of crashing the handler; malformed JSON returns 400 and oversized bodies 413.
- **quote-service / vendor-client** - against a real throwaway HTTP server: success, retry-then-succeed on a transient 500, exhaustion → `SERVICE_UNAVAILABLE`, 429 with `Retry-After`, hung vendor → `VENDOR_TIMEOUT`, a vendor that stalls mid-body → `VENDOR_TIMEOUT`, the overall deadline, the same idempotency key across retries, unreachable vendor, and non-retryable failures (401, malformed or non-JSON 200) failing fast.
- **quote-service / end-to-end** - quote-service's app, `QuoteService` and `VendorQuoteClient` against the real mock vendor over HTTP: a successful quote, a rejected key → 502, persistent failures → 503, and a vendor that never responds → 504. The only suite where both sides are real, so it catches them drifting apart (e.g. on the API key header name).
- **web / quoteApi** - with a stubbed `fetch`: success, backend envelopes passed through, unknown error codes and non-JSON error bodies normalised, invalid 200 bodies rejected, network failure, client-side timeout, caller cancellation.
- **web / useQuote** - state transitions, and that the _newest_ request wins when responses arrive out of order (superseded requests are aborted, as is the in-flight one on unmount).
- **web / QuoteForm** - numbers (not strings) are submitted; blank, over-limit and fractional inputs show the shared schema's messages per field; errors clear on edit; everything is disabled while loading.

Randomness is made deterministic via injected config (`failureRate` and `timeoutRate` of 0 or 1, fixed latency, fast backoff) rather than sleeps or flaky probabilistic assertions.

## Project structure

```
packages/
├── contract/        # shared types + Zod schemas (the agreed contract)
├── vendor-api/      # mock third-party vendor (auth middleware, quote engine, failure simulation)
├── quote-service/   # our backend (routes, QuoteService, vendor client with retry/timeout/idempotency, error mapping)
└── web/             # React front-end (form, useQuote state machine, result/alert components)
```

## AI usage (transparency statement)

This challenge was completed with AI assistance, used in the following ways:

- **Architecture and scaffolding**: I discussed stack and directory-structure options with Claude & Lumo and generated the workspace manifests, tsconfig set, and initial skeletons of the mock vendor, quote-service, and front-end as a starting point.
- **Debugging**: AI helped diagnose environment issues (npm workspace resolution, env-file loading with npm workspaces' cwd behaviour) and one real defect: an unclassified abort error that escaped the vendor client as a raw `DOMException` - caught by the timeout test, fixed by classifying `TimeoutError` explicitly.
- **Tests**: test structure and cases were drafted collaboratively with AI, then reviewed, run, and adjusted by me; the test strategy (which layers to test and why) is my own.
- **Code review and fixes (Claude Code)**: I had Claude Code review the codebase and fix what it found: a vendor-error crash, stale responses, a broken typecheck/build, plus added web tests, ESLint, Prettier and CI.
- **Gap analysis against the brief (Claude Code)**: I had Claude Code compare the implementation with the challenge brief, then chose which gaps to fix. It made each fix as a separate commit: the vendor header renamed to `api-key` as the contract specifies, configurable vendor failure and timeout simulation (`VENDOR_FAILURE_RATE`, `VENDOR_TIMEOUT_RATE`), an end-to-end test of quote-service against the real mock vendor, and accepting any non-empty `quoteId`. It also diagnosed CI failing on Node 20 (jsdom's `undici` dependency needs Node 22.19+) and moved CI to Node 22 and 24. [`CLAUDE.md`](CLAUDE.md) holds the project guidance Claude Code works from.

Every design decision - the contract-package approach, API-key custody in the backend only, retry classification, the error-envelope contract - was chosen, reviewed, and understood by me, and I can explain and modify any part of the codebase. I treated the AI output as a fast-moving junior pair programmer whose work always needed review, not as an oracle.

## Known trade-offs / what I'd do with more time

- **Deploy story**: backends bundle with esbuild, but there's no Dockerfile or deployment config.
- **The dev proxy is dev-only**: in production the front-end and quote-service would sit behind a reverse proxy doing the same `/api` routing.
- **`QuoteService` is currently a pass-through** - wired in, and deliberately kept as a seam for caching, rate limiting, or auditing when the app grows.
- **The mock's idempotency store is in memory** (last 1,000 keys) - fine for a mock; a real vendor would persist it.
- **Money as floats**: totals are rounded to cents, but a real lending platform should use integer cents or a decimal type end-to-end.
- **Observability**: structured logging and request IDs instead of `console.*`.

## Assumptions

- Commission rates by risk band (LOW 2%, MEDIUM 3.5%, HIGH 6%) are illustrative - the vendor is a mock.
- `commissionRate` is a fraction (0–1), rendered as a percentage in the UI; this is specified in the shared contract to avoid the classic fraction-vs-percent ambiguity. The brief doesn't say which the vendor sends, so this needs confirming with them: a vendor sending percentages (e.g. `3.5`) would have every quote rejected as `VENDOR_ERROR`.
- `quoteId` is treated as an opaque, non-empty string. The brief doesn't specify a format, so the contract doesn't require one (the mock happens to issue UUIDs).
- Loan amount/term bounds (max 600 months, etc.) are sensible defaults for demonstration, not business rules.
