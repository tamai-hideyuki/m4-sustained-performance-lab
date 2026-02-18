import { parentPort, workerData } from "worker_threads";

const duration = workerData.duration as number; // seconds
const reportInterval = workerData.reportInterval as number || 10; // seconds
const startTime = Date.now();
const endTime = startTime + duration * 1000;

let iterations = 0;
let lastReportTime = startTime;
let lastReportIterations = 0;

// Deterministic xorshift128+ PRNG (reproducible workload)
let s0 = 0x12345678;
let s1 = 0x9abcdef0;
function xorshift128plus(): number {
  let x = s0;
  const y = s1;
  s0 = y;
  x ^= x << 23;
  x ^= x >> 17;
  x ^= y;
  x ^= y >> 26;
  s1 = x;
  return (s0 + s1) >>> 0;
}

// CPU-intensive busy loop with mixed mathematical operations
// Uses deterministic PRNG for reproducible workload across runs
while (Date.now() < endTime) {
  for (let i = 0; i < 10000; i++) {
    Math.sqrt(xorshift128plus() * 1e-9);
    Math.sin(iterations + i);
    Math.cos(iterations + i);
    Math.atan2(iterations, i + 1);
    iterations++;
  }

  // Periodic intermediate report
  const now = Date.now();
  if (now - lastReportTime >= reportInterval * 1000) {
    const intervalIterations = iterations - lastReportIterations;
    const intervalMs = now - lastReportTime;
    parentPort?.postMessage({
      type: "progress",
      iterations,
      intervalIterations,
      intervalMs,
      elapsedMs: now - startTime,
    });
    lastReportTime = now;
    lastReportIterations = iterations;
  }
}

parentPort?.postMessage({
  type: "done",
  iterations,
  elapsed: Date.now() - startTime,
});
