import { parentPort, workerData } from "worker_threads";

const duration = workerData.duration as number; // seconds
const startTime = Date.now();
const endTime = startTime + duration * 1000;

let iterations = 0;

// CPU-intensive busy loop with mixed mathematical operations
// This stresses both integer and floating-point units
while (Date.now() < endTime) {
  for (let i = 0; i < 10000; i++) {
    Math.sqrt(Math.random() * Number.MAX_SAFE_INTEGER);
    Math.sin(iterations + i);
    Math.cos(iterations + i);
    Math.atan2(iterations, i + 1);
    iterations++;
  }
}

parentPort?.postMessage({ iterations, elapsed: Date.now() - startTime });
