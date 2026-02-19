import * as fs from "fs";
import * as path from "path";

interface RunJson {
  machine: string;
  duration: number;
  workers: number;
  model: string;
  chip: string;
}

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

interface Result {
  dir: string;
  run: RunJson;
  summary: SummaryJson;
}

function loadResults(machine: string): Result[] {
  const machineDir = path.join(process.cwd(), "results", machine);
  if (!fs.existsSync(machineDir)) return [];

  return fs
    .readdirSync(machineDir)
    .filter((e) => e !== "latest" && !e.startsWith("."))
    .sort()
    .map((e) => {
      const dir = path.join(machineDir, e);
      try {
        const run: RunJson = JSON.parse(
          fs.readFileSync(path.join(dir, "run.json"), "utf-8")
        );
        const summary: SummaryJson = JSON.parse(
          fs.readFileSync(path.join(dir, "summary.json"), "utf-8")
        );
        return { dir, run, summary };
      } catch {
        return null;
      }
    })
    .filter((r): r is Result => r !== null)
    .sort((a, b) => a.run.duration - b.run.duration);
}

function fmtNum(v: number | null | undefined, decimals = 0): string {
  if (v == null) return "N/A";
  return v.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function pctChange(from: number | null | undefined, to: number | null | undefined): string {
  if (from == null || to == null || from === 0) return "";
  const diff = ((to - from) / from) * 100;
  const sign = diff > 0 ? "+" : "";
  return `${sign}${diff.toFixed(1)}%`;
}

function durLabel(dur: number): string {
  if (dur < 120) return `${dur}s`;
  return `${Math.round(dur / 60)}min`;
}

function discoverMachines(): string[] {
  const resultsDir = path.join(process.cwd(), "results");
  if (!fs.existsSync(resultsDir)) return [];
  return fs
    .readdirSync(resultsDir)
    .filter((e) => {
      if (e.startsWith(".")) return false;
      const full = path.join(resultsDir, e);
      return fs.statSync(full).isDirectory();
    })
    .sort();
}

function main() {
  // Auto-discover all machines under results/
  const machineNames = discoverMachines();
  const machines: { name: string; results: Result[] }[] = [];
  for (const name of machineNames) {
    const results = loadResults(name);
    if (results.length > 0) {
      machines.push({ name, results });
    }
  }

  if (machines.length === 0) {
    console.error("No results found. Run benchmarks first.");
    process.exit(1);
  }

  // Build columns: each result is a column
  const allResults: { label: string; result: Result }[] = [];
  for (const m of machines) {
    for (const r of m.results) {
      allResults.push({
        label: `${m.name.toUpperCase()} ${durLabel(r.run.duration)}`,
        result: r,
      });
    }
  }

  const COL = 16;
  const LABEL_W = 24;
  const W = LABEL_W + COL * allResults.length;
  const sep = "=".repeat(W);
  const line = "-".repeat(W);

  console.log(sep);
  console.log("  M4 Sustained Performance Lab - Full Comparison");
  console.log(sep);

  // Machine info
  for (const m of machines) {
    const r = m.results[0].run;
    console.log(
      `  ${m.name.toUpperCase()}: ${r.model}  (${r.workers} workers)`
    );
  }
  console.log(sep);

  // Header
  let header = "".padEnd(LABEL_W);
  for (const col of allResults) {
    header += col.label.padStart(COL);
  }
  console.log(header);
  console.log(line);

  // Row helper
  const row = (
    label: string,
    getter: (s: SummaryJson) => number | null,
    unit: string,
    decimals = 0
  ) => {
    let line = label.padEnd(LABEL_W);
    for (const col of allResults) {
      const v = getter(col.result.summary);
      line += (fmtNum(v, decimals) + unit).padStart(COL);
    }
    console.log(line);
  };

  row("CPU Power avg", (s) => s.cpuPower.avg, " mW");
  row("CPU Power median", (s) => s.cpuPower.median, " mW");
  row("CPU Power stddev", (s) => s.cpuPower.stddev, " mW");
  row("CPU Power max", (s) => s.cpuPower.max, " mW");
  row("CPU Power min", (s) => s.cpuPower.min, " mW");
  console.log();
  row("Combined Power avg", (s) => s.combinedPower.avg, " mW");
  row("Combined Power stddev", (s) => s.combinedPower.stddev, " mW");
  console.log();
  row("P-Cluster Freq avg", (s) => s.pClusterFreq.avg, " MHz");
  row("P-Cluster Freq median", (s) => s.pClusterFreq.median, " MHz");
  row("P-Cluster Freq stddev", (s) => s.pClusterFreq.stddev, " MHz");
  row("P-Cluster Freq max", (s) => s.pClusterFreq.max, " MHz");
  row("E-Cluster Freq avg", (s) => s.eClusterFreq.avg, " MHz");
  console.log();
  row("P-Cluster Active %", (s) => s.pClusterActiveResidency.avg, "%", 1);
  row("E-Cluster Active %", (s) => s.eClusterActiveResidency.avg, "%", 1);
  row("P-Cluster Idle %", (s) => s.pClusterIdleResidency.avg, "%", 2);
  row("E-Cluster Idle %", (s) => s.eClusterIdleResidency.avg, "%", 2);
  console.log();
  row("Iterations/s", (s) => s.stress.iterationsPerSecond, "");
  row("Samples", (s) => s.totalSamples, "");

  // Degradation table
  console.log();
  console.log(sep);
  console.log("  Performance Degradation (60s -> longest)");
  console.log(line);

  for (const m of machines) {
    if (m.results.length < 2) continue;
    const first = m.results[0];
    const last = m.results[m.results.length - 1];
    const dur1 = durLabel(first.run.duration);
    const dur2 = durLabel(last.run.duration);

    console.log(
      `\n  ${m.name.toUpperCase()} (${dur1} -> ${dur2}):`
    );
    console.log(
      `    CPU Power avg:   ${fmtNum(first.summary.cpuPower.avg)} -> ${fmtNum(last.summary.cpuPower.avg)} mW  (${pctChange(first.summary.cpuPower.avg, last.summary.cpuPower.avg)})`
    );
    console.log(
      `    P-Cluster Freq:  ${fmtNum(first.summary.pClusterFreq.avg)} -> ${fmtNum(last.summary.pClusterFreq.avg)} MHz  (${pctChange(first.summary.pClusterFreq.avg, last.summary.pClusterFreq.avg)})`
    );
    console.log(
      `    Iterations/s:    ${fmtNum(first.summary.stress.iterationsPerSecond)} -> ${fmtNum(last.summary.stress.iterationsPerSecond)}  (${pctChange(first.summary.stress.iterationsPerSecond, last.summary.stress.iterationsPerSecond)})`
    );
  }

  console.log();
  console.log(sep);
}

main();
