import * as fs from "fs";
import * as path from "path";

interface PowerStats {
  avg: number | null;
  max: number | null;
  min: number | null;
  median: number | null;
  stddev: number | null;
  p5: number | null;
  p95: number | null;
  samples: number;
}

interface SummaryJson {
  cpuPower: PowerStats;
  gpuPower: PowerStats;
  combinedPower: PowerStats;
  pClusterFreq: PowerStats;
  eClusterFreq: PowerStats;
  pClusterActiveResidency: PowerStats;
  eClusterActiveResidency: PowerStats;
  pClusterIdleResidency: PowerStats;
  eClusterIdleResidency: PowerStats;
  pClusterDownResidency: PowerStats;
  eClusterDownResidency: PowerStats;
  totalSamples: number;
  durationMs: number | null;
  stress: {
    workers: number;
    totalIterations: number;
    elapsedMs: number;
    iterationsPerSecond: number;
  };
}

function findLatestResult(machine: string): string | null {
  const projectRoot = process.cwd();
  const machineDir = path.join(projectRoot, "results", machine);

  if (!fs.existsSync(machineDir)) return null;

  // Try latest symlink first
  const latestLink = path.join(machineDir, "latest");
  if (fs.existsSync(latestLink)) {
    try {
      const target = fs.readlinkSync(latestLink);
      const resolved = path.resolve(machineDir, target);
      if (fs.existsSync(resolved)) return resolved;
    } catch {
      // fall through
    }
  }

  // Fall back to most recent directory by name (alphabetical = chronological)
  const entries = fs
    .readdirSync(machineDir)
    .filter((e) => e !== "latest" && !e.startsWith("."))
    .sort()
    .reverse();

  if (entries.length === 0) return null;
  return path.join(machineDir, entries[0]);
}

function loadJson<T>(dir: string, filename: string): T {
  return JSON.parse(fs.readFileSync(path.join(dir, filename), "utf-8"));
}

function fmtVal(v: number | null | undefined, unit: string): string {
  if (v == null) return "N/A";
  return `${v.toLocaleString()}${unit}`;
}

function pctDiff(a: number | null | undefined, b: number | null | undefined): string {
  if (a == null || b == null || b === 0) return "";
  const diff = ((a - b) / b) * 100;
  const sign = diff > 0 ? "+" : "";
  return `(${sign}${diff.toFixed(1)}%)`;
}

function main() {
  const args = process.argv.slice(2);
  let machineA = "pro";
  let machineB = "air";

  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--a") machineA = args[++i];
    if (args[i] === "--b") machineB = args[++i];
  }

  const dirA = findLatestResult(machineA);
  const dirB = findLatestResult(machineB);

  if (!dirA) {
    console.error(`No results found for machine: ${machineA}`);
    console.error(
      `Run benchmarks first: MACHINE=${machineA} npm run bench:short`
    );
    process.exit(1);
  }
  if (!dirB) {
    console.error(`No results found for machine: ${machineB}`);
    console.error(
      `Run benchmarks first: MACHINE=${machineB} npm run bench:short`
    );
    process.exit(1);
  }

  const summaryA = loadJson<SummaryJson>(dirA, "summary.json");
  const summaryB = loadJson<SummaryJson>(dirB, "summary.json");
  const runA = loadJson<Record<string, unknown>>(dirA, "run.json");
  const runB = loadJson<Record<string, unknown>>(dirB, "run.json");

  const W = 72;
  const sep = "=".repeat(W);
  const line = "-".repeat(W);

  console.log(sep);
  console.log("  M4 Sustained Performance Lab - Comparison Report");
  console.log(sep);
  console.log();

  console.log(`  Machine A: ${machineA.toUpperCase()}`);
  console.log(`    Model:    ${runA.model || "N/A"}`);
  console.log(`    Chip:     ${runA.chip || "N/A"}`);
  console.log(`    Workers:  ${runA.workers}   Duration: ${runA.duration}s`);
  console.log();

  console.log(`  Machine B: ${machineB.toUpperCase()}`);
  console.log(`    Model:    ${runB.model || "N/A"}`);
  console.log(`    Chip:     ${runB.chip || "N/A"}`);
  console.log(`    Workers:  ${runB.workers}   Duration: ${runB.duration}s`);
  console.log();

  // Validation warnings
  if (runA.duration !== runB.duration) {
    console.log(`  ⚠ WARNING: Duration mismatch (${runA.duration}s vs ${runB.duration}s) — comparison may be misleading`);
    console.log();
  }
  if (runA.workers !== runB.workers) {
    console.log(`  ⚠ NOTE: Different worker counts (${runA.workers} vs ${runB.workers})`);
    console.log();
  }

  console.log(line);

  const col = (s: string, w: number) => s.padEnd(w);
  const rCol = (s: string, w: number) => s.padStart(w);

  console.log(
    `${col("Metric", 30)} ${rCol(machineA.toUpperCase(), 14)} ${rCol(machineB.toUpperCase(), 14)} ${rCol("Diff", 12)}`
  );
  console.log(line);

  const row = (
    label: string,
    valA: number | null,
    valB: number | null,
    unit: string
  ) => {
    console.log(
      `${col(label, 30)} ${rCol(fmtVal(valA, unit), 14)} ${rCol(fmtVal(valB, unit), 14)} ${rCol(pctDiff(valA, valB), 12)}`
    );
  };

  row("CPU Power avg", summaryA.cpuPower.avg, summaryB.cpuPower.avg, " mW");
  row("CPU Power median", summaryA.cpuPower.median, summaryB.cpuPower.median, " mW");
  row("CPU Power stddev", summaryA.cpuPower.stddev, summaryB.cpuPower.stddev, " mW");
  row("CPU Power p5", summaryA.cpuPower.p5, summaryB.cpuPower.p5, " mW");
  row("CPU Power p95", summaryA.cpuPower.p95, summaryB.cpuPower.p95, " mW");
  row("CPU Power max", summaryA.cpuPower.max, summaryB.cpuPower.max, " mW");
  row("CPU Power min", summaryA.cpuPower.min, summaryB.cpuPower.min, " mW");
  console.log();

  row(
    "Combined Power avg",
    summaryA.combinedPower.avg,
    summaryB.combinedPower.avg,
    " mW"
  );
  row(
    "Combined Power stddev",
    summaryA.combinedPower.stddev,
    summaryB.combinedPower.stddev,
    " mW"
  );
  row(
    "Combined Power max",
    summaryA.combinedPower.max,
    summaryB.combinedPower.max,
    " mW"
  );
  row(
    "Combined Power min",
    summaryA.combinedPower.min,
    summaryB.combinedPower.min,
    " mW"
  );
  console.log();

  row("GPU Power avg", summaryA.gpuPower.avg, summaryB.gpuPower.avg, " mW");
  console.log();

  row(
    "P-Cluster Freq avg",
    summaryA.pClusterFreq.avg,
    summaryB.pClusterFreq.avg,
    " MHz"
  );
  row(
    "P-Cluster Freq median",
    summaryA.pClusterFreq.median,
    summaryB.pClusterFreq.median,
    " MHz"
  );
  row(
    "P-Cluster Freq stddev",
    summaryA.pClusterFreq.stddev,
    summaryB.pClusterFreq.stddev,
    " MHz"
  );
  row(
    "P-Cluster Freq max",
    summaryA.pClusterFreq.max,
    summaryB.pClusterFreq.max,
    " MHz"
  );
  row(
    "E-Cluster Freq avg",
    summaryA.eClusterFreq.avg,
    summaryB.eClusterFreq.avg,
    " MHz"
  );
  row(
    "E-Cluster Freq max",
    summaryA.eClusterFreq.max,
    summaryB.eClusterFreq.max,
    " MHz"
  );
  console.log();

  row(
    "P-Cluster Active Res avg",
    summaryA.pClusterActiveResidency.avg,
    summaryB.pClusterActiveResidency.avg,
    "%"
  );
  row(
    "E-Cluster Active Res avg",
    summaryA.eClusterActiveResidency.avg,
    summaryB.eClusterActiveResidency.avg,
    "%"
  );
  row(
    "P-Cluster Idle Res avg",
    summaryA.pClusterIdleResidency.avg,
    summaryB.pClusterIdleResidency.avg,
    "%"
  );
  row(
    "E-Cluster Idle Res avg",
    summaryA.eClusterIdleResidency.avg,
    summaryB.eClusterIdleResidency.avg,
    "%"
  );
  row(
    "P-Cluster Down Res avg",
    summaryA.pClusterDownResidency.avg,
    summaryB.pClusterDownResidency.avg,
    "%"
  );
  row(
    "E-Cluster Down Res avg",
    summaryA.eClusterDownResidency.avg,
    summaryB.eClusterDownResidency.avg,
    "%"
  );
  console.log();

  row(
    "Iterations/s",
    summaryA.stress.iterationsPerSecond,
    summaryB.stress.iterationsPerSecond,
    ""
  );
  row(
    "Total Iterations",
    summaryA.stress.totalIterations,
    summaryB.stress.totalIterations,
    ""
  );

  console.log();
  console.log(line);
  console.log(
    `  Samples: ${machineA}=${summaryA.totalSamples}  ${machineB}=${summaryB.totalSamples}`
  );
  console.log(sep);
}

main();
