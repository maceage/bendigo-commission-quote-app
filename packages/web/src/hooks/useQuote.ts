// The state machine for a quote request. Components never hold
// async state themselves — they consume this one hook, which is
// the single owner of idle/loading/success/error transitions.

import { useCallback, useEffect, useRef, useState } from "react";
import type { QuoteError, QuoteRequest, QuoteResponse } from "@commission-quote/contract";
import { requestQuote } from "../api/quoteApi";

export type QuoteState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "success"; quote: QuoteResponse }
  | { status: "error"; error: QuoteError };

export function useQuote() {
  const [state, setState] = useState<QuoteState>({ status: "idle" });
  // The in-flight request, if any. A newer submission (or unmount)
  // aborts it, so only the LATEST request can ever update the screen.
  const inFlight = useRef<AbortController | null>(null);

  useEffect(() => () => inFlight.current?.abort(), []);

  const generate = useCallback(async (request: QuoteRequest) => {
    inFlight.current?.abort();
    const controller = new AbortController();
    inFlight.current = controller;

    // Reset to loading synchronously so the UI reflects the click
    // immediately (no flash of the previous result while fetching).
    setState({ status: "loading" });

    try {
      const result = await requestQuote(request, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setState(result.ok ? { status: "success", quote: result.quote } : { status: "error", error: result.error });
    } catch (err) {
      if (controller.signal.aborted) return; // superseded — not an error
      throw err;
    } finally {
      if (inFlight.current === controller) inFlight.current = null;
    }
  }, []);

  return { state, generate };
}
