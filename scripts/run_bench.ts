import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import { runCpuStress } from "./cpu_stress";
import { parsePowermetrics } from "./parse_powermetrics";

function parseArgs() {
  const args = process.argv.slice(2);
  let duration = 60;
  let interval = 1000;
  let workers = os.cpus().length;
  let machine = process.env.MACHINE || "unknown";
  let warmup = 5; // warmup samples to exclude from stats (default 5)

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--duration":
        duration = parseInt(args[++i], 10);
        break;
      case "--interval":
        interval = parseInt(args[++i], 10);
        break;
      case "--workers":
        workers = parseInt(args[++i], 10);
        break;
      case "--machine":
        machine = args[++i];
        break;
      case "--warmup":
        warmup = parseInt(args[++i], 10);
        break;
    }
  }

  return { duration, interval, workers, machine, warmup };
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

async function main() {
  const config = parseArgs();
  const timestamp = getTimestamp();
  const projectRoot = process.cwd();
  const resultDir = path.join(projectRoot, "results", config.machine, timestamp);
  const latestLink = path.join(projectRoot, "results", config.machine, "latest");

  // 1. Create results directory
  fs.mkdirSync(resultDir, { recursive: true });

  const sep = "=".repeat(60);
  console.log(sep);
  console.log("  M4 Sustained Performance Lab");
  console.log(sep);
  console.log(`  Machine:   ${config.machine}`);
  console.log(`  Duration:  ${config.duration}s`);
  console.log(`  Workers:   ${config.workers}`);
  console.log(`  Interval:  ${config.interval}ms`);
  console.log(`  Warmup:    ${config.warmup} samples excluded`);
  console.log(`  Output:    ${resultDir}`);
  console.log(sep);

  // 2. Write run.json
  const runInfo: Record<string, unknown> = {
    machine: config.machine,
    timestamp,
    duration: config.duration,
    interval: config.interval,
    workers: config.workers,
    warmup: config.warmup,
    nodeVersion: process.version,
    macosVersion: shellExec("sw_vers -productVersion"),
    chip: shellExec("sysctl -n machdep.cpu.brand_string"),
    model: getModelInfo(),
    arch: os.arch(),
    cpuCount: os.cpus().length,
    totalMemory: `${Math.round(os.totalmem() / 1024 / 1024 / 1024)}GB`,
    startedAt: new Date().toISOString(),
  };
  fs.writeFileSync(
    path.join(resultDir, "run.json"),
    JSON.stringify(runInfo, null, 2)
  );

  // 3. Create empty notes.md
  fs.writeFileSync(
    path.join(resultDir, "notes.md"),
    `# Notes: ${config.machine} / ${timestamp}\n\n<!-- Write your observations here -->\n`
  );

  // 4. Start powermetrics
  const rawLogPath = path.join(resultDir, "raw_powermetrics.txt");
  const logStream = fs.createWriteStream(rawLogPath);

  console.log("\n[*] Starting powermetrics (requires sudo)...");

  const powermetrics = spawn(
    "sudo",
    [
      "powermetrics",
      "--samplers",
      "cpu_power,thermal",
      "-i",
      String(config.interval),
    ],
    { stdio: ["inherit", "pipe", "pipe"] }
  );

  powermetrics.stdout.on("data", (data: Buffer) => {
    logStream.write(data);
  });

  powermetrics.stderr.on("data", (data: Buffer) => {
    const msg = data.toString();
    if (!msg.includes("Password:")) {
      process.stderr.write(data);
    }
  });

  // Give powermetrics time to start (password prompt + init)
  await new Promise((resolve) => setTimeout(resolve, 2000));

  // 5. Start CPU stress
  console.log(
    `[*] Starting CPU stress (${config.workers} workers, ${config.duration}s)...`
  );
  const stressStart = Date.now();
  const stressOutput = await runCpuStress(config.duration, config.workers, 10, (p) => {
    if (p.workerId === 0) {
      const ips = Math.round(p.intervalIterations / (p.intervalMs / 1000));
      console.log(`[*] Progress: ${(p.elapsedMs / 1000).toFixed(0)}s elapsed, worker0 IPS=${ips.toLocaleString()}`);
    }
  });
  const stressElapsed = Date.now() - stressStart;
  console.log(
    `[*] CPU stress completed in ${(stressElapsed / 1000).toFixed(1)}s`
  );

  const totalIterations = stressOutput.results.reduce(
    (sum: number, r) => sum + r.iterations,
    0
  );
  console.log(`[*] Total iterations: ${totalIterations.toLocaleString()}`);

  // 6. Stop powermetrics
  console.log("[*] Stopping powermetrics...");

  // Remove data listener to prevent writes after logStream.end()
  powermetrics.stdout.removeAllListeners("data");

  // sudo -n = non-interactive (never prompt for password, fail immediately if no cached creds)
  // timeout = prevent execSync from hanging forever
  try {
    execSync("sudo -n pkill -x powermetrics", {
      stdio: "ignore",
      timeout: 3000,
    });
  } catch {
    // Fallback: kill the sudo wrapper process
    try {
      if (powermetrics.pid) process.kill(powermetrics.pid, "SIGTERM");
    } catch {
      // already exited
    }
  }

  // Disconnect pipes so Node.js doesn't wait for the child process
  powermetrics.stdout.destroy();
  powermetrics.stderr.destroy();
  powermetrics.unref();

  // Flush log
  logStream.end();
  await new Promise<void>((resolve) => logStream.on("finish", resolve));

  // 7. Parse powermetrics and generate summary
  console.log("[*] Parsing powermetrics output...");
  const rawText = fs.readFileSync(rawLogPath, "utf-8");
  const powerSummary = parsePowermetrics(rawText, { warmupSamples: config.warmup });

  // Aggregate per-worker progress into throughput timeseries
  const progressByTime = new Map<number, { totalIps: number; count: number }>();
  for (const p of stressOutput.progress) {
    const sec = Math.round(p.elapsedMs / 1000);
    const entry = progressByTime.get(sec) || { totalIps: 0, count: 0 };
    entry.totalIps += Math.round(p.intervalIterations / (p.intervalMs / 1000));
    entry.count++;
    progressByTime.set(sec, entry);
  }
  const throughputTimeseries = Array.from(progressByTime.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([sec, v]) => ({ elapsedSec: sec, aggregateIps: v.totalIps }));

  const summary = {
    ...powerSummary,
    stress: {
      workers: config.workers,
      totalIterations,
      elapsedMs: stressElapsed,
      iterationsPerSecond: Math.round(
        totalIterations / (stressElapsed / 1000)
      ),
      perWorker: stressOutput.results.map((r) => ({
        workerId: r.workerId,
        iterations: r.iterations,
        elapsedMs: r.elapsed,
      })),
      throughputTimeseries,
    },
    completedAt: new Date().toISOString(),
  };

  fs.writeFileSync(
    path.join(resultDir, "summary.json"),
    JSON.stringify(summary, null, 2)
  );

  // 8. Update run.json with completion time
  runInfo.completedAt = new Date().toISOString();
  fs.writeFileSync(
    path.join(resultDir, "run.json"),
    JSON.stringify(runInfo, null, 2)
  );

  // 9. Create/update latest symlink
  try {
    if (fs.existsSync(latestLink)) {
      fs.unlinkSync(latestLink);
    }
    fs.symlinkSync(timestamp, latestLink);
    console.log(`[*] Updated latest symlink -> ${timestamp}`);
  } catch (e) {
    console.warn("[!] Could not create latest symlink:", (e as Error).message);
  }

  // 10. Print results summary
  console.log("\n" + sep);
  console.log("  Results saved to:");
  console.log(`  ${resultDir}/`);
  console.log("    run.json");
  console.log("    raw_powermetrics.txt");
  console.log("    summary.json");
  console.log("    notes.md");
  console.log(sep);

  if (powerSummary.warmupSamplesExcluded > 0) {
    console.log(`\n  Warmup:         ${powerSummary.warmupSamplesExcluded} samples excluded from stats`);
  }
  if (powerSummary.cpuPower.avg !== null) {
    console.log(
      `  CPU Power:      avg=${powerSummary.cpuPower.avg} mW  median=${powerSummary.cpuPower.median} mW  stddev=${powerSummary.cpuPower.stddev} mW`
    );
  }
  if (powerSummary.combinedPower.avg !== null) {
    console.log(
      `  Combined Power: avg=${powerSummary.combinedPower.avg} mW  stddev=${powerSummary.combinedPower.stddev} mW`
    );
  }
  if (powerSummary.pClusterFreq.avg !== null) {
    console.log(
      `  P-Cluster Freq: avg=${powerSummary.pClusterFreq.avg} MHz  median=${powerSummary.pClusterFreq.median} MHz  stddev=${powerSummary.pClusterFreq.stddev} MHz`
    );
  }
  if (powerSummary.eClusterFreq.avg !== null) {
    console.log(
      `  E-Cluster Freq: avg=${powerSummary.eClusterFreq.avg} MHz  median=${powerSummary.eClusterFreq.median} MHz`
    );
  }
  console.log(
    `  Iterations/s:   ${summary.stress.iterationsPerSecond.toLocaleString()}`
  );
  console.log(`  Total samples:  ${powerSummary.totalSamples} (${powerSummary.totalSamples - powerSummary.warmupSamplesExcluded} used for stats)`);
  console.log();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
