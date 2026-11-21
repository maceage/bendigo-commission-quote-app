// Pure domain logic: validated request in, deterministic quote out.
// Kept free of Express concerns so it can be unit-tested directly.

import { randomUUID } from "node:crypto";
import {
  BASIS_POINTS_PER_UNIT,
  MAX_LOAN_TERM_MONTHS,
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

/**
 * Loading added to the risk band's rate for longer loans, in basis
 * points: a longer loan earns the lender more interest, so the vendor
 * pays more commission. Bands are inclusive upper limits, in order.
 */
const TERM_LOADING_BASIS_POINTS: ReadonlyArray<{ maxMonths: number; basisPoints: number }> = [
  { maxMonths: 60, basisPoints: 0 }, // up to 5 years
  { maxMonths: 240, basisPoints: 25 }, // up to 20 years
  { maxMonths: MAX_LOAN_TERM_MONTHS, basisPoints: 50 },
];

/** The loading for a loan term; the schema has already capped the term. */
export function termLoadingBasisPoints(loanTermInMonths: number): number {
  return TERM_LOADING_BASIS_POINTS.find(({ maxMonths }) => loanTermInMonths <= maxMonths)!.basisPoints;
}

export function generateQuote(payload: unknown): QuoteResponse {
  // Guard the boundary: even a trusted caller's serialization can lie.
  const request: QuoteRequest = QuoteRequestSchema.parse(payload);

  const basisPoints = COMMISSION_BASIS_POINTS[request.riskBand] + termLoadingBasisPoints(request.loanTermInMonths);
  // Integer cents x basis points, rounded half up to the cent. The
  // schema has already checked the amount parses, hence the `!`.
  const commissionCents = applyBasisPoints(parseCents(request.loanAmount)!, basisPoints);

  return {
    quoteId: randomUUID(),
    commissionRate: basisPoints / BASIS_POINTS_PER_UNIT,
    totalCommission: formatCents(commissionCents),
  };
}
