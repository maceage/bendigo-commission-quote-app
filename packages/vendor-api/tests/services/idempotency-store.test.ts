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
    const store = new IdempotencyStore(2);
    store.set("a", quote("Q-a"));
    store.set("b", quote("Q-b"));
    store.set("c", quote("Q-c"));

    expect(store.get("a")).toBeUndefined();
    expect(store.get("b")).toEqual(quote("Q-b"));
    expect(store.get("c")).toEqual(quote("Q-c"));
  });

  it("writes no file unless given one", () => {
    new IdempotencyStore(2).set("a", quote("Q-a"));
    expect(existsSync(file)).toBe(false);
  });

  it("starts empty when its file doesn't exist yet, creating the file's folder", () => {
    const nested = join(dir, "data", "issued.json");
    const store = new IdempotencyStore(2, nested);
    expect(store.get("a")).toBeUndefined();

    store.set("a", quote("Q-a"));
    expect(existsSync(nested)).toBe(true);
  });

  it("keeps quotes across a restart: a new store on the same file sees them", () => {
    const before = new IdempotencyStore(2, file);
    before.set("a", quote("Q-a"));
    before.set("b", quote("Q-b"));

    const after = new IdempotencyStore(2, file);
    expect(after.get("a")).toEqual(quote("Q-a"));
    expect(after.get("b")).toEqual(quote("Q-b"));
  });

  it("persists only the keys it still holds, oldest first, with no temporary file left behind", () => {
    const store = new IdempotencyStore(2, file);
    store.set("a", quote("Q-a"));
    store.set("b", quote("Q-b"));
    store.set("c", quote("Q-c"));

    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual([
      ["b", quote("Q-b")],
      ["c", quote("Q-c")],
    ]);
    expect(existsSync(`${file}.tmp`)).toBe(false);
  });

  it("keeps eviction order across a restart, and trims to a smaller capacity", () => {
    const before = new IdempotencyStore(3, file);
    for (const key of ["a", "b", "c"]) before.set(key, quote(`Q-${key}`));

    const after = new IdempotencyStore(2, file);
    expect(after.get("a")).toBeUndefined(); // the oldest goes first
    after.set("d", quote("Q-d"));
    expect(after.get("b")).toBeUndefined();
    expect(after.get("c")).toEqual(quote("Q-c"));
  });

  it.each([
    ["not JSON", "{"],
    ["not a list", "{}"],
    ["a quote that breaks the contract", JSON.stringify([["a", { fingerprint: "f", quote: { quoteId: "Q-a" } }]])],
    ["a quote without its request's fingerprint", JSON.stringify([["a", quote("Q-a").quote]])],
  ])("refuses to start from a file that is %s", (_what, contents) => {
    writeFileSync(file, contents);
    expect(() => new IdempotencyStore(2, file)).toThrow(
      `Idempotency file ${file} isn't a valid list of issued quotes (delete it to start afresh`,
    );
  });

  it("passes on errors other than a missing file", () => {
    // A directory where the file should be: reading it fails, but not with ENOENT.
    expect(() => new IdempotencyStore(2, dir)).toThrow(expect.objectContaining({ code: "EISDIR" }));
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
