// Shared domain types — the single source of truth for the agreed
// contract between the Lending Platform and the third-party vendor
// Commission Quote API.

import { z } from "zod";

/**
 * Risk bands accepted by the vendor Commission Quote API.
 */
export const RISK_BANDS = ["LOW", "MEDIUM", "HIGH"] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

/**
 * Request payload: the loan details sent to the Commission Quote API.
 */
export const QuoteRequestSchema = z.object({
  loanAmount: z
    .number({ invalid_type_error: "loanAmount must be a number" })
    .positive("loanAmount must be greater than zero")
    .max(100_000_000, "loanAmount is unreasonably large"),
  loanTermInMonths: z
    .number({ invalid_type_error: "loanTermInMonths must be a number" })
    .int("loanTermInMonths must be a whole number of months")
    .positive("loanTermInMonths must be greater than zero")
    .max(600, "loanTermInMonths must be 600 (50 years) or fewer"),
  riskBand: z.enum(RISK_BANDS),
});
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

/**
 * Response payload: the quote returned by the Commission Quote API.
 */
export const QuoteResponseSchema = z.object({
  quoteId: z.string().uuid(),
  commissionRate: z.number().min(0).max(1), // fraction, e.g. 0.035 = 3.5%
  totalCommission: z.number().nonnegative(),
});
export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;

/**
 * Error envelope returned by OUR quote-service to the web front-end.
 * Not part of the vendor contract — but keeping it here means the UI
 * and backend agree on its shape without a second handshake.
 *
 * Suggested status codes:
 *   400 -> VALIDATION_ERROR   (invalid loan details)
 *   502 -> VENDOR_ERROR       (vendor returned malformed/unexpected data)
 *   504 -> VENDOR_TIMEOUT     (vendor exceeded our timeout after retries)
 *   503 -> SERVICE_UNAVAILABLE(all vendor attempts failed)
 */
export const QUOTE_ERROR_CODES = [
  "VALIDATION_ERROR",
  "VENDOR_ERROR",
  "VENDOR_TIMEOUT",
  "SERVICE_UNAVAILABLE",
] as const;
export type QuoteErrorCode = (typeof QUOTE_ERROR_CODES)[number];

export const QuoteErrorSchema = z.object({
  code: z.enum(QUOTE_ERROR_CODES),
  message: z.string(), // safe, user-displayable message
});
export type QuoteError = z.infer<typeof QuoteErrorSchema>;
