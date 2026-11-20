// Quotes already issued, by Idempotency-Key: a retried request gets the
// original quote back instead of a new one. Each quote is kept with a
// fingerprint of the request that produced it, so a key reused for a
// different loan can be refused rather than answered with the wrong
// quote. Bounded, so once full the
// oldest key is forgotten. Given a file, it also survives restarts, as a
// real vendor's store would: the file is read once at startup and
// rewritten after each new quote.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { QuoteResponseSchema, parseCents, type QuoteRequest } from "@commission-quote/contract";

const IssuedQuoteSchema = z.object({ fingerprint: z.string(), quote: QuoteResponseSchema });
export type IssuedQuote = z.infer<typeof IssuedQuoteSchema>;

/** The file's format: [key, issued quote] pairs, oldest first. */
const StoredQuotesSchema = z.array(z.tuple([z.string(), IssuedQuoteSchema]));

/**
 * Identifies a request by what it asks for, so "250000" and "250000.00"
 * are the same loan. Hashed, so the store holds no loan details.
 */
export function fingerprint(request: QuoteRequest): string {
  const fields = [parseCents(request.loanAmount), request.loanTermInMonths, request.riskBand];
  return createHash("sha256").update(fields.join("|")).digest("hex");
}

export class IdempotencyStore {
  // Map preserves insertion order, which gives us cheap FIFO eviction.
  private readonly issued = new Map<string, IssuedQuote>();

  constructor(
    private readonly capacity: number,
    private readonly file?: string,
  ) {
    if (file !== undefined) {
      mkdirSync(dirname(file), { recursive: true });
      for (const [key, issued] of readQuotes(file)) this.remember(key, issued);
    }
  }

  get(key: string): IssuedQuote | undefined {
    return this.issued.get(key);
  }

  set(key: string, issued: IssuedQuote): void {
    this.remember(key, issued);
    if (this.file !== undefined) writeQuotes(this.file, [...this.issued]);
  }

  private remember(key: string, issued: IssuedQuote): void {
    this.issued.set(key, issued);
    if (this.issued.size > this.capacity) {
      this.issued.delete(this.issued.keys().next().value!);
    }
  }
}

/** The stored quotes; none if the file doesn't exist yet. Throws if it can't be trusted. */
function readQuotes(file: string): [string, IssuedQuote][] {
  let text: string;
  try {
    text = readFileSync(file, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw err;
  }
  try {
    return StoredQuotesSchema.parse(JSON.parse(text));
  } catch (err) {
    throw new Error(`Idempotency file ${file} isn't a valid list of issued quotes.`, { cause: err });
  }
}

/** Written to a temporary file and renamed into place, so a crash mid-write can't leave half a file. */
function writeQuotes(file: string, quotes: [string, IssuedQuote][]): void {
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(quotes));
  renameSync(temp, file);
}
