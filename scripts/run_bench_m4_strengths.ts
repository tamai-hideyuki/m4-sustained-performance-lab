/**
 * M4 Strengths Benchmark Runner
 *
 * Tests workloads where M4 architecture has advantages over M3:
 * - Hardware crypto (SHA-256, AES-256-GCM)
 * - Memory bandwidth & latency
 * - JSON processing
 * - Regex processing
 *
 * Runs each workload sequentially with all cores, measuring ops/sec.
 */
import { Worker } from "worker_threads";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { execSync } from "child_process";

interface WorkloadResult {
  workload: string;
  description: string;
  totalIterations: number;
  elapsedMs: number;
  opsPerSecond: number;
  perWorker: { workerId: number; iterations: number; elapsedMs: number }[];
}

interface BenchResult {
  machine: string;
  timestamp: string;
  durationPerTest: number;
  workers: number;
  nodeVersion: string;
  model: string;
  chip: string;
  arch: string;
  cpuCount: number;
  totalMemory: string;
  workloads: WorkloadResult[];
  startedAt: string;
  completedAt?: string;
}

const WORKLOADS = [
  { type: "sha256", desc: "SHA-256 hash (4KB, hardware accel)" },
  { type: "aes-gcm", desc: "AES-256-GCM encrypt (4KB, hardware accel)" },
  { type: "memory-bandwidth", desc: "Sequential 64MB Float64 read/write" },
  { type: "memory-latency", desc: "Random pointer chasing (16M entries)" },
  { type: "json", desc: "JSON parse + stringify (complex object)" },
  { type: "regex", desc: "Complex regex matching (5 patterns)" },
];

function parseArgs() {
  const args = process.argv.slice(2);
  let durationPerTest = 30;
  let workerCount = os.cpus().length;
  let machine = process.env.MACHINE || "unknown";

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--duration":
        durationPerTest = parseInt(args[++i], 10);
        break;
      case "--workers":
        workerCount = parseInt(args[++i], 10);
        break;
      case "--machine":
        machine = args[++i];
        break;
    }
  }
  return { durationPerTest, workerCount, machine };
}

function getTimestamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return [
    now.getFullYear(),
    pad(now.getMonth() + 1),
    pad(now.getDate()),
    "_",
    pad(now.getHours()),
    pad(now.getMinutes()),
    pad(now.getSeconds()),
  ].join("");
}

function shellExec(cmd: string): string {
  try {
    return execSync(cmd, { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

function getModelInfo(): string {
  try {
    const output = execSync("system_profiler SPHardwareDataType", {
      encoding: "utf-8",
    });
    const modelMatch = output.match(/Model Name:\s*(.+)/);
    const chipMatch = output.match(/Chip:\s*(.+)/);
    const parts: string[] = [];
    if (modelMatch) parts.push(modelMatch[1].trim());
    if (chipMatch) parts.push(chipMatch[1].trim());
    return parts.join(" / ") || "unknown";
  } catch {
    return "unknown";
  }
}

function runWorkload(
  workloadType: string,
  duration: number,
  workerCount: number
): Promise<{ results: { workerId: number; iterations: number; elapsed: number }[] }> {
  return new Promise((resolve, reject) => {
    const results: { workerId: number; iterations: number; elapsed: number }[] = [];
    let completed = 0;
    const workerPath = path.join(__dirname, "bench_m4_worker.js");

    for (let i = 0; i < workerCount; i++) {
      const worker = new Worker(workerPath, {
        workerData: { workloadType, duration, reportInterval: 10 },
      });

      worker.on("message", (msg) => {
        if (msg.type === "done") {
          results.push({
            workerId: i,
            iterations: msg.iterations,
            elapsed: msg.elapsed,
          });
          completed++;
          if (completed === workerCount) {
            resolve({ results });
          }
        }
      });

      worker.on("error", reject);
    }
  });
}

function fmtNum(v: number): string {
  return v.toLocaleString();
}

async function main() {
  const config = parseArgs();
  const timestamp = getTimestamp();
  const totalDuration = config.durationPerTest * WORKLOADS.length;

  const sep = "=".repeat(70);
  const line = "-".repeat(70);

  console.log(sep);
  console.log("  M4 Strengths Benchmark");
  console.log(sep);
  console.log(`  Machine:          ${config.machine}`);
  console.log(`  Workers:          ${config.workerCount}`);
  console.log(`  Duration/test:    ${config.durationPerTest}s`);
  console.log(`  Tests:            ${WORKLOADS.length}`);
  console.log(`  Total est. time:  ${Math.round(totalDuration / 60)}min ${totalDuration % 60}s`);
  console.log(sep);

  const benchResult: BenchResult = {
    machine: config.machine,
    timestamp,
    durationPerTest: config.durationPerTest,
    workers: config.workerCount,
    nodeVersion: process.version,
    model: getModelInfo(),
    chip: shellExec("sysctl -n machdep.cpu.brand_string"),
    arch: os.arch(),
    cpuCount: os.cpus().length,
    totalMemory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`,
    workloads: [],
    startedAt: new Date().toISOString(),
  };

  for (let idx = 0; idx < WORKLOADS.length; idx++) {
    const wl = WORKLOADS[idx];
    console.log(
      `\n[${idx + 1}/${WORKLOADS.length}] ${wl.type}: ${wl.desc}`
    );
    console.log(`    Running ${config.workerCount} workers for ${config.durationPerTest}s...`);

    const start = Date.now();
    const output = await runWorkload(
      wl.type,
      config.durationPerTest,
      config.workerCount
    );
    const elapsed = Date.now() - start;

    const totalIter = output.results.reduce((s, r) => s + r.iterations, 0);
    const opsPerSec = Math.round(totalIter / (elapsed / 1000));

    benchResult.workloads.push({
      workload: wl.type,
      description: wl.desc,
      totalIterations: totalIter,
      elapsedMs: elapsed,
      opsPerSecond: opsPerSec,
      perWorker: output.results.map((r) => ({
        workerId: r.workerId,
        iterations: r.iterations,
        elapsedMs: r.elapsed,
      })),
    });

    console.log(`    Done: ${fmtNum(opsPerSec)} ops/s (total: ${fmtNum(totalIter)})`);
  }

  benchResult.completedAt = new Date().toISOString();

  // Save results
  const resultDir = path.join(
    process.cwd(),
    "results_m4",
    config.machine,
    timestamp
  );
  fs.mkdirSync(resultDir, { recursive: true });
  fs.writeFileSync(
    path.join(resultDir, "m4_strengths.json"),
    JSON.stringify(benchResult, null, 2)
  );

  // Print summary table
  console.log("\n" + sep);
  console.log("  Results Summary");
  console.log(sep);

  const COL_W = 22;
  const NUM_W = 18;
  console.log(
    "  " + "Workload".padEnd(COL_W) + "ops/s".padStart(NUM_W) + "  total ops".padStart(NUM_W)
  );
  console.log("  " + line.slice(2));

  for (const wl of benchResult.workloads) {
    console.log(
      "  " +
        wl.workload.padEnd(COL_W) +
        fmtNum(wl.opsPerSecond).padStart(NUM_W) +
        fmtNum(wl.totalIterations).padStart(NUM_W)
    );
  }

  console.log(sep);
  console.log(`  Saved to: ${resultDir}/m4_strengths.json`);
  console.log(sep);
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
