/**
 * Worker for M4-strengths benchmark.
 * Tests workloads where M4 architecture has advantages:
 * - Hardware-accelerated crypto (SHA-256, AES-256-GCM)
 * - Memory bandwidth (sequential large buffer)
 * - Memory latency (random access)
 * - JSON processing (parse/stringify)
 * - SIMD-like operations (Buffer.compare)
 */
import { parentPort, workerData } from "worker_threads";
import * as crypto from "crypto";

const workloadType = workerData.workloadType as string;
const duration = workerData.duration as number;
const reportInterval = (workerData.reportInterval as number) || 10;

const startTime = Date.now();
const endTime = startTime + duration * 1000;
let iterations = 0;
let lastReportTime = startTime;
let lastReportIterations = 0;

function reportProgress() {
  const now = Date.now();
  if (now - lastReportTime >= reportInterval * 1000) {
    parentPort?.postMessage({
      type: "progress",
      iterations,
      intervalIterations: iterations - lastReportIterations,
      intervalMs: now - lastReportTime,
      elapsedMs: now - startTime,
    });
    lastReportTime = now;
    lastReportIterations = iterations;
  }
}

// ── Workload: SHA-256 ──
// Apple Silicon has hardware SHA acceleration.
// Each iteration hashes a 4KB buffer.
function runSha256() {
  const buf = crypto.randomBytes(4096);
  while (Date.now() < endTime) {
    for (let i = 0; i < 1000; i++) {
      crypto.createHash("sha256").update(buf).digest();
      iterations++;
    }
    reportProgress();
  }
}

// ── Workload: AES-256-GCM ──
// Apple Silicon has hardware AES acceleration.
// Each iteration encrypts a 4KB buffer.
function runAesGcm() {
  const key = crypto.randomBytes(32);
  const plaintext = crypto.randomBytes(4096);
  while (Date.now() < endTime) {
    for (let i = 0; i < 1000; i++) {
      const iv = crypto.randomBytes(12);
      const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
      cipher.update(plaintext);
      cipher.final();
      cipher.getAuthTag();
      iterations++;
    }
    reportProgress();
  }
}

// ── Workload: Memory Bandwidth (Sequential) ──
// Tests sequential read/write throughput on a large buffer.
// M4 has improved memory subsystem.
function runMemoryBandwidth() {
  const size = 64 * 1024 * 1024; // 64MB
  const buf = Buffer.allocUnsafe(size);
  const view = new Float64Array(buf.buffer, buf.byteOffset, size / 8);
  // Initialize
  for (let i = 0; i < view.length; i++) view[i] = i;

  while (Date.now() < endTime) {
    // Sequential scan: read + write (stream-like pattern)
    let sum = 0;
    for (let i = 0; i < view.length; i++) {
      sum += view[i];
      view[i] = sum * 0.5;
    }
    iterations++;
    reportProgress();
  }
}

// ── Workload: Memory Latency (Random Access) ──
// Tests random access latency with pointer chasing.
// M4's larger cache and improved prefetcher should help.
function runMemoryLatency() {
  const size = 16 * 1024 * 1024; // 16M entries
  const arr = new Int32Array(size);
  // Build a random permutation for pointer chasing
  for (let i = 0; i < size; i++) arr[i] = i;
  // Fisher-Yates shuffle
  for (let i = size - 1; i > 0; i--) {
    const j = (Math.random() * (i + 1)) | 0;
    const tmp = arr[i];
    arr[i] = arr[j];
    arr[j] = tmp;
  }

  while (Date.now() < endTime) {
    let idx = 0;
    for (let i = 0; i < 1000000; i++) {
      idx = arr[idx];
      iterations++;
    }
    // Prevent dead-code elimination
    if (idx < 0) console.log(idx);
    reportProgress();
  }
}

// ── Workload: JSON Processing ──
// Tests V8's JSON parser/serializer. M4's wider execution
// and improved branch prediction should help with complex parsing.
function runJson() {
  // Build a moderately complex JSON object
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < 50; i++) {
    obj[`key_${i}`] = {
      id: i,
      name: `item_${i}`,
      values: Array.from({ length: 20 }, (_, j) => j * i * 1.1),
      nested: { a: i, b: `str_${i}`, c: [i, i + 1, i + 2] },
    };
  }
  const jsonStr = JSON.stringify(obj);

  while (Date.now() < endTime) {
    for (let i = 0; i < 100; i++) {
      const parsed = JSON.parse(jsonStr);
      JSON.stringify(parsed);
      iterations++;
    }
    reportProgress();
  }
}

// ── Workload: Regex Processing ──
// Tests V8's regex engine with complex patterns.
// Benefits from improved branch prediction and wider execution.
function runRegex() {
  const text =
    "The quick brown fox jumps over the lazy dog. " +
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. ".repeat(20) +
    "Error: unexpected token at line 42, column 17. " +
    "192.168.1.100 - - [20/Feb/2026:08:30:00 +0900] GET /api/data HTTP/1.1 200";

  const patterns = [
    /\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g,
    /\b[A-Z][a-z]+\b/g,
    /(\w+)\s+\1/gi,
    /\[.*?\]/g,
    /\b\w{5,}\b/g,
  ];

  while (Date.now() < endTime) {
    for (let i = 0; i < 100; i++) {
      for (const pat of patterns) {
        pat.lastIndex = 0;
        let m;
        while ((m = pat.exec(text)) !== null) {
          // consume match
        }
      }
      iterations++;
    }
    reportProgress();
  }
}

// Dispatch
switch (workloadType) {
  case "sha256":
    runSha256();
    break;
  case "aes-gcm":
    runAesGcm();
    break;
  case "memory-bandwidth":
    runMemoryBandwidth();
    break;
  case "memory-latency":
    runMemoryLatency();
    break;
  case "json":
    runJson();
    break;
  case "regex":
    runRegex();
    break;
  default:
    throw new Error(`Unknown workload type: ${workloadType}`);
}

parentPort?.postMessage({
  type: "done",
  iterations,
  elapsed: Date.now() - startTime,
});
