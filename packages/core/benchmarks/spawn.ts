/**
 * Benchmark: Container spawn-up performance for each runtime.
 * Measures: create → start → exec(hello world) → collect output → destroy
 *
 * Each iteration creates a fresh DockerIsol8 engine (cold start, no pool reuse).
 *
 * Usage: bunx tsx benchmarks/spawn.ts
 */
import { DockerIsol8 } from "../src/engine/docker";
import type { Runtime } from "../src/types";

const RUNTIMES: { name: Runtime; code: string }[] = [
  { name: "python", code: 'print("hello")' },
  { name: "node", code: 'console.log("hello")' },
  { name: "bun", code: 'console.log("hello")' },
  { name: "deno", code: 'console.log("hello")' },
  { name: "bash", code: "echo hello" },
];

const RUNS = 3;

async function bench(runtime: Runtime, code: string): Promise<number[]> {
  const times: number[] = [];

  for (let i = 0; i < RUNS; i++) {
    const engine = new DockerIsol8({ mode: "ephemeral", network: "none" });
    await engine.start();

    const t0 = performance.now();
    const result = await engine.execute({ runtime, code });
    const elapsed = performance.now() - t0;

    await engine.stop();

    if (result.exitCode !== 0) {
      console.error(`  ⚠ ${runtime} run ${i + 1}: exit ${result.exitCode} — ${result.stderr}`);
    }

    times.push(elapsed);
  }

  return times;
}

async function main() {
  console.log(`\n⏱  isol8 Container Spawn Benchmark (${RUNS} runs each)\n`);
  console.log("Runtime   | Min      | Median   | Max      | Avg");
  console.log("----------|----------|----------|----------|----------");

  for (const { name, code } of RUNTIMES) {
    const times = await bench(name, code);
    const sorted = [...times].sort((a, b) => a - b);
    const min = sorted[0];
    const max = sorted.at(-1);
    const median = sorted[Math.floor(sorted.length / 2)];
    const avg = times.reduce((a, b) => a + b, 0) / times.length;

    console.log(`${name.padEnd(9)} | ${fmt(min)} | ${fmt(median)} | ${fmt(max)} | ${fmt(avg)}`);
  }

  console.log("");
}

function fmt(ms: number): string {
  return `${ms.toFixed(0)}ms`.padStart(8);
}

main()
  .catch(console.error)
  .finally(() => process.exit(0));
