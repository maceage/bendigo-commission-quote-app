// Renders a successful quote, with the loan details it was for: the
// form can be edited after a quote arrives, and the quote must not look
// like it belongs to the new figures. Formatting lives here and nowhere
// else: currency in AUD (a bank's UI does not show raw floats),
// rate as a percentage — the contract stores a 0-1 fraction.
// Intl formats a decimal string exactly, so the amount never becomes a float.
// aria-live="polite" so screen-reader users hear the quote arrive.

import type { QuoteRequest, QuoteResponse } from "@commission-quote/contract";

const currency = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const percent = new Intl.NumberFormat("en-AU", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

export function QuoteResult({ quote, request }: { quote: QuoteResponse; request: QuoteRequest }) {
  return (
    <div className="quote-result" aria-live="polite">
      <h2>Your commission quote</h2>
      <dl>
        <div>
          <dt>Total commission</dt>
          <dd className="quote-total">{currency.format(quote.totalCommission as Intl.StringNumericLiteral)}</dd>
        </div>
        <div>
          <dt>Commission rate</dt>
          <dd>{percent.format(quote.commissionRate)}</dd>
        </div>
        <div>
          <dt>Quote reference</dt>
          <dd className="quote-id">{quote.quoteId}</dd>
        </div>
      </dl>
      <h3>For this loan</h3>
      <dl className="quote-loan">
        <div>
          <dt>Loan amount</dt>
          <dd>{currency.format(request.loanAmount as Intl.StringNumericLiteral)}</dd>
        </div>
        <div>
          <dt>Loan term</dt>
          <dd>{request.loanTermInMonths === 1 ? "1 month" : `${request.loanTermInMonths} months`}</dd>
        </div>
        <div>
          <dt>Risk band</dt>
          <dd>{request.riskBand}</dd>
        </div>
      </dl>
    </div>
  );
}
