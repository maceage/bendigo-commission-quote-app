// Pure domain logic: validated request in, deterministic quote out.
// Kept free of Express concerns so it can be unit-tested directly.

import { randomUUID } from "node:crypto";
import {
  BASIS_POINTS_PER_UNIT,
  QuoteRequestSchema,
  applyBasisPoints,
  formatCents,
  parseCents,
  type QuoteRequest,
  type QuoteResponse,
  type RiskBand,
} from "@commission-quote/contract";

/**
 * Risk band -> commission rate in basis points (350 = 3.5%), so the
 * commission is computed in integers. Plausible-looking numbers; the
 * point is that higher risk earns higher commission.
 */
const COMMISSION_BASIS_POINTS: Record<RiskBand, number> = {
  LOW: 200,
  MEDIUM: 350,
  HIGH: 600,
};

export function generateQuote(payload: unknown): QuoteResponse {
  // Guard the boundary: even a trusted caller's serialization can lie.
  const request: QuoteRequest = QuoteRequestSchema.parse(payload);

  const basisPoints = COMMISSION_BASIS_POINTS[request.riskBand];
  // Integer cents x basis points, rounded half up to the cent. The
  // schema has already checked the amount parses, hence the `!`.
  const commissionCents = applyBasisPoints(parseCents(request.loanAmount)!, basisPoints);

  return {
    quoteId: randomUUID(),
    commissionRate: basisPoints / BASIS_POINTS_PER_UNIT,
    totalCommission: formatCents(commissionCents),
  };
}
