# Claude Code session: review and fixes

This file records a Claude Code session on this repository (2026-11-16): a review of the codebase, the fixes made in response, and how they were committed.

## 1. Review

The starting point (`e4ae597`) was in good shape: clean layering, a shared Zod contract package, the API key held only by the backend, and tests made deterministic through injected config. The review found the following, ordered by severity.

### Bugs

- **A slow vendor could crash quote-service.** The per-attempt timeout signal also covers reading the response body. If the vendor sent headers and then stalled, `response.json()` threw an unclassified `DOMException` (`TimeoutError`). That error has a numeric `code` (23) and a `message`, so it passed the route's `"code" in failure` duck-type check. `statusFor(23)` returned `undefined`, `res.status(undefined)` threw inside an async Express 4 handler, and the resulting unhandled rejection crashes the process on current Node. A 200 with a non-JSON body also surfaced as 500 instead of 502.
- **The "newest request wins" logic was inverted.** `useQuote` discarded a result when the state was no longer `loading`. With two requests in flight, the first response set `success` and the second, newer one was then thrown away. It was hidden only because the form is disabled while loading.
- **Error bodies were trusted unchecked.** `parseErrorBody` cast any `{code, message}` body to `QuoteError` without checking that `code` was a known value, so an unknown code rendered an alert with no heading. `QuoteErrorSchema` existed in the contract but was never used.
- **Typecheck and build were broken.** `tsc --noEmit` failed in quote-service and vendor-api (test files), so their `build` scripts (which were just `tsc` with `noEmit`) failed. In web, `vite.config.ts` failed to type-check because Vite 6 and Vite 7 were both installed. `vite build` does not type-check, so web errors went unnoticed.

### Design issues

- `QuoteService` existed but was never wired in; `server.ts` injected `VendorQuoteClient` directly. It also depended on the concrete client class, which forced `as never` in its test.
- Unexpected (internal) failures were reported as `VENDOR_ERROR`, a misleading code.
- Timed-out POSTs were retried with no idempotency key, so a retry could create a duplicate quote at the vendor.
- No overall deadline: worst case was 3 × 3s plus backoff (over 10s), and the browser fetch never gave up. `Retry-After` was ignored.
- Form validation re-implemented part of the contract schema and missed the 600-month and $100M limits.

### Tests and cleanup

- The web package had no tests.
- No lint or format config, with mixed indentation (4 spaces in vendor-api, 2 elsewhere); no CI.
- Node version mismatch (`.env.example` said 18+, README said 20.6+); `.idea/` not ignored.
- Dead code: an unused `@contract` Vite alias, duplicate ZodError handling and a stray header comment in vendor-api.
- Comments addressed to a reviewer (e.g. "the reviewer may probe").
- The currency formatter was rebuilt on every render; the backoff comment's numbers didn't match the jittered values.

## 2. Changes made

### Contract (`packages/contract`)

- New `INTERNAL_ERROR` code and a `QUOTE_ERROR_STATUS` map, so each code's HTTP status is defined once.
- Validation messages rewritten for end users (e.g. "Loan amount must be greater than zero."), with `required_error` messages for blank input.
- `MAX_LOAN_AMOUNT` and `MAX_LOAN_TERM_MONTHS` exported for the form.

### quote-service

- `VendorClientError` class (`code`, user-safe `message`, `retryAfterMs`, `cause`) replaces thrown plain objects.
- Errors while reading the body are classified: timeout → `VENDOR_TIMEOUT`, unreadable body → `VENDOR_ERROR`.
- One `Idempotency-Key` per logical request, reused on every retry.
- Overall deadline (`totalTimeoutMs`, default 8s) across attempts and backoff; `Retry-After` honoured (capped).
- Routes use `instanceof VendorClientError` and pass anything else to the error handler via `next(err)` (needed on Express 4).
- Error handler returns 400 for malformed JSON, 413 for oversized bodies, and 500 `INTERNAL_ERROR` otherwise, logging details server-side only.
- `QuoteProvider` moved to its own file; `QuoteService` depends on it and is wired in `server.ts`.
- 10kb body limit, `/healthz`, `x-powered-by` disabled.

### vendor-api (mock)

- Honours `Idempotency-Key`: a repeated key returns the original quote (in-memory, last 1,000 keys).
- Malformed JSON → 400, oversized body → 413; errors routed through a single handler.
- Auth now runs before body parsing; `/healthz` added; dead code and reviewer comments removed.

### web

- `quoteApi`: validates error bodies with `QuoteErrorSchema`, supports a caller `AbortSignal`, and has a 15s timeout (`VENDOR_TIMEOUT`).
- `useQuote`: discriminated-union state; aborts superseded requests and the in-flight request on unmount.
- `QuoteForm`: validates with the shared `QuoteRequestSchema` and maps issues to fields; `min`/`max`/`step` attributes match the schema.
- `Alert`: heading for `INTERNAL_ERROR`. `QuoteResult`: formatters hoisted, rate shown with `Intl` percent formatting.
- Unused `@contract` alias removed; Vitest + jsdom configured.

### Tests (25 → 58)

- **quote-service / routes:** typed errors mapped to 504/503/502, untyped → 500 `INTERNAL_ERROR`, a regression test for an error that merely _looks_ typed (numeric `code`), the 601-month limit, 413, `/healthz`.
- **quote-service / vendor-client:** same idempotency key across retries and a fresh one per request, 429 + `Retry-After`, body stalled mid-stream → `VENDOR_TIMEOUT`, overall deadline, non-JSON 200, no retry on 401, unreachable vendor.
- **vendor-api:** malformed JSON → 400, idempotency-key replay.
- **web (new):** `quoteApi` (8 tests), `useQuote` including out-of-order responses and unmount (4), `QuoteForm` (6).

### Tooling

- Single Vite 7 install; `typecheck` script in every package.
- Backends bundle with esbuild to `dist/server.cjs` and gain `start` scripts; web `build` type-checks first.
- ESLint (typescript-eslint, react-hooks), Prettier (120 columns), `npm run check` (format check, lint, typecheck, test).
- GitHub Actions CI (`.github/workflows/ci.yml`) on Node 20 and 22, also running the build.
- `engines: node >=20.6`, `.nvmrc`, `.env.example` corrected, `.gitignore` adds `dist`, `coverage`, `.idea/`, etc.
- README updated (architecture, production build, quality checks, test coverage, trade-offs). The AI-usage statement was left as written.

## 3. Verification

- `npm run check` passes: formatting, lint, typecheck, and all 58 tests.
- `npm run build` succeeds for all three packages.
- Smoke test of the built bundles: quotes returned 200, invalid input returned 400 with a readable message, `/healthz` returned 200.

## 4. Commits (branch `claude`, on top of `master` at `e4ae597`)

| Commit    | Content                                                                                     |
| --------- | ------------------------------------------------------------------------------------------- |
| `f941844` | Add Prettier config and format codebase. Formatting only; the original 25 tests still pass. |
| `5b091cb` | Fix vendor-error crash, stale responses and broken build; add tests and tooling.            |

The first attempt to split the commits hit two problems: `git checkout -b claude` failed because the branch already existed (it was already the current branch, at the same commit as `master`), and restoring the original `.gitignore` caused `.idea/` and `dist/` to be staged. Both were caught before committing; the final work was backed up as a git tree throughout, and the committed result was confirmed to match it exactly. A lockfile change npm made afterwards (copying the new `engines` field) was amended into the second commit before anything was pushed.

## 5. Open items

- **`npm audit` reports 11 advisories**, all needing major upgrades, so they were left alone:
  - zod (high): fixed in Zod 4. The advisory concerns oversized constrained collections; these schemas have none, and bodies are capped at 10kb.
  - tinypool (critical): used only by the test runner; fixed by moving to Vitest 5.
- **Express stays on version 4.** Async route errors are forwarded by hand with `next(err)`; Express 5 would do this automatically.
- **Still open from the README's trade-offs:** money as floats, structured logging and request IDs, a Dockerfile or deployment config, and a persistent idempotency store.
- **The README's AI-usage statement** predates this session and may need updating to cover it.
