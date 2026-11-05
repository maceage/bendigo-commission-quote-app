// The state machine for a quote request. Components never hold
// async state themselves — they consume this one hook, which is
// the single owner of idle/loading/success/error transitions.

import { useCallback, useState } from "react";
import type { QuoteError, QuoteRequest, QuoteResponse } from "@commission-quote/contract";
import { requestQuote } from "../api/quoteApi";

export type QuoteStatus = "idle" | "loading" | "success" | "error";

interface QuoteState {
  status: QuoteStatus;
  quote: QuoteResponse | null;
  error: QuoteError | null;
}

export function useQuote() {
  const [state, setState] = useState<QuoteState>({
    status: "idle",
    quote: null,
    error: null,
  });

  const generate = useCallback(async (request: QuoteRequest) => {
    // Reset to loading synchronously so the UI reflects the click
    // immediately (no flash of the previous result while fetching).
    setState({ status: "loading", quote: null, error: null });

    const result = await requestQuote(request);

    // Discard stale responses: if the user submitted again before
    // this one resolved, the newer submission owns the screen.
    setState((prev) => {
      if (prev.status !== "loading") return prev;
      return result.ok
        ? { status: "success", quote: result.quote, error: null }
        : { status: "error", quote: null, error: result.error };
    });
  }, []);

  return { ...state, generate };
}