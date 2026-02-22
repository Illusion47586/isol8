/**
 * Benchmark: CLI execution performance via globally installed isol8
 * Measures: spawn → execute → collect output time
 * Uses warm pool: first run is cold, subsequent runs use warm containers
 *
 * Usage: ISOL8_TEST_VERSION=0.9.0 bun run bench:cli
 */
import { exec } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const RUNTIMES = ["python", "node", "bun", "deno", "bash"] as const;
const RUNS = 5;
const WARMUP_RUNS = 1;

const CODE: Record<string, string> = {
  python: 'print("hello")',
  node: 'console.log("hello")',
  bun: 'console.log("hello")',
  deno: 'console.log("hello")',
  bash: "echo hello",
};

function getVersion(): string {
  return process.env.ISOL8_TEST_VERSION || "latest";
}

async function runOnce(runtime: string, tmpDir: string): Promise<number> {
  const ext =
    runtime === "bash"
      ? "sh"
      : runtime === "node"
        ? "js"
        : runtime === "deno" || runtime === "bun"
          ? "ts"
          : runtime;
  const filePath = join(tmpDir, `bench.${ext}`);

  writeFileSync(filePath, CODE[runtime] as string);

  const t0 = performance.now();

  await execAsync(`isol8 run ${filePath} -r ${runtime} --no-stream`, {
    timeout: 30_000,
  });

  return performance.now() - t0;
}

async function bench(runtime: string, tmpDir: string): Promise<{ cold: number; warm: number[] }> {
  const times: number[] = [];

  // Warmup runs to populate the container pool
  for (let i = 0; i < WARMUP_RUNS; i++) {
    await runOnce(runtime, tmpDir);
  }

  // Actual benchmark runs
  for (let i = 0; i < RUNS; i++) {
    const time = await runOnce(runtime, tmpDir);
    times.push(time);
  }

  return {
    cold: times[0]!,
    warm: times.slice(1),
  };
}

async function main() {
  const version = getVersion();
  const tmpDir = mkdtempSync(join(tmpdir(), "isol8-bench-"));

  try {
    console.log(
      `\n⏱  isol8 CLI Benchmark via isol8 (version: ${version}) (${RUNS} runs each, warm pool)\n`
    );
    console.log("Runtime   | Cold     | Warm Avg  | Warm Min | Speedup");
    console.log("----------|----------|-----------|----------|--------");

    for (const runtime of RUNTIMES) {
      const { cold, warm } = await bench(runtime, tmpDir);
      const warmAvg = warm.reduce((a, b) => a + b, 0) / warm.length;
      const warmMin = Math.min(...warm);
      const speedup = cold / warmMin;

      console.log(
        `${runtime.padEnd(9)} | ${fmt(cold)} | ${fmt(warmAvg)} | ${fmt(warmMin)} | ${speedup.toFixed(1)}x`
      );
    }

    console.log("");
  } finally {
    rmSync(tmpDir, { recursive: true });
  }
}

function fmt(ms: number): string {
  return `${ms.toFixed(0)}ms`.padStart(8);
}

main().catch(console.error);
