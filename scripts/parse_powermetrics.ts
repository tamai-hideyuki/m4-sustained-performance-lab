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
}

interface PowerStats {
  avg: number | null;
  max: number | null;
  min: number | null;
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
  durationMs: number | null;
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
  };
}

function avg(arr: number[]): number | null {
  if (arr.length === 0) return null;
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}

function computeStats(values: (number | null)[]): PowerStats {
  const valid = values.filter((v): v is number => v !== null);
  if (valid.length === 0) {
    return { avg: null, max: null, min: null, samples: 0 };
  }
  const sum = valid.reduce((a, b) => a + b, 0);
  return {
    avg: Math.round((sum / valid.length) * 100) / 100,
    max: Math.round(Math.max(...valid) * 100) / 100,
    min: Math.round(Math.min(...valid) * 100) / 100,
    samples: valid.length,
  };
}

export function parsePowermetrics(rawText: string): PowerSummary {
  // Split into sample blocks by the "Sampled system activity" delimiter
  const blocks = rawText.split(/\*{3,}\s*Sampled system activity/i);

  const samples: PowerSample[] = [];
  for (let i = 1; i < blocks.length; i++) {
    samples.push(parseSample(blocks[i]));
  }

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

  // Sum all elapsed intervals to get total duration
  // Format: (1013.05ms elapsed) — value can be decimal
  let durationMs: number | null = null;
  const elapsedMatches = rawText.matchAll(
    /\((\d+(?:\.\d+)?)\s*ms elapsed\)/gi
  );
  const allElapsed = Array.from(elapsedMatches);
  if (allElapsed.length > 0) {
    durationMs = Math.round(
      allElapsed.reduce((sum, m) => sum + parseFloat(m[1]), 0)
    );
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
    totalSamples: samples.length,
    durationMs,
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
