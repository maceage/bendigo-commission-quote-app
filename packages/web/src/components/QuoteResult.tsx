// Renders a successful quote. Formatting lives here and nowhere
// else: currency in AUD (a bank's UI does not show raw floats),
// rate as a percentage — the contract stores a 0-1 fraction.
// aria-live="polite" so screen-reader users hear the quote arrive.

import type { QuoteResponse } from "@commission-quote/contract";

const currency = new Intl.NumberFormat("en-AU", { style: "currency", currency: "AUD" });
const percent = new Intl.NumberFormat("en-AU", {
  style: "percent",
  minimumFractionDigits: 1,
  maximumFractionDigits: 2,
});

export function QuoteResult({ quote }: { quote: QuoteResponse }) {
  return (
    <div className="quote-result" aria-live="polite">
      <h2>Your commission quote</h2>
      <dl>
        <div>
          <dt>Total commission</dt>
          <dd className="quote-total">{currency.format(quote.totalCommission)}</dd>
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
    </div>
  );
}
