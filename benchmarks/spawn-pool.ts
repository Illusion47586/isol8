/**
 * Benchmark: Container spawn-up with warm pool.
 * Uses a single DockerIsol8 instance across runs so the warm pool is effective.
 *
 * Usage: bunx tsx benchmarks/spawn-pool.ts
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

const RUNS = 5; // More runs to show warm pool effect

async function main() {
  console.log(`\n⏱  Warm Pool Benchmark (${RUNS} runs each, same engine instance)\n`);

  const engine = new DockerIsol8({ mode: "ephemeral", network: "none" });
  await engine.start();

  for (const { name, code } of RUNTIMES) {
    const times: number[] = [];

    for (let i = 0; i < RUNS; i++) {
      const t0 = performance.now();
      const result = await engine.execute({ runtime: name, code });
      times.push(performance.now() - t0);

      if (result.exitCode !== 0) {
        console.error(`  ⚠ ${name} run ${i + 1}: exit ${result.exitCode} — ${result.stderr}`);
      }
    }

    const cold = times[0]!;
    const warm = times.slice(1);
    const avgWarm = warm.reduce((a, b) => a + b, 0) / warm.length;
    const minWarm = Math.min(...warm);

    console.log(
      `${name.padEnd(8)} | cold: ${cold.toFixed(0).padStart(4)}ms | ` +
        `warm avg: ${avgWarm.toFixed(0).padStart(4)}ms | ` +
        `warm min: ${minWarm.toFixed(0).padStart(4)}ms | ` +
        `speedup: ${(cold / minWarm).toFixed(1)}x`
    );
  }

  await engine.stop();
  console.log("");
}

main().catch(console.error);
