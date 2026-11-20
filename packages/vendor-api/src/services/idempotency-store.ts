// Quotes already issued, by Idempotency-Key: a retried request gets the
// original quote back instead of a new one. Bounded, so once full the
// oldest key is forgotten. Given a file, it also survives restarts, as a
// real vendor's store would: the file is read once at startup and
// rewritten after each new quote.

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { QuoteResponseSchema, type QuoteResponse } from "@commission-quote/contract";

/** The file's format: [key, quote] pairs, oldest first. */
const StoredQuotesSchema = z.array(z.tuple([z.string(), QuoteResponseSchema]));

export class IdempotencyStore {
  // Map preserves insertion order, which gives us cheap FIFO eviction.
  private readonly issued = new Map<string, QuoteResponse>();

  constructor(
    private readonly capacity: number,
    private readonly file?: string,
  ) {
    if (file !== undefined) {
      mkdirSync(dirname(file), { recursive: true });
      for (const [key, quote] of readQuotes(file)) this.remember(key, quote);
    }
  }

  get(key: string): QuoteResponse | undefined {
    return this.issued.get(key);
  }

  set(key: string, quote: QuoteResponse): void {
    this.remember(key, quote);
    if (this.file !== undefined) writeQuotes(this.file, [...this.issued]);
  }

  private remember(key: string, quote: QuoteResponse): void {
    this.issued.set(key, quote);
    if (this.issued.size > this.capacity) {
      this.issued.delete(this.issued.keys().next().value!);
    }
  }
}

/** The stored quotes; none if the file doesn't exist yet. Throws if it can't be trusted. */
function readQuotes(file: string): [string, QuoteResponse][] {
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
function writeQuotes(file: string, quotes: [string, QuoteResponse][]): void {
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(quotes));
  renameSync(temp, file);
}
