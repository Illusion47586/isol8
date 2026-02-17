/**
 * Benchmark: CLI execution performance via bunx isol8
 * Measures: spawn → execute → collect output time
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
  const version = getVersion();
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

  await execAsync(`bunx isol8@${version} run ${filePath} -r ${runtime} --no-stream`, {
    timeout: 30_000,
  });

  return performance.now() - t0;
}

async function bench(runtime: string): Promise<{ min: number; max: number; avg: number }> {
  const times: number[] = [];
  const tmpDir = mkdtempSync(join(tmpdir(), "isol8-bench-"));

  try {
    for (let i = 0; i < RUNS; i++) {
      const time = await runOnce(runtime, tmpDir);
      times.push(time);
    }
  } finally {
    rmSync(tmpDir, { recursive: true });
  }

  const sorted = [...times].sort((a, b) => a - b);
  return {
    min: sorted[0]!,
    max: sorted.at(-1)!,
    avg: times.reduce((a, b) => a + b, 0) / times.length,
  };
}

async function main() {
  const version = getVersion();
  console.log(`\n⏱  isol8 CLI Benchmark via bunx isol8@${version} (${RUNS} runs each)\n`);
  console.log("Runtime   | Min      | Max      | Avg");
  console.log("----------|----------|----------|----------");

  for (const runtime of RUNTIMES) {
    const { min, max, avg } = await bench(runtime);
    console.log(`${runtime.padEnd(9)} | ${fmt(min)} | ${fmt(max)} | ${fmt(avg)}`);
  }

  console.log("");
}

function fmt(ms: number): string {
  return `${ms.toFixed(0)}ms`.padStart(8);
}

main().catch(console.error);
