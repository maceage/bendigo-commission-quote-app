# Commission Quote App

A take-home submission: a web application for staff to generate commission quotes for loan applications, backed by a mock of the third-party vendor Commission Quote API.

## Architecture

```
┌──────────────┐  POST /api/quotes   ┌────────────────┐  POST /quotes    ┌───────────────┐
│  Browser     │ ──────────────────► │ quote-service  │ ───────────────► │ vendor-api    │
│  (React)     │ ◄────────────────── │ (Express, :4000│ ◄─────────────── │ (Express,:4001│
│  :5173       │   JSON envelope     │  owns API key, │  x-api-key hdr   │  mock, random │
└──────────────┘                     │  retry+timeout │                  │  failures     │
        ▲                            └───────┬────────┘                  └───────────────┘
        │ same-origin /api                    │
        └────── Vite dev proxy (dev only) ────┘
```

Key points:

- **The browser never touches the vendor and never holds the API key.** All vendor communication is proxied through `quote-service`, which is the sole custodian of `VENDOR_API_KEY` (loaded from environment, injected once at startup).
- **The shared contract lives in one package** (`packages/contract`): request/response/error schemas defined once with Zod, imported by the mock vendor, the backend, and the front-end. The contract is the interface - not either implementation.
- **Resilience at one seam**: timeout and bounded retry with jittered backoff live in `vendor-client.ts`; every failure mode is classified into a typed error (`VENDOR_TIMEOUT` / `SERVICE_UNAVAILABLE` / `VENDOR_ERROR`), which the route layer maps to HTTP 504 / 503 / 502 respectively. Validation errors are 400. The UI receives one uniform error envelope for all of them.

## Tech stack

TypeScript throughout (one language, shared types across all packages), npm workspaces monorepo:

| Package | Role |
|---|---|
| `packages/contract` | Shared domain types + Zod schemas (single source of truth) |
| `packages/vendor-api` | Mock third-party Commission Quote API (API-key auth, simulated latency + random 20% failures) |
| `packages/quote-service` | Our backend: validation, API-key custody, retry/timeout, error mapping |
| `packages/web` | React + Vite front-end (form, loading/error/success states) |

Tests: Vitest. No ORM/database - deliberately out of scope for this challenge.

## Prerequisites

- **Node.js 20.6+** (for built-in `--env-file` support - no dotenv dependency needed)

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

Expect roughly 1 in 5 requests to hit the vendor's simulated random failure. The retry logic absorbs most of them invisibly; occasionally you will see a friendly "quote provider timed out / try again" message - that is the error path doing its job.

All services fail fast at startup if `VENDOR_API_KEY` is missing: the process exits with a clear message rather than starting insecure.

## Running the tests

From the repo root:

```bash
npm test
```

runs every package's suite. To run a single package's tests:

```bash
npm test -w packages/vendor-api
npm test -w packages/quote-service
```

### What is tested, and why

- **vendor-api / auth** - the security requirement: requests without a valid `x-api-key` are rejected 401; wrong key is indistinguishable from missing key.
- **vendor-api / quote** - responses validate against the shared `QuoteResponseSchema`; invalid payloads (negative amount, bad risk band, string-typed number) return 400; the failure simulation knob (`failureRate: 1`) proves the random-error behaviour deterministically.
- **quote-service / routes** - with a stubbed `QuoteProvider` (no sockets): validation happens *before* the vendor is called; typed vendor failures map to 504/503/502; internal error details never leak to the client while still being logged server-side; malformed JSON bodies return a clean 400.
- **quote-service / vendor-client** - against a real throwaway HTTP server: success, retry-then-succeed on a transient 500, exhaustion → `SERVICE_UNAVAILABLE`, hung vendor → `VENDOR_TIMEOUT`, and malformed 200 responses fail fast without retry.

Randomness is made deterministic via injected config (`failureRate: 0/1`, fixed latency, fast backoff) rather than sleeps or flaky probabilistic assertions.

## Project structure

```
packages/
├── contract/        # shared types + Zod schemas (the agreed contract)
├── vendor-api/      # mock third-party vendor (auth middleware, quote engine, failure simulation)
├── quote-service/   # our backend (routes, vendor client with retry/timeout, error mapping)
└── web/             # React front-end (form, useQuote state machine, result/alert components)
```

## AI usage (transparency statement)

This challenge was completed with AI assistance, used in the following ways:

- **Architecture and scaffolding**: I discussed stack and directory-structure options with Claude & Lumo and generated the workspace manifests, tsconfig set, and initial skeletons of the mock vendor, quote-service, and front-end as a starting point.
- **Debugging**: AI helped diagnose environment issues (npm workspace resolution, env-file loading with npm workspaces' cwd behaviour) and one real defect: an unclassified abort error that escaped the vendor client as a raw `DOMException` - caught by the timeout test, fixed by classifying `TimeoutError` explicitly.
- **Tests**: test structure and cases were drafted collaboratively with AI, then reviewed, run, and adjusted by me; the test strategy (which layers to test and why) is my own.

Every design decision - the contract-package approach, API-key custody in the backend only, retry classification, the error-envelope contract - was chosen, reviewed, and understood by me, and I can explain and modify any part of the codebase. I treated the AI output as a fast-moving junior pair programmer whose work always needed review, not as an oracle.

## Known trade-offs / what I'd do with more time

- **Build/deploy story**: the backends run via `tsx` in dev; a production build step (e.g. esbuild bundle + Docker) is not implemented.
- **The dev proxy is dev-only**: in production the front-end and quote-service would sit behind a reverse proxy doing the same `/api` routing.
- **`QuoteService` is currently a pass-through** - deliberately kept as a seam for caching, idempotency keys, or auditing when the app grows.
- **Money as floats**: totals are rounded to cents, but a real lending platform should use integer cents or a decimal type end-to-end.
- **No CI pipeline**: tests would run on every push (GitHub Actions) in a real repo.
- **Client-side/server-side validation duplication**: the form re-implements a subset of the contract schema in miniature; a shared form-level Zod schema could unify them.
- **Observability**: structured logging and request IDs instead of `console.*`.

## Assumptions

- Commission rates by risk band (LOW 2%, MEDIUM 3.5%, HIGH 6%) are illustrative - the vendor is a mock.
- `commissionRate` is a fraction (0–1), rendered as a percentage in the UI; this is specified in the shared contract to avoid the classic fraction-vs-percent ambiguity.
- Loan amount/term bounds (max 600 months, etc.) are sensible defaults for demonstration, not business rules.
