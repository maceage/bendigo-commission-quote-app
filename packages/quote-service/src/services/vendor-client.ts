// The single seam between our platform and the third-party vendor
// Commission Quote API. Responsibilities (and nothing else):
//   1. Hold the API key (from env — never hardcoded, never exposed upward)
//   2. Enforce a per-attempt timeout
//   3. Retry transient failures (network errors, 5xx) with backoff
//   4. Validate the vendor's response against the shared contract
//   5. Translate every failure mode into ONE typed error the rest of
//      the app (and the UI) can reason about

import { QuoteResponseSchema, type QuoteRequest, type QuoteResponse } from "@commission-quote/contract";

/** Typed failures this client can surface. All carry a user-safe message. */
export type VendorClientError =
  | { code: "VENDOR_TIMEOUT"; message: string }
  | { code: "SERVICE_UNAVAILABLE"; message: string }
  | { code: "VENDOR_ERROR"; message: string };

interface VendorClientConfig {
  baseUrl: string;
  apiKey: string;
  timeoutMs?: number;    // per-attempt timeout
  maxAttempts?: number;  // total attempts (retries = maxAttempts - 1)
  baseDelayMs?: number;  // backoff base
}

const DEFAULTS = { timeoutMs: 3_000, maxAttempts: 3, baseDelayMs: 400 };

export class VendorQuoteClient {
  private readonly cfg: Required<VendorClientConfig>;

  constructor(config: VendorClientConfig) {
    this.cfg = { ...DEFAULTS, ...config };
  }

  async generateQuote(request: QuoteRequest): Promise<QuoteResponse> {
    let lastError: VendorClientError;

    for (let attempt = 1; attempt <= this.cfg.maxAttempts; attempt++) {
      try {
        return await this.attemptQuote(request);
      } catch (err) {
        lastError = err as VendorClientError;

        // Non-retryable: give up immediately, don't burn the clock.
        if ((err as VendorClientError).code === "VENDOR_ERROR") {
          throw err;
        }

        // Transient (timeout / unavailable): back off and retry, unless
        // this was the final attempt.
        if (attempt < this.cfg.maxAttempts) {
          await this.backoff(attempt);
        }
      }
    }

    throw lastError!;
  }

  private async attemptQuote(request: QuoteRequest): Promise<QuoteResponse> {
    const response = await fetch(`${this.cfg.baseUrl}/quotes`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": this.cfg.apiKey, // security lives here and nowhere else
      },
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(this.cfg.timeoutMs),
    });

    // Transient vendor-side failure (their simulated random errors
    // land here) -> caller decides whether to retry.
    if (response.status >= 500 || response.status === 429) {
      throw { code: "SERVICE_UNAVAILABLE", message: "Vendor temporarily unavailable." };
    }

    // Auth/validation problems on OUR side of the fence are bugs or
    // misconfiguration — retrying won't help, fail fast.
    if (!response.ok) {
      throw {
        code: "VENDOR_ERROR",
        message: `Unexpected vendor response (HTTP ${response.status}).`,
      };
    }

    const json: unknown = await response.json();

    // The vendor is external — never trust the payload shape.
    // Validate against the shared contract before it enters our domain.
    const parsed = QuoteResponseSchema.safeParse(json);
    if (!parsed.success) {
      throw {
        code: "VENDOR_ERROR",
        message: "Vendor returned a malformed quote.",
      };
    }

    return parsed.data;
  }

  /** Exponential backoff with jitter: 400ms, ~800ms, ... capped at 5s. */
  private backoff(attempt: number): Promise<void> {
    const delay = Math.min(this.cfg.baseDelayMs * 2 ** (attempt - 1), 5_000);
    const jitter = delay * (0.5 + Math.random() * 0.5);
    return new Promise((resolve) => setTimeout(resolve, jitter));
  }
}
