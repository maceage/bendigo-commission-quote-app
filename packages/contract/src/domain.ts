// Shared domain types — the single source of truth for the agreed
// contract between the Lending Platform and the third-party vendor
// Commission Quote API.

import { z } from "zod";
import { parseCents } from "./money";

/**
 * Risk bands accepted by the vendor Commission Quote API.
 */
export const RISK_BANDS = ["LOW", "MEDIUM", "HIGH"] as const;
export type RiskBand = (typeof RISK_BANDS)[number];

/**
 * Header carrying the vendor API key, as named in the agreed contract.
 * Defined once so the mock vendor and our client can't drift apart.
 */
export const API_KEY_HEADER = "api-key";

/**
 * Header carrying a request's correlation ID: echoed on our responses
 * and forwarded to the vendor, so one ID finds a request in every log.
 */
export const REQUEST_ID_HEADER = "x-request-id";

export const MAX_LOAN_AMOUNT = 100_000_000;
export const MAX_LOAN_TERM_MONTHS = 600;

// Built from the limits, so a message can't drift from what's enforced.
const MAX_LOAN_AMOUNT_TEXT = new Intl.NumberFormat("en-AU", {
  style: "currency",
  currency: "AUD",
  maximumFractionDigits: 0,
}).format(MAX_LOAN_AMOUNT);
const MAX_LOAN_TERM_TEXT = `${MAX_LOAN_TERM_MONTHS} months (${MAX_LOAN_TERM_MONTHS / 12} years)`;

/** The user-facing problem with a loan amount string, if there is one. */
function loanAmountProblem(amount: string): string | undefined {
  if (amount.trim() === "") return "Enter a loan amount.";
  if (!/^-?\d+(\.\d+)?$/.test(amount)) return "Loan amount must be a number.";
  if (/\.\d{3,}$/.test(amount)) return "Loan amount can't include fractions of a cent.";
  const cents = parseCents(amount); // undefined from here on only if negative or huge
  if (amount.startsWith("-") || cents === 0) return "Loan amount must be greater than zero.";
  if (cents === undefined || cents > MAX_LOAN_AMOUNT * 100)
    return `Loan amount must be ${MAX_LOAN_AMOUNT_TEXT} or less.`;
  return undefined;
}

/**
 * Request payload: the loan details sent to the Commission Quote API.
 * Money travels as a decimal string ("250000.00"), never a JSON number,
 * so no hop parses it into a float; see money.ts.
 */
export const QuoteRequestSchema = z.object(
  {
    loanAmount: z
      .string({ required_error: "Enter a loan amount.", invalid_type_error: "Loan amount must be a decimal string." })
      .superRefine((amount, ctx) => {
        const problem = loanAmountProblem(amount);
        if (problem !== undefined) ctx.addIssue({ code: z.ZodIssueCode.custom, message: problem });
      }),
    loanTermInMonths: z
      .number({ required_error: "Enter a loan term.", invalid_type_error: "Loan term must be a number." })
      .int("Loan term must be a whole number of months.")
      .positive("Loan term must be greater than zero.")
      .max(MAX_LOAN_TERM_MONTHS, `Loan term must be ${MAX_LOAN_TERM_TEXT} or fewer.`),
    riskBand: z.enum(RISK_BANDS, { message: "Choose a risk band: LOW, MEDIUM or HIGH." }),
  },
  // E.g. a request sent without a JSON content-type, which leaves no body.
  { message: "Send the loan details as a JSON object." },
);
export type QuoteRequest = z.infer<typeof QuoteRequestSchema>;

/**
 * Response payload: the quote returned by the Commission Quote API.
 */
export const QuoteResponseSchema = z.object({
  // Opaque vendor reference: the brief doesn't specify a format, so
  // don't reject a real vendor's IDs (e.g. "Q-12345"). The mock uses UUIDs.
  quoteId: z.string().min(1),
  commissionRate: z.number().min(0).max(1), // fraction, e.g. 0.035 = 3.5%
  // Decimal string, e.g. "8750.00": up to two places, never negative.
  totalCommission: z.string().refine((amount) => parseCents(amount) !== undefined, "Expected a decimal amount."),
});
export type QuoteResponse = z.infer<typeof QuoteResponseSchema>;

/**
 * Error envelope returned by OUR quote-service to the web front-end.
 * Not part of the vendor contract — but keeping it here means the UI
 * and backend agree on its shape without a second handshake.
 *
 * HTTP status for each code (see QUOTE_ERROR_STATUS):
 *   400 -> VALIDATION_ERROR    (invalid loan details)
 *   500 -> INTERNAL_ERROR      (a bug on our side; details are logged, not returned)
 *   502 -> VENDOR_ERROR        (vendor returned malformed/unexpected data)
 *   503 -> SERVICE_UNAVAILABLE (all vendor attempts failed)
 *   504 -> VENDOR_TIMEOUT      (vendor exceeded our timeout after retries)
 */
export const QUOTE_ERROR_CODES = [
  "VALIDATION_ERROR",
  "INTERNAL_ERROR",
  "VENDOR_ERROR",
  "VENDOR_TIMEOUT",
  "SERVICE_UNAVAILABLE",
] as const;
export type QuoteErrorCode = (typeof QUOTE_ERROR_CODES)[number];

export const QuoteErrorSchema = z.object({
  code: z.enum(QUOTE_ERROR_CODES),
  message: z.string(), // safe, user-displayable message
  requestId: z.string().optional(), // reference for support; matches the server logs
});
export type QuoteError = z.infer<typeof QuoteErrorSchema>;

export const QUOTE_ERROR_STATUS: Record<QuoteErrorCode, number> = {
  VALIDATION_ERROR: 400,
  INTERNAL_ERROR: 500,
  VENDOR_ERROR: 502,
  SERVICE_UNAVAILABLE: 503,
  VENDOR_TIMEOUT: 504,
};
