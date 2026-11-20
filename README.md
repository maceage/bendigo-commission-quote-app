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
- **Money never becomes a float**: `loanAmount` and `totalCommission` travel as decimal strings (`"250000.00"`) on every hop. The contract parses them straight into integer cents, the mock vendor computes commission in cents and basis points, and the UI formats the string as currency directly.
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

### Logs and request IDs

Both backends write structured JSON logs (pino) to stdout: one line per request with its status and duration, plus a line for every vendor attempt (attempt number, the vendor's status, duration, error code) and every retry. Set `LOG_LEVEL` (e.g. `debug`, `warn`) to change the detail; the default is `info`. The `api-key` header is redacted, so the key never reaches the logs.

Every request gets an ID, returned in the `x-request-id` response header. quote-service forwards it to the vendor, so both services log the request under the same ID. Error responses include it as `requestId`, and the UI shows it as a "Reference" under the error message, so a staff member can quote it and support can find exactly what happened.

### Production build

```bash
npm run build                                   # type-checks web, bundles each backend to dist/server.cjs
VENDOR_API_KEY=... npm start -w packages/vendor-api
VENDOR_API_KEY=... npm start -w packages/quote-service
```

In production the environment supplies `VENDOR_API_KEY` (no `.env` file is read), and `packages/web/dist` is served behind a reverse proxy that routes `/api` to quote-service, as in the Docker setup below.

### Running with Docker

With Docker and Docker Compose installed, from the repo root:

```bash
cp .env.example .env    # if you haven't already; Compose reads VENDOR_API_KEY etc. from it
docker compose up --build
```

Then open **http://localhost:8080**. This runs three containers:

- **web**: nginx serving the built front end and proxying `/api` to quote-service. This is the production replacement for Vite's dev proxy. It is the only container with a published port.
- **quote-service** and **vendor-api**: each image holds just Node and its esbuild bundle, running as the unprivileged `node` user. They are reachable only inside the Compose network.

Compose waits for each backend's `/healthz` before starting the next service, and refuses to start without `VENDOR_API_KEY`. The `.env` file is excluded from the build context, so the key is never baked into an image; it is passed at runtime. The same settings as `npm run dev` apply (`VENDOR_FAILURE_RATE`, `VENDOR_TIMEOUT_RATE`, `LOG_LEVEL`). The mock vendor keeps the quotes it has issued on a named volume (`vendor-data`), so a retry still gets the original quote after the vendor restarts. Stop with `Ctrl+C`, or `docker compose down` (add `--volumes` to forget the issued quotes).

## Quality checks

```bash
npm run check   # format:check + lint + typecheck + test — the same steps CI runs
```

Individual steps: `npm run lint`, `npm run typecheck`, `npm run format` (Prettier, writes), `npm run format:check`. GitHub Actions (`.github/workflows/ci-checks.yml`) runs them, plus the build, on Node 22 and 24. A second job runs `docker/smoke-test.sh`, which builds and starts the Docker stack and checks it through nginx: the page and its headers, deep links, a quote, a validation error, that the backends are private, that the vendor keeps issued quotes across a restart, and a 504 when the vendor hangs. You can run it yourself with `bash docker/smoke-test.sh`.

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

For a coverage report (in the terminal, plus HTML in each package's `coverage/` folder). It fails if any package's statement, branch, function or line coverage of `src/` drops below 90%, and CI runs it in place of `npm test`. The backends' `server.ts` launchers and the contract's re-exporting `index.ts` are left out, since tests build the apps with `createApp` and never run those files:

```bash
npm run test:coverage
npm run test:coverage -w packages/quote-service
```

### What is tested, and why

- **contract / money** - decimal strings to cents and back, including values floats can't hold exactly (e.g. 0.29); anything that isn't a plain amount with up to two decimal places (signs, exponents, commas, fractions of a cent, numbers too big to count exactly) is refused; commission in integer cents and basis points, rounded half up, checked against exact BigInt arithmetic for 20,000 amounts across the whole loan range.
- **contract / domain** - the loan amount's user-facing messages, one per problem (blank, not a number, a JSON number, fractions of a cent, zero or negative, over the limit), and which `totalCommission` values a vendor response may carry.
- **vendor-api / quote engine** - commission for amounts the old float maths rounded a half-cent down (e.g. $250,011.75 at 2% is $5,000.24, not $5,000.23), plus ordinary and maximum-size loans.
- **vendor-api / auth** - the security requirement: requests without a valid `api-key` header (the name the contract specifies, defined once as `API_KEY_HEADER` in the contract package) are rejected 401; wrong key is indistinguishable from missing key, and a key under any other header name is ignored. The key is also checked never to appear in the logs.
- **vendor-api / quote** - responses validate against the shared `QuoteResponseSchema`; invalid payloads (negative amount, bad risk band, an amount sent as a JSON number, malformed JSON) return 400; a repeated `Idempotency-Key` returns the original quote (even with the amount written differently, e.g. `"250000.00"`), while one reused for a different loan is refused with 422 and logged, and the original is kept; an invalid body is rejected even under a key used before; the simulation knobs (`failureRate: 1`, `timeoutRate: 1`) prove the random-error and never-responds behaviour deterministically; an oversized body returns 413; an unexpected error returns an opaque 500 while its details are logged; `/healthz` answers without an API key (as Compose's health check needs) and isn't logged; once the idempotency store is full, the oldest key is forgotten (in issue order, even if just replayed) and the rest are kept; given a file, a restarted vendor returns the original quote.
- **vendor-api / idempotency store** - the store on its own: eviction; no file unless given one; a missing file (and its folder) is created; a new store on the same file sees the quotes, in the same eviction order, trimmed to a smaller capacity; only kept keys are written, with no temporary file left behind; a corrupt file, or one whose quotes break the contract or lack their request's fingerprint, stops startup rather than being silently discarded; a request's fingerprint ignores how the amount is written, changes with any loan detail, and is a hash, so the file holds no loan details.
- **vendor-api / config, quote-service / config** - startup settings without starting a server: no or empty `VENDOR_API_KEY` is refused; defaults and overrides for the port, the vendor's URL and the simulation rates; empty settings count as unset (Compose passes unset settings as `""`); rates outside 0-1 are refused, while exactly 0 and 1 are accepted.
- **vendor-api / logger, quote-service / logger** - `LOG_LEVEL` is used when set, and an empty one falls back to the default instead of crashing.
- **quote-service / routes** - with a stubbed `QuoteProvider` (no sockets): validation happens _before_ the vendor is called; typed vendor failures map to 504/503/502; internal error details never leak to the client while still being logged server-side under the request ID the client was given; every response gets a request ID (a well-formed incoming one is reused, anything else replaced); an error that merely _looks_ typed (e.g. a `DOMException` with a numeric `code`) still gets a clean 500 instead of crashing the handler; malformed JSON returns 400 and oversized bodies 413.
- **quote-service / error handler** - what HTTP can't reach: an error raised after the response has started is handed back to Express rather than answered twice, and a thrown `null` still gets a clean 500.
- **quote-service / vendor-client** - against a real throwaway HTTP server: success, retry-then-succeed on a transient 500, exhaustion → `SERVICE_UNAVAILABLE`, 429 with `Retry-After` as seconds or an HTTP date (a past date retries straight away, an unreadable one falls back to normal backoff), hung vendor → `VENDOR_TIMEOUT`, a vendor that stalls mid-body → `VENDOR_TIMEOUT`, the overall deadline, the same idempotency key across retries, the request ID forwarded on every attempt, each attempt and retry logged, unreachable vendor, and non-retryable failures (401, malformed or non-JSON 200) failing fast.
- **quote-service / end-to-end** - quote-service's app, `QuoteService` and `VendorQuoteClient` against the real mock vendor over HTTP: a successful quote, a rejected key → 502, persistent failures → 503, a vendor that never responds → 504, recovery from a timed-out attempt with the quote that attempt issued (not a duplicate, using a scripted `random` to make the vendor hang once), and both services logging the request under one request ID. The only suite where both sides are real, so it catches them drifting apart (e.g. on the API key header name).
- **web / App** - the whole page with only `fetch` stubbed, covering the brief's UI requirements together: a disabled "Generating quote…" button while waiting, then the quote; an error with its heading, message and reference, then a retry that replaces it with the quote; and no API call for invalid input.
- **web / quoteApi** - with a stubbed `fetch`: success, backend envelopes passed through, unknown error codes and non-JSON error bodies normalised, invalid 200 bodies rejected, network failure, client-side timeout, caller cancellation.
- **web / useQuote** - state transitions, and that the _newest_ request wins when responses arrive out of order (superseded requests are aborted, as is the in-flight one on unmount).
- **web / Alert** - shows the request ID as a reference when the error has one, and nothing when it doesn't (e.g. a network failure).
- **web / QuoteResult** - the commission in AUD (`$8,750.00`), the 0-1 rate as a percentage (`0.035` shows as `3.5%`, never `350%` or `0.04%`), the quote reference, and that screen readers are told when the quote arrives.
- **web / QuoteForm** - numbers (not strings) are submitted; blank, over-limit and fractional inputs show the shared schema's messages per field; errors clear on edit; everything is disabled while loading.
- **Docker stack (`docker/smoke-test.sh`, run in CI)** - through nginx: the page with its security headers and no caching, long-term caching of fingerprinted assets, deep links falling back to the app, a quote with its request ID, a validation error, the backends unreachable from the host, a quote's `Idempotency-Key` still returning the original quote after the vendor's container is recreated (proving the volume is mounted and writable by the unprivileged user), and a 504 `VENDOR_TIMEOUT` that takes the full 8s when the vendor hangs (proving nginx doesn't cut off quote-service's deadline).

Randomness is made deterministic via injected config (`failureRate` and `timeoutRate` of 0 or 1, fixed latency, fast backoff) rather than sleeps or flaky probabilistic assertions.

## Project structure

```
packages/
├── contract/        # shared types + Zod schemas (the agreed contract)
├── vendor-api/      # mock third-party vendor (auth middleware, quote engine, failure simulation)
├── quote-service/   # our backend (routes, QuoteService, vendor client with retry/timeout/idempotency, error mapping)
└── web/             # React front-end (form, useQuote state machine, result/alert components)
docker/              # backend and web Dockerfiles, nginx config (used by docker-compose.yml)
```

Each package keeps its code in `src/` and its tests in `tests/`, which mirrors `src/`: `quote-service/tests/services/vendor-client.test.ts` tests `quote-service/src/services/vendor-client.ts`. Tests that span several files (like quote-service's `end-to-end.test.ts`) and shared test helpers sit at the top of `tests/`.

## AI usage (transparency statement)

This challenge was completed with AI assistance, used in the following ways:

- **Architecture and scaffolding**: I discussed stack and directory-structure options with Claude & Lumo and generated the workspace manifests, tsconfig set, and initial skeletons of the mock vendor, quote-service, and front-end as a starting point.
- **Debugging**: AI helped diagnose environment issues (npm workspace resolution, env-file loading with npm workspaces' cwd behaviour) and one real defect: an unclassified abort error that escaped the vendor client as a raw `DOMException` - caught by the timeout test, fixed by classifying `TimeoutError` explicitly.
- **Tests**: test structure and cases were drafted collaboratively with AI, then reviewed, run, and adjusted by me; the test strategy (which layers to test and why) is my own.
- **Code review and fixes (Claude Code)**: I had Claude Code review the codebase and fix what it found: a vendor-error crash, stale responses, a broken typecheck/build, plus added web tests, ESLint, Prettier and CI.
- **Gap analysis against the brief (Claude Code)**: I had Claude Code compare the implementation with the challenge brief, then chose which gaps to fix. It made each fix as a separate commit: the vendor header renamed to `api-key` as the contract specifies, configurable vendor failure and timeout simulation (`VENDOR_FAILURE_RATE`, `VENDOR_TIMEOUT_RATE`), an end-to-end test of quote-service against the real mock vendor, and accepting any non-empty `quoteId`. It also diagnosed CI failing on Node 20 (jsdom's `undici` dependency needs Node 22.19+) and moved CI to Node 22 and 24.
- **Exact money handling (Claude Code)**: Claude Code showed that float maths mis-rounded half-cent commissions (8,830 wrong results for loans up to $20,000). At my direction it moved the commission maths to integer cents and basis points, then made amounts travel as decimal strings so no hop reads them as floats.

[`CLAUDE.md`](CLAUDE.md) holds the project guidance Claude Code works from.

Every design decision - the contract-package approach, API-key custody in the backend only, retry classification, the error-envelope contract - was chosen, reviewed, and understood by me, and I can explain and modify any part of the codebase. I treated the AI output as a fast-moving junior pair programmer whose work always needed review, not as an oracle.

## Known trade-offs / what I'd do with more time

- **No staff login or rate limiting**: the brief describes a tool for staff, but anyone who can reach `/api/quotes` can request quotes, and as often as they like. Only the vendor API key is protected (it never leaves quote-service). In production I'd put the app behind the bank's single sign-on (e.g. OIDC at nginx or as quote-service middleware), record which staff member requested each quote, and rate-limit per user in the `QuoteService` seam so one client can't run up vendor calls.
- **Docker, but no deployment**: the Compose setup runs the whole app locally and is smoke-tested in CI, but images aren't published to a registry, there's no HTTPS (nginx listens on plain HTTP), and nothing targets a real platform (e.g. Kubernetes or a cloud container service). Base images use version tags rather than pinned digests.
- **`QuoteService` is currently a pass-through** - wired in, and deliberately kept as a seam for caching, rate limiting, or auditing when the app grows.
- **The mock's idempotency store is a JSON file** (last 1,000 keys; `VENDOR_IDEMPOTENCY_FILE`, on a volume under Docker): issued quotes survive a restart, but the whole file is rewritten for each new quote and only one vendor instance can use it. Keys never expire. A real vendor would keep them in a shared database with an expiry.
- **Logs only, no metrics or tracing**: request IDs link the two services' logs, but there are no metrics (e.g. vendor error rate, latency) or distributed tracing such as OpenTelemetry.

## Assumptions

- Commission rates by risk band (LOW 2%, MEDIUM 3.5%, HIGH 6%) are illustrative - the vendor is a mock.
- The mock rounds commission half up to the nearest cent (e.g. $5,000.235 becomes $5,000.24). The brief doesn't specify a rounding rule; a real vendor might use banker's rounding instead.
- `commissionRate` is a fraction (0–1), rendered as a percentage in the UI; this is specified in the shared contract to avoid the classic fraction-vs-percent ambiguity. The brief doesn't say which the vendor sends, so this needs confirming with them: a vendor sending percentages (e.g. `3.5`) would have every quote rejected as `VENDOR_ERROR`.
- Money amounts (`loanAmount`, `totalCommission`) are decimal strings with up to two places, e.g. `"250000.00"`. The brief names the fields but not their types; strings keep amounts exact on every hop, where JSON numbers are read as binary floats. This needs confirming with the vendor, like the rate format below. A vendor sending numbers would have every quote rejected as `VENDOR_ERROR`, and the fix would be a conversion in `vendor-client.ts` only.
- `quoteId` is treated as an opaque, non-empty string. The brief doesn't specify a format, so the contract doesn't require one (the mock happens to issue UUIDs).
- Loan amount/term bounds (max 600 months, etc.) are sensible defaults for demonstration, not business rules.
