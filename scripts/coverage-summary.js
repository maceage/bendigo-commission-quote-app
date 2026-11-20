// Prints a Markdown table of each package's coverage of src/, read from
// the coverage-summary.json files `npm run test:coverage` writes. In
// GitHub Actions it goes to the job summary, so it shows on the run's
// Summary page; locally (npm run coverage:summary) it goes to stdout.

import { appendFileSync, existsSync, readFileSync, readdirSync } from "node:fs";

const METRICS = ["statements", "branches", "functions", "lines"];
// The same minimum as the --coverage.thresholds flags in each package's test:coverage script.
const THRESHOLD = 90;

function cell({ pct, covered, total }) {
  return `${pct >= THRESHOLD ? "✅" : "❌"} ${pct}% (${covered}/${total})`;
}

const rows = readdirSync("packages")
  .sort()
  .map((pkg) => {
    const file = `packages/${pkg}/coverage/coverage-summary.json`;
    if (!existsSync(file)) return `| ${pkg} | ${METRICS.map(() => "no report").join(" | ")} |`;
    const { total } = JSON.parse(readFileSync(file, "utf8"));
    return `| ${pkg} | ${METRICS.map((metric) => cell(total[metric])).join(" | ")} |`;
  });

const markdown = [
  "## Coverage of `src/`",
  "",
  `Every package must keep each metric at ${THRESHOLD}% or more. ` +
    "Download the `coverage-reports` artifact below for the line-by-line HTML reports.",
  "",
  `| Package | ${METRICS.map((metric) => metric[0].toUpperCase() + metric.slice(1)).join(" | ")} |`,
  `| --- | ${METRICS.map(() => "---:").join(" | ")} |`,
  ...rows,
  "",
].join("\n");

if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown);
else process.stdout.write(markdown);
