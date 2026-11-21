// Composition only: the form feeds the hook, the hook's status
// decides which display the user sees. No async logic here.

import { useQuote } from "./hooks/useQuote";
import { QuoteForm } from "./components/QuoteForm";
import { QuoteResult } from "./components/QuoteResult";
import { Alert } from "./components/Alert";

export default function App() {
  const { state, generate } = useQuote();

  return (
    <main className="app">
      <h1>Commission Quote</h1>
      <QuoteForm onSubmit={generate} loading={state.status === "loading"} />

      {state.status === "success" && <QuoteResult quote={state.quote} request={state.request} />}
      {state.status === "error" && <Alert error={state.error} />}
    </main>
  );
}
