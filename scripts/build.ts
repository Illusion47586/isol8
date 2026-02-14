import { cpSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

const root = dirname(import.meta.dir);
const outDir = join(root, "dist");
const dockerSrc = join(root, "docker");
const dockerDst = join(outDir, "docker");

// Read version from package.json
const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
const version: string = packageJson.version;

// Clean previous build
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

console.log("📦 Building isol8...");

// 1. Bundle CLI for Node.js target
const cliBuild = await Bun.build({
  entrypoints: [join(root, "src/cli.ts")],
  outdir: outDir,
  target: "node",
  format: "esm",
  minify: false,
  sourcemap: "external",
});

if (!cliBuild.success) {
  console.error("❌ CLI build failed:");
  for (const log of cliBuild.logs) {
    console.error(log);
  }
  process.exit(1);
}

// 2. Bundle library entry point for Node.js
const libBuild = await Bun.build({
  entrypoints: [join(root, "src/index.ts")],
  outdir: outDir,
  target: "node",
  format: "esm",
  minify: false,
  sourcemap: "external",
  external: ["dockerode", "hono", "commander", "ora"],
});

if (!libBuild.success) {
  console.error("❌ Library build failed:");
  for (const log of libBuild.logs) {
    console.error(log);
  }
  process.exit(1);
}

// 3. Generate type declarations
console.log("📝 Generating type declarations...");
const tsc = Bun.spawn(["bunx", "tsc", "--project", join(root, "tsconfig.build.json")], {
  cwd: root,
  stdout: "inherit",
  stderr: "inherit",
});
const tscExit = await tsc.exited;
if (tscExit !== 0) {
  console.error("❌ Type declaration generation failed");
  process.exit(1);
}

// 4. Copy Docker assets
mkdirSync(dockerDst, { recursive: true });
cpSync(dockerSrc, dockerDst, { recursive: true });

// 5. Compile standalone server binary
console.log("🔨 Compiling standalone server binary...");

const serverCompile = Bun.spawn(
  [
    "bun",
    "build",
    "--compile",
    "--minify",
    join(root, "src/server/standalone.ts"),
    "--outfile",
    join(outDir, "isol8-server"),
    "--define",
    `process.env.ISOL8_VERSION=${JSON.stringify(version)}`,
  ],
  {
    cwd: root,
    stdout: "inherit",
    stderr: "inherit",
  }
);

const serverCompileExit = await serverCompile.exited;
if (serverCompileExit !== 0) {
  console.error("❌ Server binary compilation failed");
  process.exit(1);
}

console.log("✅ Build complete → dist/");
console.log("   CLI:     dist/cli.js");
console.log("   Library: dist/index.js");
console.log("   Types:   dist/index.d.ts");
console.log("   Docker:  dist/docker/");
console.log(`   Server:  dist/isol8-server (v${version})`);
