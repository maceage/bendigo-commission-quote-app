// Renders a successful quote. Formatting lives here and nowhere
// else: currency in AUD (a bank's UI does not show raw floats),
// rate as a percentage — the contract stores a 0-1 fraction,
// so *100 with one decimal place. aria-live="polite" so
// screen-reader users hear the quote arrive.

import type { QuoteResponse } from "@commission-quote/contract";

export function QuoteResult({ quote }: { quote: QuoteResponse }) {
  const formatter = new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
  });

  return (
    <div className="quote-result" aria-live="polite">
      <h2>Your commission quote</h2>
      <dl>
        <div>
          <dt>Total commission</dt>
          <dd className="quote-total">{formatter.format(quote.totalCommission)}</dd>
        </div>
        <div>
          <dt>Commission rate</dt>
          <dd>{(quote.commissionRate * 100).toFixed(1)}%</dd>
        </div>
        <div>
          <dt>Quote reference</dt>
          <dd className="quote-id">{quote.quoteId}</dd>
        </div>
      </dl>
    </div>
  );
}