import { Worker } from "worker_threads";
import * as path from "path";

export interface StressResult {
  workerId: number;
  iterations: number;
  elapsed: number;
}

export function runCpuStress(
  duration: number,
  workers: number
): Promise<StressResult[]> {
  return new Promise((resolve, reject) => {
    const results: StressResult[] = [];
    let completed = 0;
    const workerPath = path.join(__dirname, "cpu_stress_worker.js");

    for (let i = 0; i < workers; i++) {
      const worker = new Worker(workerPath, {
        workerData: { duration },
      });

      worker.on("message", (msg) => {
        results.push({ workerId: i, ...msg });
        completed++;
        if (completed === workers) {
          resolve(results);
        }
      });

      worker.on("error", reject);
    }
  });
}
