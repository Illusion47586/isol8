import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const root = dirname(import.meta.dir);
const outDir = join(root, "dist");

// Read version from package.json
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const version: string = packageJson.version;

console.log("📦 Building @isol8/cli...");

// Clean previous build
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

// Bundle CLI for Node.js target
const cliBuild = await Bun.build({
  entrypoints: [join(root, "src/cli.ts")],
  outdir: outDir,
  target: "node",
  format: "esm",
  minify: false,
  sourcemap: "external",
  external: ["@isol8/server"],
});

if (!cliBuild.success) {
  console.error("❌ CLI build failed:");
  for (const log of cliBuild.logs) {
    console.error(log);
  }
  process.exit(1);
}

// Copy docker directory from @isol8/core to dist
const coreDockerDir = join(root, "..", "..", "packages", "core", "docker");
const distDockerDir = join(outDir, "docker");
if (existsSync(coreDockerDir)) {
  cpSync(coreDockerDir, distDockerDir, { recursive: true });
  console.log("   Docker:  dist/docker/");
}

console.log(`✅ Build complete → dist/cli.js (v${version})`);
