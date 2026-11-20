// Quotes already issued, by Idempotency-Key: a retried request gets the
// original quote back instead of a new one. Each quote is kept with a
// fingerprint of the request that produced it, so a key reused for a
// different loan can be refused rather than answered with the wrong
// quote. Bounded twice over: a key expires after a while (24 hours in
// the app), and once full the oldest key is forgotten. Given a file, it
// also survives restarts, as a real vendor's store would: the file is
// read once at startup and rewritten (and flushed) after each new quote.

import { createHash } from "node:crypto";
import { closeSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { z } from "zod";
import { QuoteResponseSchema, parseCents, type QuoteRequest } from "@commission-quote/contract";

const IssuedQuoteSchema = z.object({ fingerprint: z.string(), quote: QuoteResponseSchema });
export type IssuedQuote = z.infer<typeof IssuedQuoteSchema>;

/** An issued quote as stored: with when it was issued (ms since the epoch), for expiry. */
const StoredQuoteSchema = IssuedQuoteSchema.extend({ issuedAt: z.number() });
type StoredQuote = z.infer<typeof StoredQuoteSchema>;

/** The file's format: [key, stored quote] pairs, oldest first. */
const StoredQuotesSchema = z.array(z.tuple([z.string(), StoredQuoteSchema]));

export interface IdempotencyStoreOptions {
  /** How many keys to remember; once full, the oldest is forgotten. */
  capacity: number;
  /** How long a key lasts, in ms; after that it's treated as new. */
  ttlMs: number;
  /** Keeps the quotes across restarts; in memory only if absent. */
  file?: string;
  /** The clock, in ms since the epoch; tests inject one to move time on. */
  now?: () => number;
}

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
  // Every key lives equally long, so it is also expiry order: expired
  // keys are always at the front.
  private readonly issued = new Map<string, StoredQuote>();
  private readonly now: () => number;

  constructor(private readonly options: IdempotencyStoreOptions) {
    this.now = options.now ?? Date.now;
    if (options.file !== undefined) {
      mkdirSync(dirname(options.file), { recursive: true });
      for (const [key, stored] of readQuotes(options.file)) this.remember(key, stored);
      this.dropExpired();
    }
  }

  get(key: string): IssuedQuote | undefined {
    const stored = this.issued.get(key);
    if (stored === undefined || this.isExpired(stored)) return undefined;
    return { fingerprint: stored.fingerprint, quote: stored.quote };
  }

  set(key: string, issued: IssuedQuote): void {
    // Also clears this key if it had expired, so it's re-added at the back.
    this.dropExpired();
    this.remember(key, { ...issued, issuedAt: this.now() });
    if (this.options.file !== undefined) writeQuotes(this.options.file, [...this.issued]);
  }

  private remember(key: string, stored: StoredQuote): void {
    this.issued.set(key, stored);
    if (this.issued.size > this.options.capacity) {
      this.issued.delete(this.issued.keys().next().value!);
    }
  }

  private isExpired(stored: StoredQuote): boolean {
    return this.now() - stored.issuedAt >= this.options.ttlMs;
  }

  private dropExpired(): void {
    for (const [key, stored] of this.issued) {
      if (!this.isExpired(stored)) break;
      this.issued.delete(key);
    }
  }
}

/** The stored quotes; none if the file doesn't exist yet. Throws if it can't be trusted. */
function readQuotes(file: string): [string, StoredQuote][] {
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
    // No full stop: pino's error serializer appends ": <cause>".
    throw new Error(
      `Idempotency file ${file} isn't a valid list of issued quotes (delete it to start afresh; ` +
        "under Docker Compose, docker compose down --volumes)",
      { cause: err },
    );
  }
}

/**
 * Written to a temporary file, flushed to disk and renamed into place, so
 * neither a crash nor a power cut mid-write can leave half a file.
 */
function writeQuotes(file: string, quotes: [string, StoredQuote][]): void {
  const temp = `${file}.tmp`;
  writeFileSync(temp, JSON.stringify(quotes), { flush: true });
  renameSync(temp, file);
  // The rename is only durable once the directory is flushed too. POSIX
  // allows that; Windows can't open a directory to flush it.
  if (process.platform !== "win32") {
    const dir = openSync(dirname(file), "r");
    try {
      fsyncSync(dir);
    } finally {
      closeSync(dir);
    }
  }
}
