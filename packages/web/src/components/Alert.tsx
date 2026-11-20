// The single error renderer. Because every failure path funnels
// into QuoteError (thanks to quoteApi's union), the UI needs
// exactly one of these. role="alert" announces failures to
// screen readers without stealing focus.

import type { QuoteError } from "@commission-quote/contract";

const ERROR_HEADING: Record<QuoteError["code"], string> = {
  VALIDATION_ERROR: "Check your loan details",
  INTERNAL_ERROR: "Something went wrong",
  VENDOR_TIMEOUT: "The quote provider timed out",
  VENDOR_ERROR: "Couldn't generate a quote",
  SERVICE_UNAVAILABLE: "Quote service unavailable",
};

const TRANSIENT: ReadonlySet<QuoteError["code"]> = new Set(["VENDOR_TIMEOUT", "SERVICE_UNAVAILABLE"]);

export function Alert({ error }: { error: QuoteError }) {
  return (
    <div className="alert alert-error" role="alert">
      <strong>{ERROR_HEADING[error.code]}</strong>
      <p>{error.message}</p>
      {TRANSIENT.has(error.code) && <p className="alert-hint">This is usually temporary — please try again.</p>}
      {/* Matches the server logs, so support can find exactly what happened. */}
      {error.requestId !== undefined && <p className="alert-reference">Reference: {error.requestId}</p>}
    </div>
  );
}
