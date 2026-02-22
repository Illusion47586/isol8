/**
 * Cross-compile the standalone isol8 server binary.
 *
 * Usage:
 *   bun run scripts/build.ts          # Current platform only
 *   bun run scripts/build.ts --all    # All 4 targets (linux/darwin x x64/arm64)
 */

import { mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

const root = dirname(import.meta.dir);
const outDir = join(root, "dist");
const entrypoint = join(root, "src/server/standalone.ts");

// Read version from package.json
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const version: string = packageJson.version;

const allTargets = [
  { target: "bun-linux-x64", name: "isol8-server-linux-x64" },
  { target: "bun-linux-arm64", name: "isol8-server-linux-arm64" },
  { target: "bun-darwin-x64", name: "isol8-server-darwin-x64" },
  { target: "bun-darwin-arm64", name: "isol8-server-darwin-arm64" },
];

const buildAll = process.argv.includes("--all");

mkdirSync(outDir, { recursive: true });

if (buildAll) {
  console.log(`📦 Cross-compiling @isol8/server v${version} for all platforms...`);

  for (const { target, name } of allTargets) {
    console.log(`\n🔨 Building ${name}...`);
    const proc = Bun.spawn(
      [
        "bun",
        "build",
        "--compile",
        "--minify",
        `--target=${target}`,
        entrypoint,
        "--outfile",
        join(outDir, name),
        "--define",
        `process.env.ISOL8_VERSION=${JSON.stringify(version)}`,
      ],
      { cwd: root, stdout: "inherit", stderr: "inherit" }
    );
    const exitCode = await proc.exited;
    if (exitCode !== 0) {
      console.error(`❌ Failed to build ${name}`);
      process.exit(1);
    }
    console.log(`✅ ${name}`);
  }

  console.log("\n✅ All server binaries built:");
  for (const { name } of allTargets) {
    console.log(`   dist/${name}`);
  }
} else {
  console.log(`🔨 Compiling @isol8/server v${version} for current platform...`);
  const proc = Bun.spawn(
    [
      "bun",
      "build",
      "--compile",
      "--minify",
      entrypoint,
      "--outfile",
      join(outDir, "isol8-server"),
      "--define",
      `process.env.ISOL8_VERSION=${JSON.stringify(version)}`,
    ],
    { cwd: root, stdout: "inherit", stderr: "inherit" }
  );
  const exitCode = await proc.exited;
  if (exitCode !== 0) {
    console.error("❌ Server binary compilation failed");
    process.exit(1);
  }
  console.log(`✅ dist/isol8-server (v${version})`);
}
