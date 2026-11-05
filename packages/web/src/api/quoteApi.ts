// The front-end's ONLY network seam. Calls the same-origin /api
// path (Vite proxies to quote-service in dev) — the browser never
// learns the vendor exists, never holds an API key, and never needs
// a base URL.

import {
  QuoteResponseSchema,
  type QuoteError,
  type QuoteRequest,
  type QuoteResponse,
} from "@commission-quote/contract";

/**
 * Discriminated union so the UI never guesses what happened:
 *  - success          -> render quote
 *  - failure with envelope (our backend spoke) -> show its message/code
 *  - failure without envelope (proxy down, network) -> generic message
 */
export type QuoteResult =
  | { ok: true; quote: QuoteResponse }
  | { ok: false; error: QuoteError };

export async function requestQuote(request: QuoteRequest): Promise<QuoteResult> {
  let response: Response;
  try {
    response = await fetch("/api/quotes", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(request),
    });
  } catch {
    // Network-level failure: dev server down, connection dropped.
    // Nothing structured to parse — synthesise the envelope ourselves
    // so the UI has ONE error shape to render, always.
    return {
      ok: false,
      error: { code: "SERVICE_UNAVAILABLE", message: "Could not reach the quote service. Check it is running." },
    };
  }

  // Try to read our error envelope; tolerate a non-JSON body (e.g.
  // the dev proxy returning HTML for a 502) by falling back to a
  // generic, still-user-safe message.
  if (!response.ok) {
    const error = await parseErrorBody(response);
    return { ok: false, error };
  }

  const json: unknown = await response.json();

  // Belt-and-braces: the quote-service validates the vendor's
  // response, but we re-validate HERE too. Front-ends that blindly
  // trust 200 bodies render NaN commission rates — one line
  // of schema reuse prevents that whole bug class.
  const parsed = QuoteResponseSchema.safeParse(json);
  if (!parsed.success) {
    return {
      ok: false,
      error: { code: "VENDOR_ERROR", message: "Received an invalid quote response." },
    };
  }

  return { ok: true, quote: parsed.data };
}

async function parseErrorBody(response: Response): Promise<QuoteError> {
  try {
    const body: unknown = await response.json();
    if (
      typeof body === "object" &&
      body !== null &&
      "code" in body &&
      "message" in body &&
      typeof (body as { message?: unknown }).message === "string"
    ) {
      return body as QuoteError;
    }
  } catch {
    // Body wasn't JSON — fall through to the generic envelope.
  }
  return {
    code: "VENDOR_ERROR",
    message: `Quote request failed (${response.status}). Please try again.`,
  };
}