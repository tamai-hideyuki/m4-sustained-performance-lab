import * as fs from "fs";

interface PowerSample {
  cpuPower: number | null;
  gpuPower: number | null;
  anePower: number | null;
  combinedPower: number | null;
  packagePower: number | null;
  pClusterFreqs: number[];
  eClusterFreqs: number[];
  pClusterActiveResidencies: number[];
  eClusterActiveResidencies: number[];
  pClusterIdleResidencies: number[];
  eClusterIdleResidencies: number[];
  pClusterDownResidencies: number[];
  eClusterDownResidencies: number[];
  thermalPressure: string | null;
}

export interface TimeSeriesSample {
  index: number;
  elapsedMs: number;
  cpuPower: number | null;
  gpuPower: number | null;
  combinedPower: number | null;
  pClusterFreq: number | null;
  eClusterFreq: number | null;
  pClusterActiveResidency: number | null;
  eClusterActiveResidency: number | null;
  thermalPressure: string | null;
}

export interface ParseOptions {
  warmupSamples?: number;
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

export interface PowerSummary {
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
  warmupSamplesExcluded: number;
  durationMs: number | null;
  timeseries: TimeSeriesSample[];
}

function extractNumber(text: string, pattern: RegExp): number | null {
  const match = text.match(pattern);
  if (match && match[1]) {
    const val = parseFloat(match[1]);
    return isNaN(val) ? null : val;
  }
  return null;
}

function extractAllNumbers(text: string, pattern: RegExp): number[] {
  const results: number[] = [];
  const matches = text.matchAll(pattern);
  for (const match of matches) {
    if (match[1]) {
      const val = parseFloat(match[1]);
      if (!isNaN(val)) results.push(val);
    }
  }
  return results;
}

function extractString(text: string, pattern: RegExp): string | null {
  const match = text.match(pattern);
  return match && match[1] ? match[1].trim() : null;
}

function parseSample(block: string): PowerSample {
  return {
    cpuPower: extractNumber(block, /CPU Power:\s*([\d.]+)\s*mW/i),
    gpuPower: extractNumber(block, /GPU Power:\s*([\d.]+)\s*mW/i),
    anePower: extractNumber(block, /ANE Power:\s*([\d.]+)\s*mW/i),
    combinedPower: extractNumber(
      block,
      /Combined Power.*?:\s*([\d.]+)\s*mW/i
    ),
    packagePower: extractNumber(block, /Package Power:\s*([\d.]+)\s*mW/i),
    // Match P0-Cluster, P1-Cluster, P-Cluster, E-Cluster, etc.
    pClusterFreqs: extractAllNumbers(
      block,
      /P\d*-Cluster HW active frequency:\s*([\d.]+)\s*MHz/gi
    ),
    eClusterFreqs: extractAllNumbers(
      block,
      /E\d*-Cluster HW active frequency:\s*([\d.]+)\s*MHz/gi
    ),
    pClusterActiveResidencies: extractAllNumbers(
      block,
      /P\d*-Cluster HW active residency:\s*([\d.]+)\s*%/gi
    ),
    eClusterActiveResidencies: extractAllNumbers(
      block,
      /E\d*-Cluster HW active residency:\s*([\d.]+)\s*%/gi
    ),
    // idle and down are separate metrics
    pClusterIdleResidencies: extractAllNumbers(
      block,
      /P\d*-Cluster idle residency:\s*([\d.]+)\s*%/gi
    ),
    eClusterIdleResidencies: extractAllNumbers(
      block,
      /E\d*-Cluster idle residency:\s*([\d.]+)\s*%/gi
    ),
    pClusterDownResidencies: extractAllNumbers(
      block,
      /P\d*-Cluster down residency:\s*([\d.]+)\s*%/gi
    ),
    eClusterDownResidencies: extractAllNumbers(
      block,
      /E\d*-Cluster down residency:\s*([\d.]+)\s*%/gi
    ),
    thermalPressure: extractString(
      block,
      /System Average thermal level:\s*(\S+)/i
    ),
  };
}

function avg(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function percentile(sorted: number[], p: number): number {
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function computeStats(values: (number | null)[]): PowerStats {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) {
    return { avg: null, max: null, min: null, median: null, stddev: null, p5: null, p95: null, samples: 0 };
  }
  const sum = valid.reduce((a, b) => a + b, 0);
  const mean = sum / valid.length;
  const variance = valid.reduce((acc, v) => acc + (v - mean) ** 2, 0) / valid.length;
  const sorted = [...valid].sort((a, b) => a - b);
  return {
    avg: round2(mean),
    max: round2(Math.max(...valid)),
    min: round2(Math.min(...valid)),
    median: round2(percentile(sorted, 50)),
    stddev: round2(Math.sqrt(variance)),
    p5: round2(percentile(sorted, 5)),
    p95: round2(percentile(sorted, 95)),
    samples: valid.length,
  };
}

export function parsePowermetrics(rawText: string, options?: ParseOptions): PowerSummary {
  const warmupSamples = options?.warmupSamples ?? 0;

  // Split into sample blocks by the "Sampled system activity" delimiter
  const blocks = rawText.split(/\*{3,}\s*Sampled system activity/i);

  // Extract per-block elapsed times for timeseries
  const elapsedPerBlock: number[] = [];
  for (let i = 1; i < blocks.length; i++) {
    const m = blocks[i].match(/\((\d+(?:\.\d+)?)\s*ms elapsed\)/i);
    elapsedPerBlock.push(m ? parseFloat(m[1]) : 0);
  }

  const allSamples: PowerSample[] = [];
  for (let i = 1; i < blocks.length; i++) {
    allSamples.push(parseSample(blocks[i]));
  }

  // Build full timeseries (before warmup exclusion)
  let cumulativeMs = 0;
  const timeseries: TimeSeriesSample[] = allSamples.map((s, i) => {
    cumulativeMs += elapsedPerBlock[i];
    return {
      index: i,
      elapsedMs: Math.round(cumulativeMs),
      cpuPower: s.cpuPower,
      gpuPower: s.gpuPower,
      combinedPower: s.combinedPower ?? s.packagePower,
      pClusterFreq: avg(s.pClusterFreqs),
      eClusterFreq: avg(s.eClusterFreqs),
      pClusterActiveResidency: avg(s.pClusterActiveResidencies),
      eClusterActiveResidency: avg(s.eClusterActiveResidencies),
      thermalPressure: s.thermalPressure,
    };
  });

  // Exclude warmup samples from statistics (but keep in timeseries)
  const samples = allSamples.slice(warmupSamples);

  // For combined power, prefer 'Combined Power' then fall back to 'Package Power'
  const combinedValues = samples.map(
    (s) => s.combinedPower ?? s.packagePower
  );

  // For cluster metrics, average across all clusters per sample
  const pFreqPerSample = samples.map((s) => avg(s.pClusterFreqs));
  const eFreqPerSample = samples.map((s) => avg(s.eClusterFreqs));
  const pActivePerSample = samples.map((s) =>
    avg(s.pClusterActiveResidencies)
  );
  const eActivePerSample = samples.map((s) =>
    avg(s.eClusterActiveResidencies)
  );
  const pIdlePerSample = samples.map((s) => avg(s.pClusterIdleResidencies));
  const eIdlePerSample = samples.map((s) => avg(s.eClusterIdleResidencies));
  const pDownPerSample = samples.map((s) => avg(s.pClusterDownResidencies));
  const eDownPerSample = samples.map((s) => avg(s.eClusterDownResidencies));

  // Total duration from all samples (including warmup)
  let durationMs: number | null = null;
  if (elapsedPerBlock.length > 0) {
    durationMs = Math.round(elapsedPerBlock.reduce((a, b) => a + b, 0));
  }

  return {
    cpuPower: computeStats(samples.map((s) => s.cpuPower)),
    gpuPower: computeStats(samples.map((s) => s.gpuPower)),
    combinedPower: computeStats(combinedValues),
    pClusterFreq: computeStats(pFreqPerSample),
    eClusterFreq: computeStats(eFreqPerSample),
    pClusterActiveResidency: computeStats(pActivePerSample),
    eClusterActiveResidency: computeStats(eActivePerSample),
    pClusterIdleResidency: computeStats(pIdlePerSample),
    eClusterIdleResidency: computeStats(eIdlePerSample),
    pClusterDownResidency: computeStats(pDownPerSample),
    eClusterDownResidency: computeStats(eDownPerSample),
    totalSamples: allSamples.length,
    warmupSamplesExcluded: Math.min(warmupSamples, allSamples.length),
    durationMs,
    timeseries,
  };
}

// CLI mode: parse a file directly
if (require.main === module) {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error("Usage: node parse_powermetrics.js <raw_powermetrics.txt>");
    process.exit(1);
  }
  const raw = fs.readFileSync(filePath, "utf-8");
  const summary = parsePowermetrics(raw);
  console.log(JSON.stringify(summary, null, 2));
}
