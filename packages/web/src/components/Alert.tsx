// The single error renderer. Because every failure path funnels
// into QuoteError (thanks to quoteApi's union), the UI needs
// exactly one of these. aria-live announces failures to
// screen readers without stealing focus.

import type { QuoteError } from "@commission-quote/contract";

const ERROR_HEADING: Record<QuoteError["code"], string> = {
  VALIDATION_ERROR: "Check your loan details",
  VENDOR_TIMEOUT: "The quote provider timed out",
  VENDOR_ERROR: "Couldn't generate a quote",
  SERVICE_UNAVAILABLE: "Quote service unavailable",
};

export function Alert({ error }: { error: QuoteError }) {
  return (
    <div className="alert alert-error" role="alert">
      <strong>{ERROR_HEADING[error.code]}</strong>
      <p>{error.message}</p>
      {/* Friendly nudge when the failure is our simulated vendor's
          randomness — retrying genuinely helps in that case. */}
      {(error.code === "VENDOR_TIMEOUT" || error.code === "SERVICE_UNAVAILABLE") && (
        <p className="alert-hint">This is usually temporary — please try again.</p>
      )}
    </div>
  );
}