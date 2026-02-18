import { Worker } from "worker_threads";
import * as path from "path";

export interface StressResult {
  workerId: number;
  iterations: number;
  elapsed: number;
}

export interface StressProgress {
  workerId: number;
  iterations: number;
  intervalIterations: number;
  intervalMs: number;
  elapsedMs: number;
}

export interface StressOutput {
  results: StressResult[];
  progress: StressProgress[];
}

export function runCpuStress(
  duration: number,
  workers: number,
  reportInterval: number = 10,
  onProgress?: (p: StressProgress) => void
): Promise<StressOutput> {
  return new Promise((resolve, reject) => {
    const results: StressResult[] = [];
    const progress: StressProgress[] = [];
    let completed = 0;
    const workerPath = path.join(__dirname, "cpu_stress_worker.js");

    for (let i = 0; i < workers; i++) {
      const worker = new Worker(workerPath, {
        workerData: { duration, reportInterval },
      });

      worker.on("message", (msg) => {
        if (msg.type === "progress") {
          const p: StressProgress = { workerId: i, ...msg };
          progress.push(p);
          onProgress?.(p);
        } else if (msg.type === "done") {
          results.push({ workerId: i, iterations: msg.iterations, elapsed: msg.elapsed });
          completed++;
          if (completed === workers) {
            resolve({ results, progress });
          }
        }
      });

      worker.on("error", reject);
    }
  });
}
