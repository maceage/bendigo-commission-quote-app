// Coverage settings every package's Vitest config uses, so the minimum
// is set in one place: `npm run test:coverage` (and so CI) fails if any
// package's coverage of src/ drops below it, and
// scripts/coverage-summary.ts marks each metric against it.

import type { CoverageOptions } from "vitest/node";

/** Minimum coverage of src/, in percent, for statements, branches, functions and lines alike. */
export const COVERAGE_THRESHOLD = 90;

/** Coverage of src/, except `exclude`: files the tests never run (thin launchers, re-exports). */
export function coverageOptions(exclude: string[] = []): CoverageOptions {
  return {
    include: ["src/**"],
    exclude,
    // Terminal, browsable HTML, and the JSON scripts/coverage-summary.ts reads.
    reporter: ["text", "html", "json-summary"],
    thresholds: {
      statements: COVERAGE_THRESHOLD,
      branches: COVERAGE_THRESHOLD,
      functions: COVERAGE_THRESHOLD,
      lines: COVERAGE_THRESHOLD,
    },
  };
}
