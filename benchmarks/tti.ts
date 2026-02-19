/**
 * ComputeSDK-style TTI benchmark for isol8.
 *
 * TTI (time to interactive) = create sandbox + first command execution.
 * Cleanup (engine.stop) runs after timing and is not included in TTI.
 *
 * Usage:
 *   bunx tsx benchmarks/tti.ts
 *   bunx tsx benchmarks/tti.ts --iterations 5
 *   bunx tsx benchmarks/tti.ts --runtime python --iterations 10
 *   bunx tsx benchmarks/tti.ts --warm-pool --iterations 5
 */

import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { DockerIsol8 } from "../src/engine/docker";
import type { Runtime } from "../src/types";

interface Stats {
  min: number;
  max: number;
  median: number;
  avg: number;
}

interface TimingResult {
  ttiMs: number;
  error?: string;
}

interface BenchmarkResult {
  provider: Runtime;
  iterations: TimingResult[];
  summary: {
    ttiMs: Stats;
  };
  warmPool?: {
    coldMs: number;
    warmMinMs: number;
    warmAvgMs: number;
    speedup: number;
  };
}

const RUNTIMES: { name: Runtime; code: string }[] = [
  { name: "python", code: 'print("benchmark")' },
  { name: "node", code: 'console.log("benchmark")' },
  { name: "bun", code: 'console.log("benchmark")' },
  { name: "deno", code: 'console.log("benchmark")' },
  { name: "bash", code: 'echo "benchmark"' },
];

const args = process.argv.slice(2);
const runtimeFilter = getArgValue(args, "--runtime");
const iterations = Number.parseInt(getArgValue(args, "--iterations") ?? "3", 10);
const timeout = Number.parseInt(getArgValue(args, "--timeout") ?? "120000", 10);
const warmPool = args.includes("--warm-pool");

function getArgValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag);
  return index !== -1 && index + 1 < argv.length ? argv[index + 1] : undefined;
}

function computeStats(values: number[]): Stats {
  if (values.length === 0) {
    return { min: 0, max: 0, median: 0, avg: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : (sorted[mid] ?? 0);

  return {
    min: sorted[0] ?? 0,
    max: sorted.at(-1) ?? 0,
    median,
    avg: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  const timeoutPromise = new Promise<T>((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timer) {
      clearTimeout(timer);
    }
  });
}

async function runIteration(
  runtime: Runtime,
  code: string,
  timeoutMs: number
): Promise<TimingResult> {
  const engine = new DockerIsol8({ mode: "ephemeral", network: "none" });

  try {
    const start = performance.now();

    const execution = await withTimeout(
      engine.execute({ runtime, code, timeoutMs: 30_000 }),
      timeoutMs,
      "Execution timed out"
    );

    if (execution.exitCode !== 0) {
      throw new Error(`exit ${execution.exitCode}: ${execution.stderr}`);
    }

    const ttiMs = performance.now() - start;
    return { ttiMs };
  } finally {
    try {
      await withTimeout(engine.stop(), 15_000, "Engine cleanup timed out");
    } catch {
      // Ignore cleanup failures to match upstream benchmark behavior.
    }
  }
}

async function runWithEngine(
  engine: DockerIsol8,
  runtime: Runtime,
  code: string,
  timeoutMs: number
): Promise<TimingResult> {
  const start = performance.now();
  const execution = await withTimeout(
    engine.execute({ runtime, code, timeoutMs: 30_000 }),
    timeoutMs,
    "Execution timed out"
  );

  if (execution.exitCode !== 0) {
    throw new Error(`exit ${execution.exitCode}: ${execution.stderr}`);
  }

  return { ttiMs: performance.now() - start };
}

async function runBenchmark(runtime: Runtime, code: string): Promise<BenchmarkResult> {
  const results: TimingResult[] = [];

  console.log(
    `\n--- Benchmarking: ${runtime} (${iterations} iterations, ${warmPool ? "warm-pool" : "cold"}) ---`
  );

  if (warmPool) {
    const engine = new DockerIsol8({ mode: "ephemeral", network: "none" });
    await engine.start();

    try {
      for (let i = 0; i < iterations; i++) {
        console.log(`  Iteration ${i + 1}/${iterations}...`);

        try {
          const result = await runWithEngine(engine, runtime, code, timeout);
          results.push(result);
          console.log(`    TTI: ${(result.ttiMs / 1000).toFixed(2)}s`);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          results.push({ ttiMs: 0, error: message });
          console.log(`    FAILED: ${message}`);
        }
      }
    } finally {
      try {
        await withTimeout(engine.stop(), 15_000, "Engine cleanup timed out");
      } catch {
        // Ignore cleanup failures to match upstream benchmark behavior.
      }
    }
  } else {
    for (let i = 0; i < iterations; i++) {
      console.log(`  Iteration ${i + 1}/${iterations}...`);

      try {
        const result = await runIteration(runtime, code, timeout);
        results.push(result);
        console.log(`    TTI: ${(result.ttiMs / 1000).toFixed(2)}s`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        results.push({ ttiMs: 0, error: message });
        console.log(`    FAILED: ${message}`);
      }
    }
  }

  const successful = results.filter((item) => !item.error).map((item) => item.ttiMs);
  const warmPoolSummary =
    warmPool && successful.length >= 2
      ? {
          coldMs: successful[0] ?? 0,
          warmMinMs: Math.min(...successful.slice(1)),
          warmAvgMs:
            successful.slice(1).reduce((sum, value) => sum + value, 0) / (successful.length - 1),
          speedup: (successful[0] ?? 0) / Math.min(...successful.slice(1)),
        }
      : undefined;

  return {
    provider: runtime,
    iterations: results,
    summary: {
      ttiMs: computeStats(successful),
    },
    warmPool: warmPoolSummary,
  };
}

function pad(text: string, width: number): string {
  return text.padEnd(width);
}

function formatSeconds(ms: number): string {
  return (ms / 1000).toFixed(2);
}

function printResultsTable(results: BenchmarkResult[]): void {
  const nameWidth = 12;
  const colWidth = 14;

  const header = [
    pad("Provider", nameWidth),
    pad("TTI (s)", colWidth),
    pad("Min (s)", colWidth),
    pad("Max (s)", colWidth),
    pad("Status", 10),
  ].join(" | ");

  const separator = [
    "-".repeat(nameWidth),
    "-".repeat(colWidth),
    "-".repeat(colWidth),
    "-".repeat(colWidth),
    "-".repeat(10),
  ].join("-+-");

  console.log(`\n${"=".repeat(separator.length)}`);
  console.log("  ISOL8 TTI BENCHMARK RESULTS");
  console.log("=".repeat(separator.length));
  console.log(header);
  console.log(separator);

  const sorted = [...results].sort((a, b) => a.summary.ttiMs.median - b.summary.ttiMs.median);

  for (const result of sorted) {
    const successful = result.iterations.filter((item) => !item.error).length;
    const total = result.iterations.length;

    console.log(
      [
        pad(result.provider, nameWidth),
        pad(formatSeconds(result.summary.ttiMs.median), colWidth),
        pad(formatSeconds(result.summary.ttiMs.min), colWidth),
        pad(formatSeconds(result.summary.ttiMs.max), colWidth),
        pad(`${successful}/${total} OK`, 10),
      ].join(" | ")
    );
  }

  console.log("=".repeat(separator.length));
  console.log("  TTI = Time to Interactive (median). Create + first code execution.\n");

  const warmPoolResults = results.filter((result) => result.warmPool);
  if (warmPoolResults.length > 0) {
    console.log("Warm Pool Summary (first run cold, remaining warm):");
    for (const result of warmPoolResults) {
      const warm = result.warmPool!;
      console.log(
        `  ${result.provider}: cold ${(warm.coldMs / 1000).toFixed(2)}s | ` +
          `warm min ${(warm.warmMinMs / 1000).toFixed(2)}s | ` +
          `warm avg ${(warm.warmAvgMs / 1000).toFixed(2)}s | ` +
          `speedup ${warm.speedup.toFixed(2)}x`
      );
    }
    console.log("");
  }
}

function writeResultsJson(results: BenchmarkResult[]): string {
  const outputDir = path.resolve("benchmarks/results");
  mkdirSync(outputDir, { recursive: true });

  const timestamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
  const outputPath = path.join(outputDir, `isol8-tti-${timestamp}.json`);

  writeFileSync(
    outputPath,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        results,
      },
      null,
      2
    )
  );

  return outputPath;
}

async function main() {
  if (Number.isNaN(iterations) || iterations <= 0) {
    throw new Error("--iterations must be a positive integer");
  }

  if (Number.isNaN(timeout) || timeout <= 0) {
    throw new Error("--timeout must be a positive integer in milliseconds");
  }

  console.log("isol8 ComputeSDK-style TTI Benchmark");
  console.log(`Iterations per runtime: ${iterations}`);
  console.log(
    `Mode: ${warmPool ? "warm-pool (reused engine)" : "cold (fresh engine per iteration)"}`
  );
  console.log(`Date: ${new Date().toISOString()}\n`);

  if (warmPool && iterations < 2) {
    throw new Error("--warm-pool requires --iterations of at least 2");
  }

  const selected = runtimeFilter
    ? RUNTIMES.filter((runtime) => runtime.name === runtimeFilter)
    : RUNTIMES;

  if (selected.length === 0) {
    throw new Error(`Unknown runtime: ${runtimeFilter}`);
  }

  const results: BenchmarkResult[] = [];

  for (const runtime of selected) {
    const result = await runBenchmark(runtime.name, runtime.code);
    results.push(result);
  }

  printResultsTable(results);
  const outputPath = writeResultsJson(results);
  console.log(`Results written to ${outputPath}`);
}

main()
  .catch((error) => {
    console.error("Benchmark failed:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    process.exit(process.exitCode ?? 0);
  });
