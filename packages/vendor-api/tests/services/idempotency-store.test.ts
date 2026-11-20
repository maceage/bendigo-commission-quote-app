// The store on its own, including the file that carries it across
// restarts. Each test gets a fresh temporary directory.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { IdempotencyStore, fingerprint, type IssuedQuote } from "../../src/services/idempotency-store";

const quote = (quoteId: string): IssuedQuote => ({
  fingerprint: `request-for-${quoteId}`,
  quote: { quoteId, commissionRate: 0.035, totalCommission: "8750.00" },
});

const DAY = 24 * 60 * 60 * 1000;

let dir: string;
let file: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "idempotency-"));
  file = join(dir, "issued.json");
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("IdempotencyStore", () => {
  it("remembers quotes by key, and forgets the oldest once full", () => {
    const store = new IdempotencyStore({ capacity: 2, ttlMs: DAY });
    store.set("a", quote("Q-a"));
    store.set("b", quote("Q-b"));
    store.set("c", quote("Q-c"));

    expect(store.get("a")).toBeUndefined();
    expect(store.get("b")).toEqual(quote("Q-b"));
    expect(store.get("c")).toEqual(quote("Q-c"));
  });

  it("writes no file unless given one", () => {
    new IdempotencyStore({ capacity: 2, ttlMs: DAY }).set("a", quote("Q-a"));
    expect(existsSync(file)).toBe(false);
  });

  it("starts empty when its file doesn't exist yet, creating the file's folder", () => {
    const nested = join(dir, "data", "issued.json");
    const store = new IdempotencyStore({ capacity: 2, ttlMs: DAY, file: nested });
    expect(store.get("a")).toBeUndefined();

    store.set("a", quote("Q-a"));
    expect(existsSync(nested)).toBe(true);
  });

  it("keeps quotes across a restart: a new store on the same file sees them", () => {
    const before = new IdempotencyStore({ capacity: 2, ttlMs: DAY, file });
    before.set("a", quote("Q-a"));
    before.set("b", quote("Q-b"));

    const after = new IdempotencyStore({ capacity: 2, ttlMs: DAY, file });
    expect(after.get("a")).toEqual(quote("Q-a"));
    expect(after.get("b")).toEqual(quote("Q-b"));
  });

  it("persists only the keys it still holds, oldest first, with no temporary file left behind", () => {
    const store = new IdempotencyStore({ capacity: 2, ttlMs: DAY, file });
    store.set("a", quote("Q-a"));
    store.set("b", quote("Q-b"));
    store.set("c", quote("Q-c"));

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([
      ["b", { ...quote("Q-b"), issuedAt: expect.any(Number) }],
      ["c", { ...quote("Q-c"), issuedAt: expect.any(Number) }],
    ]);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it("keeps eviction order across a restart, and trims to a smaller capacity", () => {
    const before = new IdempotencyStore({ capacity: 3, ttlMs: DAY, file });
    for (const key of ["a", "b", "c"]) before.set(key, quote(`Q-${key}`));

    const after = new IdempotencyStore({ capacity: 2, ttlMs: DAY, file });
    expect(after.get("a")).toBeUndefined(); // the oldest goes first
    after.set("d", quote("Q-d"));
    expect(after.get("b")).toBeUndefined();
    expect(after.get("c")).toEqual(quote("Q-c"));
  });

  it.each([
    ["not JSON", "{"],
    ["not a list", "{}"],
    ["a quote that breaks the contract", JSON.stringify([["a", { fingerprint: "f", quote: { quoteId: "Q-a" } }]])],
    ["a quote without its request's fingerprint", JSON.stringify([["a", { ...quote("Q-a").quote, issuedAt: 0 }]])],
    ["a quote without the time it was issued", JSON.stringify([["a", quote("Q-a")]])],
  ])("refuses to start from a file that is %s", (_what, contents) => {
    writeFileSync(file, contents);
    expect(() => new IdempotencyStore({ capacity: 2, ttlMs: DAY, file })).toThrow(
      `Idempotency file ${file} isn't a valid list of issued quotes (delete it to start afresh`,
    );
  });

  it("passes on errors other than a missing file", () => {
    // A directory where the file should be: reading it fails, but not with ENOENT.
    expect(() => new IdempotencyStore({ capacity: 2, ttlMs: DAY, file: dir })).toThrow(
      expect.objectContaining({ code: "EISDIR" }),
    );
  });
});

describe("IdempotencyStore expiry", () => {
  const TTL = 100;
  let time: number;
  const now = () => time;

  beforeEach(() => {
    time = 0;
  });

  it("forgets a key once its time is up, and not before", () => {
    const store = new IdempotencyStore({ capacity: 10, ttlMs: TTL, now });
    store.set("a", quote("Q-a"));

    time = TTL - 1;
    expect(store.get("a")).toEqual(quote("Q-a"));
    time = TTL;
    expect(store.get("a")).toBeUndefined();
  });

  it("moves a key issued again after expiring to the back, so it isn't evicted next", () => {
    const store = new IdempotencyStore({ capacity: 2, ttlMs: TTL, now });
    store.set("a", quote("Q-a"));
    time = 60;
    store.set("b", quote("Q-b"));
    time = 120; // "a" has expired; "b" hasn't
    store.set("a", quote("Q-a2"));
    store.set("c", quote("Q-c")); // the store is full: the oldest, "b", goes

    expect(store.get("a")).toEqual(quote("Q-a2"));
    expect(store.get("b")).toBeUndefined();
    expect(store.get("c")).toEqual(quote("Q-c"));
  });

  it("drops expired keys from its file, at startup and when writing", () => {
    const before = new IdempotencyStore({ capacity: 10, ttlMs: TTL, file, now });
    before.set("a", quote("Q-a"));
    time = 60;
    before.set("b", quote("Q-b"));

    time = 120; // "a" has expired; "b" hasn't
    const after = new IdempotencyStore({ capacity: 10, ttlMs: TTL, file, now });
    expect(after.get("a")).toBeUndefined();
    expect(after.get("b")).toEqual(quote("Q-b"));

    after.set("c", quote("Q-c"));
    const keys = (JSON.parse(readFileSync(file, "utf8")) as [string, unknown][]).map(([key]) => key);
    expect(keys).toEqual(["b", "c"]);
  });
});

describe("fingerprint", () => {
  const loan = { loanAmount: "250000", loanTermInMonths: 36, riskBand: "MEDIUM" } as const;

  it("is the same for the same loan, however the amount is written", () => {
    expect(fingerprint({ ...loan, loanAmount: "250000.00" })).toBe(fingerprint(loan));
    expect(fingerprint({ ...loan, loanAmount: "250000.0" })).toBe(fingerprint(loan));
  });

  it.each([{ loanAmount: "250000.01" }, { loanTermInMonths: 37 }, { riskBand: "HIGH" as const }])(
    "differs when the loan does ($0)",
    (change) => {
      expect(fingerprint({ ...loan, ...change })).not.toBe(fingerprint(loan));
    },
  );

  it("holds no loan details", () => {
    expect(fingerprint(loan)).toMatch(/^[0-9a-f]{64}$/);
  });
});
