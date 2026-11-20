// The single seam between our platform and the third-party vendor
// Commission Quote API. Responsibilities (and nothing else):
//   1. Hold the API key (from env — never hardcoded, never exposed upward)
//   2. Enforce a per-attempt timeout and an overall deadline
//   3. Retry transient failures (network errors, 5xx, 429) with backoff,
//      reusing one idempotency key so a retry can't create a second quote
//   4. Validate the vendor's response against the shared contract
//   5. Translate every failure mode into ONE typed error the rest of
//      the app (and the UI) can reason about

import { randomUUID } from "node:crypto";
import { API_KEY_HEADER, QuoteResponseSchema, type QuoteRequest, type QuoteResponse } from "@commission-quote/contract";
import type { QuoteProvider } from "./quote-provider";

export type VendorClientErrorCode = "VENDOR_TIMEOUT" | "SERVICE_UNAVAILABLE" | "VENDOR_ERROR";

/** Typed failure this client surfaces. `message` is always user-safe. */
export class VendorClientError extends Error {
  override readonly name = "VendorClientError";

  constructor(
    readonly code: VendorClientErrorCode,
    message: string,
    /** Server-side hint (ms) from a Retry-After header, if any. */
    readonly retryAfterMs?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }

  get retryable(): boolean {
    return this.code !== "VENDOR_ERROR";
  }
}

export interface VendorClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number; // per-attempt timeout
  totalTimeoutMs?: number; // overall deadline across all attempts and backoff
  maxAttempts?: number; // total attempts (retries = maxAttempts - 1)
  baseDelayMs?: number; // backoff base
  maxDelayMs?: number; // backoff cap (also caps Retry-After)
}

const DEFAULTS = {
  timeoutMs: 3_000,
  totalTimeoutMs: 8_000,
  maxAttempts: 3,
  baseDelayMs: 400,
  maxDelayMs: 5_000,
};

function isTimeout(err: unknown): boolean {
  // AbortSignal.timeout rejects with a DOMException named "TimeoutError".
  // DOMException is not reliably instanceof Error, so duck-type on .name.
  return (err as { name?: unknown } | null)?.name === "TimeoutError";
}

/** Parses Retry-After (delta-seconds or HTTP date) into milliseconds. */
function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1_000);
  const date = Date.parse(header);
  return Number.isNaN(date) ? undefined : Math.max(0, date - Date.now());
}

export class VendorQuoteClient implements QuoteProvider {
  private readonly cfg: Required<VendorClientConfig>;

  constructor(config: VendorClientConfig) {
    this.cfg = { ...DEFAULTS, ...config };
  }

  async generateQuote(request: QuoteRequest): Promise<QuoteResponse> {
    // One key for every attempt of this logical request: if a timed-out
    // attempt actually reached the vendor, the retry returns the same
    // quote instead of creating a duplicate.
    const idempotencyKey = randomUUID();
    const deadline = Date.now() + this.cfg.totalTimeoutMs;
    let lastError: VendorClientError | undefined;

    for (let attempt = 1; attempt <= this.cfg.maxAttempts; attempt++) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) break;

      try {
        return await this.attemptQuote(request, idempotencyKey, Math.min(this.cfg.timeoutMs, remaining));
      } catch (err) {
        lastError =
          err instanceof VendorClientError
            ? err
            : new VendorClientError("VENDOR_ERROR", "Unexpected error talking to the vendor.", undefined, {
                cause: err,
              });

        if (!lastError.retryable || attempt === this.cfg.maxAttempts) break;

        const delay = this.backoffDelay(attempt, lastError.retryAfterMs);
        if (Date.now() + delay >= deadline) break; // no time left for another attempt
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    throw lastError ?? new VendorClientError("VENDOR_TIMEOUT", "Vendor timed out.");
  }

  private async attemptQuote(request: QuoteRequest, idempotencyKey: string, timeoutMs: number): Promise<QuoteResponse> {
    // The signal covers the whole exchange — headers AND body — so a
    // vendor that stalls mid-body is also caught as a timeout.
    const signal = AbortSignal.timeout(timeoutMs);

    let response: Response;
    try {
      response = await fetch(`${this.cfg.baseUrl}/quotes`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          [API_KEY_HEADER]: this.cfg.apiKey,
          "idempotency-key": idempotencyKey,
        },
        body: JSON.stringify(request),
        signal,
      });
    } catch (err) {
      if (isTimeout(err)) {
        throw new VendorClientError("VENDOR_TIMEOUT", "Vendor timed out.", undefined, { cause: err });
      }
      // Connection refused, DNS failure, reset — transient, retry it.
      throw new VendorClientError("SERVICE_UNAVAILABLE", "Vendor unreachable.", undefined, { cause: err });
    }

    if (response.status >= 500 || response.status === 429) {
      await response.body?.cancel().catch(() => {});
      throw new VendorClientError(
        "SERVICE_UNAVAILABLE",
        "Vendor temporarily unavailable.",
        parseRetryAfter(response.headers.get("retry-after")),
      );
    }

    // Auth/validation problems on OUR side of the fence are bugs or
    // misconfiguration — retrying won't help, fail fast.
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new VendorClientError("VENDOR_ERROR", `Unexpected vendor response (HTTP ${response.status}).`);
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch (err) {
      if (isTimeout(err)) {
        throw new VendorClientError("VENDOR_TIMEOUT", "Vendor timed out.", undefined, { cause: err });
      }
      // Not JSON, or the connection dropped mid-body.
      throw new VendorClientError("VENDOR_ERROR", "Vendor returned an unreadable response.", undefined, {
        cause: err,
      });
    }

    // The vendor is external — never trust the payload shape.
    // Validate against the shared contract before it enters our domain.
    const parsed = QuoteResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw new VendorClientError("VENDOR_ERROR", "Vendor returned a malformed quote.");
    }

    return parsed.data;
  }

  /**
   * Exponential backoff with jitter: attempt 1 waits 50–100% of
   * baseDelayMs, attempt 2 50–100% of 2×baseDelayMs, and so on, capped
   * at maxDelayMs. A vendor Retry-After hint wins if it is longer.
   */
  private backoffDelay(attempt: number, retryAfterMs?: number): number {
    const exp = Math.min(this.cfg.baseDelayMs * 2 ** (attempt - 1), this.cfg.maxDelayMs);
    const jittered = exp * (0.5 + Math.random() * 0.5);
    return Math.min(Math.max(jittered, retryAfterMs ?? 0), this.cfg.maxDelayMs);
  }
}
