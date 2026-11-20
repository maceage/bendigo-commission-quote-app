// The front-end's ONLY network seam. Calls the same-origin /api
// path (Vite proxies to quote-service in dev) — the browser never
// learns the vendor exists, never holds an API key, and never needs
// a base URL.

import {
  QuoteErrorSchema,
  QuoteResponseSchema,
  type QuoteError,
  type QuoteRequest,
  type QuoteResponse,
} from "@commission-quote/contract";

/**
 * Comfortably above quote-service's own overall vendor deadline (8s),
 * so the server normally answers first with a precise error.
 */
export const REQUEST_TIMEOUT_MS = 15_000;

/**
 * Discriminated union so the UI never guesses what happened. Every
 * failure — our backend's envelope, a proxy error page, a dropped
 * connection — arrives as the same QuoteError shape.
 */
export type QuoteResult = { ok: true; quote: QuoteResponse } | { ok: false; error: QuoteError };

/** A 200 that isn't a quote: not JSON, or not the quote's shape. */
const INVALID_QUOTE: QuoteResult = {
  ok: false,
  error: { code: "VENDOR_ERROR", message: "Received an invalid quote response." },
};

export interface RequestQuoteOptions {
  /** Lets the caller cancel (e.g. a newer submission superseded this one). */
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function requestQuote(
  request: QuoteRequest,
  { signal, timeoutMs = REQUEST_TIMEOUT_MS }: RequestQuoteOptions = {},
): Promise<QuoteResult> {
  const timeout = AbortSignal.timeout(timeoutMs);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

  try {
    const response = await fetch("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
      signal: combined,
    });

    if (!response.ok) {
      return { ok: false, error: await parseErrorBody(response) };
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch (err) {
      // A timeout, abort or dropped connection mid-body is handled below.
      if (!(err instanceof SyntaxError)) throw err;
      return INVALID_QUOTE;
    }

    // Belt-and-braces: the quote-service validates the vendor's
    // response, but we re-validate HERE too, so a bad 200 body can
    // never render as NaN.
    const parsed = QuoteResponseSchema.safeParse(body);
    return parsed.success ? { ok: true, quote: parsed.data } : INVALID_QUOTE;
  } catch (err) {
    if (timeout.aborted) {
      return {
        ok: false,
        error: { code: "VENDOR_TIMEOUT", message: "The quote request took too long. Please try again." },
      };
    }
    if (signal?.aborted) throw err; // caller cancelled — let them ignore it
    // Network-level failure: dev server down or connection dropped.
    return {
      ok: false,
      error: { code: "SERVICE_UNAVAILABLE", message: "Could not reach the quote service. Check it is running." },
    };
  }
}

async function parseErrorBody(response: Response): Promise<QuoteError> {
  try {
    const parsed = QuoteErrorSchema.safeParse(await response.json());
    if (parsed.success) return parsed.data;
  } catch {
    // Body wasn't JSON (e.g. the dev proxy's HTML 502 page).
  }
  return {
    code: "VENDOR_ERROR",
    message: `Quote request failed (${response.status}). Please try again.`,
  };
}
