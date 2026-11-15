// Pure domain logic: validated request in, deterministic quote out.
// Kept free of Express concerns so it can be unit-tested directly.

import { randomUUID } from "node:crypto";
import { QuoteRequestSchema, type QuoteRequest, type QuoteResponse, type RiskBand } from "@commission-quote/contract";

/**
 * Risk band -> commission rate. Plausible-looking numbers; the point
 * is that higher risk earns higher commission.
 */
const COMMISSION_RATES: Record<RiskBand, number> = {
  LOW: 0.02,
  MEDIUM: 0.035,
  HIGH: 0.06,
};

export function generateQuote(payload: unknown): QuoteResponse {
  // Guard the boundary: even a trusted caller's serialization can lie.
  const request: QuoteRequest = QuoteRequestSchema.parse(payload);

  const commissionRate = COMMISSION_RATES[request.riskBand];
  // Round to cents. A production system would use integer cents or a
  // decimal type end-to-end rather than binary floats.
  const totalCommission = Math.round(request.loanAmount * commissionRate * 100) / 100;

  return {
    quoteId: randomUUID(),
    commissionRate,
    totalCommission,
  };
}
