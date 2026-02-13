import { cpSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const outDir = join(dirname(import.meta.dir), "dist");
const dockerSrc = join(dirname(import.meta.dir), "docker");
const dockerDst = join(outDir, "docker");

console.log("📦 Building isol8 CLI...");

// 1. Bundle CLI for Node.js target
const result = await Bun.build({
  entrypoints: [join(dirname(import.meta.dir), "src/cli.ts")],
  outdir: outDir,
  target: "node",
  format: "esm",
  minify: false,
  sourcemap: "external",
});

if (!result.success) {
  console.error("❌ Build failed:");
  for (const log of result.logs) {
    console.error(log);
  }
  process.exit(1);
}

// 2. Copy Docker assets
mkdirSync(dockerDst, { recursive: true });
cpSync(dockerSrc, dockerDst, { recursive: true });

console.log("✅ Build complete → dist/");
console.log("   CLI: dist/cli.js");
console.log("   Docker: dist/docker/");
