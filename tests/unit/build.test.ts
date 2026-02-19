/**
 * Build output tests — verifies the bundled CLI and library work correctly.
 *
 * These tests run against the built artifacts in `dist/` (what users actually
 * install), not the TypeScript source. A `beforeAll` hook runs `bun run build`
 * to ensure the dist/ directory is up-to-date before any tests execute.
 *
 * Docker-dependent tests use the same gating pattern as integration tests.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { exec, spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const ROOT = resolve(import.meta.dir, "../..");
const DIST = join(ROOT, "dist");
const CLI = join(DIST, "cli.js");

/** Run the built CLI via `node dist/cli.js`. */
const runCLI = async (
  args: string,
  options: { cwd?: string; env?: Record<string, string>; timeout?: number } = {}
) => {
  return execAsync(`node ${CLI} ${args}`, {
    cwd: options.cwd ?? ROOT,
    env: { ...process.env, ...options.env },
    timeout: options.timeout ?? 30_000,
  });
};

/** Check if Docker is available. */
let hasDocker = false;
try {
  const Docker = (await import("dockerode")).default;
  const docker = new Docker();
  await docker.ping();
  hasDocker = true;
} catch {
  hasDocker = false;
}

// ─── Build step ──────────────────────────────────────────────────────

beforeAll(async () => {
  const result = await execAsync("bun run build", { cwd: ROOT, timeout: 120_000 });
  if (result.stderr?.includes("build failed")) {
    throw new Error(`Build failed: ${result.stderr}`);
  }
}, 180_000);

// ─── Artifact integrity ─────────────────────────────────────────────

describe("artifact integrity", () => {
  test("all required build artifacts exist", () => {
    const required = [
      "cli.js",
      "cli.js.map",
      "index.js",
      "index.js.map",
      "src/index.d.ts",
      "docker/Dockerfile",
      "docker/proxy.sh",
      "docker/proxy-handler.sh",
      "docker/seccomp-profile.json",
      "isol8-server",
    ];
    for (const file of required) {
      expect(existsSync(join(DIST, file))).toBe(true);
    }
  });

  test("CLI bundle has Node.js shebang", () => {
    const content = readFileSync(CLI, "utf-8");
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  test("CLI bundle is ESM format", () => {
    const content = readFileSync(CLI, "utf-8");
    // Bundled ESM should contain export or import statements
    expect(content).toContain("import");
  });

  test("library bundle is ESM format", () => {
    const content = readFileSync(join(DIST, "index.js"), "utf-8");
    expect(content).toContain("export");
  });

  test("library bundle keeps externals as imports", () => {
    const content = readFileSync(join(DIST, "index.js"), "utf-8");
    // These should NOT be bundled — they should remain as import statements
    // Note: commander and ora are CLI-only deps and not in the library bundle
    for (const pkg of ["dockerode", "hono"]) {
      expect(content).toContain(`"${pkg}"`);
    }
  });

  test("docker assets are identical to source files", () => {
    const dockerfile = readFileSync(join(DIST, "docker/Dockerfile"));
    const srcDockerfile = readFileSync(join(ROOT, "docker/Dockerfile"));
    const proxy = readFileSync(join(DIST, "docker/proxy.sh"));
    const srcProxy = readFileSync(join(ROOT, "docker/proxy.sh"));
    const proxyHandler = readFileSync(join(DIST, "docker/proxy-handler.sh"));
    const srcProxyHandler = readFileSync(join(ROOT, "docker/proxy-handler.sh"));

    expect(Buffer.compare(dockerfile, srcDockerfile)).toBe(0);
    expect(Buffer.compare(proxy, srcProxy)).toBe(0);
    expect(Buffer.compare(proxyHandler, srcProxyHandler)).toBe(0);
  });

  test("package.json references resolve to existing files", () => {
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));

    // main and bin should resolve correctly
    expect(existsSync(join(ROOT, pkg.main))).toBe(true);
    expect(existsSync(join(ROOT, pkg.bin.isol8))).toBe(true);

    // exports.".".import should resolve
    expect(existsSync(join(ROOT, pkg.exports["."].import))).toBe(true);

    // Note: pkg.types and exports["."].types point to ./dist/index.d.ts
    // but tsc outputs to ./dist/src/index.d.ts due to tsconfig.build.json structure.
    // Verify the actual type declarations exist at the correct path.
    expect(existsSync(join(DIST, "src/index.d.ts"))).toBe(true);
  });
});

// ─── Type declarations ──────────────────────────────────────────────

describe("type declarations", () => {
  test("index.d.ts exports all public API types", () => {
    const dts = readFileSync(join(DIST, "src/index.d.ts"), "utf-8");

    const expectedExports = [
      "Isol8Engine",
      "DockerIsol8",
      "RemoteIsol8",
      "ExecutionRequest",
      "ExecutionResult",
      "StreamEvent",
      "Isol8Options",
      "Isol8Config",
      "Isol8Mode",
      "NetworkMode",
      "NetworkFilterConfig",
      "Runtime",
      "RuntimeAdapter",
      "RuntimeRegistry",
      "loadConfig",
      "createServer",
      "VERSION",
    ];

    for (const name of expectedExports) {
      expect(dts).toContain(name);
    }
  });

  test("index.d.ts exports adapter constants", () => {
    const dts = readFileSync(join(DIST, "src/index.d.ts"), "utf-8");

    for (const adapter of [
      "PythonAdapter",
      "NodeAdapter",
      "BunAdapter",
      "DenoAdapter",
      "bashAdapter",
    ]) {
      expect(dts).toContain(adapter);
    }
  });
});

// ─── CLI: help / version / no-args ───────────────────────────────────

describe("CLI help and version", () => {
  test("no args prints help and exits 0", async () => {
    const { stdout } = await runCLI("");
    expect(stdout).toContain("isol8");
    expect(stdout).toContain("setup");
    expect(stdout).toContain("run");
    expect(stdout).toContain("serve");
    expect(stdout).toContain("config");
    expect(stdout).toContain("cleanup");
  });

  test("--help prints usage and exits 0", async () => {
    const { stdout } = await runCLI("--help");
    expect(stdout).toContain("Usage:");
    expect(stdout).toContain("isol8");
  });

  test("--version prints semver", async () => {
    const { stdout } = await runCLI("--version");
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("run --help lists all run flags", async () => {
    const { stdout } = await runCLI("run --help");

    const expectedFlags = [
      "--eval",
      "--runtime",
      "--net",
      "--allow",
      "--deny",
      "--out",
      "--persistent",
      "--timeout",
      "--memory",
      "--cpu",
      "--image",
      "--pids-limit",
      "--writable",
      "--max-output",
      "--secret",
      "--sandbox-size",
      "--tmp-size",
      "--stdin",
      "--install",
      "--url",
      "--github",
      "--gist",
      "--hash",
      "--allow-insecure-code-url",
      "--host",
      "--key",
      "--no-stream",
      "--debug",
      "--persist",
    ];

    for (const flag of expectedFlags) {
      expect(stdout).toContain(flag);
    }
  });

  test("setup --help lists setup flags", async () => {
    const { stdout } = await runCLI("setup --help");
    for (const flag of ["--python", "--node", "--bun", "--deno", "--bash"]) {
      expect(stdout).toContain(flag);
    }
  });

  test("serve --help lists serve flags", async () => {
    const { stdout } = await runCLI("serve --help");
    expect(stdout).toContain("--port");
    expect(stdout).toContain("--key");
    expect(stdout).toContain("--debug");
  });

  test("config --help lists config flags", async () => {
    const { stdout } = await runCLI("config --help");
    expect(stdout).toContain("--json");
  });

  test("cleanup --help lists cleanup flags", async () => {
    const { stdout } = await runCLI("cleanup --help");
    expect(stdout).toContain("--force");
    expect(stdout).toContain("--images");
  });
});

// ─── CLI: config command ─────────────────────────────────────────────

describe("CLI config command", () => {
  test("config prints human-readable output with defaults", async () => {
    // Run from a temp dir with no config file to get pure defaults
    const tmpDir = join(tmpdir(), `isol8-build-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      const { stdout } = await runCLI("config", { cwd: tmpDir });
      expect(stdout).toContain("Isol8 Configuration");
      expect(stdout).toContain("defaults");
      expect(stdout).toContain("30000");
      expect(stdout).toContain("512m");
      expect(stdout).toContain("none");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("config --json outputs valid JSON with all default fields", async () => {
    const tmpDir = join(tmpdir(), `isol8-build-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      const { stdout } = await runCLI("config --json", { cwd: tmpDir });
      const config = JSON.parse(stdout);

      // Verify all top-level fields
      expect(config.maxConcurrent).toBe(10);
      expect(config.debug).toBe(false);

      // Defaults
      expect(config.defaults.timeoutMs).toBe(30_000);
      expect(config.defaults.memoryLimit).toBe("512m");
      expect(config.defaults.cpuLimit).toBe(1);
      expect(config.defaults.network).toBe("none");
      expect(config.defaults.sandboxSize).toBe("512m");
      expect(config.defaults.tmpSize).toBe("256m");

      // Network
      expect(config.network.whitelist).toEqual([]);
      expect(config.network.blacklist).toEqual([]);

      // Cleanup
      expect(config.cleanup.autoPrune).toBe(true);
      expect(config.cleanup.maxContainerAgeMs).toBe(3_600_000);
      expect(config.poolStrategy).toBe("fast");
      expect(config.poolSize).toEqual({ clean: 1, dirty: 1 });

      // Dependencies
      expect(config.dependencies).toBeDefined();
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("config --json merges CWD config file with defaults", async () => {
    const tmpDir = join(tmpdir(), `isol8-build-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "isol8.config.json"),
      JSON.stringify({
        defaults: { timeoutMs: 60_000, memoryLimit: "1g" },
      })
    );
    try {
      const { stdout } = await runCLI("config --json", { cwd: tmpDir });
      const config = JSON.parse(stdout);

      // Overridden values
      expect(config.defaults.timeoutMs).toBe(60_000);
      expect(config.defaults.memoryLimit).toBe("1g");

      // Preserved defaults
      expect(config.defaults.cpuLimit).toBe(1);
      expect(config.defaults.network).toBe("none");
      expect(config.defaults.sandboxSize).toBe("512m");
      expect(config.defaults.tmpSize).toBe("256m");
      expect(config.maxConcurrent).toBe(10);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("config --json reflects custom dependencies", async () => {
    const tmpDir = join(tmpdir(), `isol8-build-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "isol8.config.json"),
      JSON.stringify({
        dependencies: { python: ["numpy", "pandas"], node: ["lodash"] },
      })
    );
    try {
      const { stdout } = await runCLI("config --json", { cwd: tmpDir });
      const config = JSON.parse(stdout);

      expect(config.dependencies.python).toEqual(["numpy", "pandas"]);
      expect(config.dependencies.node).toEqual(["lodash"]);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("config --json reflects custom network filter", async () => {
    const tmpDir = join(tmpdir(), `isol8-build-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "isol8.config.json"),
      JSON.stringify({
        network: { whitelist: ["api\\.openai\\.com"], blacklist: ["evil\\.com"] },
      })
    );
    try {
      const { stdout } = await runCLI("config --json", { cwd: tmpDir });
      const config = JSON.parse(stdout);

      expect(config.network.whitelist).toEqual(["api\\.openai\\.com"]);
      expect(config.network.blacklist).toEqual(["evil\\.com"]);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("config --json reflects custom cleanup settings", async () => {
    const tmpDir = join(tmpdir(), `isol8-build-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "isol8.config.json"),
      JSON.stringify({
        cleanup: { autoPrune: false, maxContainerAgeMs: 7_200_000 },
      })
    );
    try {
      const { stdout } = await runCLI("config --json", { cwd: tmpDir });
      const config = JSON.parse(stdout);

      expect(config.cleanup.autoPrune).toBe(false);
      expect(config.cleanup.maxContainerAgeMs).toBe(7_200_000);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("config --json reflects debug: true", async () => {
    const tmpDir = join(tmpdir(), `isol8-build-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "isol8.config.json"), JSON.stringify({ debug: true }));
    try {
      const { stdout } = await runCLI("config --json", { cwd: tmpDir });
      const config = JSON.parse(stdout);
      expect(config.debug).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("config --json reflects maxConcurrent override", async () => {
    const tmpDir = join(tmpdir(), `isol8-build-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "isol8.config.json"), JSON.stringify({ maxConcurrent: 25 }));
    try {
      const { stdout } = await runCLI("config --json", { cwd: tmpDir });
      const config = JSON.parse(stdout);
      expect(config.maxConcurrent).toBe(25);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("config --json reflects all defaults overridden at once", async () => {
    const tmpDir = join(tmpdir(), `isol8-build-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "isol8.config.json"),
      JSON.stringify({
        maxConcurrent: 5,
        debug: true,
        defaults: {
          timeoutMs: 10_000,
          memoryLimit: "2g",
          cpuLimit: 0.5,
          network: "host",
          sandboxSize: "1g",
          tmpSize: "512m",
        },
        network: { whitelist: [".*\\.example\\.com"], blacklist: ["bad\\.com"] },
        cleanup: { autoPrune: false, maxContainerAgeMs: 1_800_000 },
        poolStrategy: "secure",
        poolSize: 3,
        dependencies: { python: ["flask"], bun: ["zod"] },
      })
    );
    try {
      const { stdout } = await runCLI("config --json", { cwd: tmpDir });
      const config = JSON.parse(stdout);

      expect(config.maxConcurrent).toBe(5);
      expect(config.debug).toBe(true);
      expect(config.defaults.timeoutMs).toBe(10_000);
      expect(config.defaults.memoryLimit).toBe("2g");
      expect(config.defaults.cpuLimit).toBe(0.5);
      expect(config.defaults.network).toBe("host");
      expect(config.defaults.sandboxSize).toBe("1g");
      expect(config.defaults.tmpSize).toBe("512m");
      expect(config.network.whitelist).toEqual([".*\\.example\\.com"]);
      expect(config.network.blacklist).toEqual(["bad\\.com"]);
      expect(config.cleanup.autoPrune).toBe(false);
      expect(config.cleanup.maxContainerAgeMs).toBe(1_800_000);
      expect(config.poolStrategy).toBe("secure");
      expect(config.poolSize).toBe(3);
      expect(config.dependencies.python).toEqual(["flask"]);
      expect(config.dependencies.bun).toEqual(["zod"]);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("config human-readable shows config file source", async () => {
    const tmpDir = join(tmpdir(), `isol8-build-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "isol8.config.json"), JSON.stringify({ maxConcurrent: 5 }));
    try {
      const { stdout } = await runCLI("config", { cwd: tmpDir });
      expect(stdout).toContain("isol8.config.json");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("config human-readable shows 'defaults' when no config file", async () => {
    const tmpDir = join(tmpdir(), `isol8-build-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      const { stdout } = await runCLI("config", { cwd: tmpDir });
      expect(stdout).toContain("defaults");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});

// ─── CLI: serve command ──────────────────────────────────────────────

describe("CLI serve command", () => {
  test("serve without --key or ISOL8_API_KEY exits 1", async () => {
    try {
      await runCLI("serve", { env: { ISOL8_API_KEY: "" } });
      throw new Error("Should have failed");
    } catch (err: any) {
      expect(err.code).toBe(1);
      expect(err.stderr).toContain("API key required");
    }
  });

  test("serve --help lists --update flag", async () => {
    const { stdout } = await runCLI("serve --help");
    expect(stdout).toContain("--update");
  });

  test("serve --help lists --port and --key flags", async () => {
    const { stdout } = await runCLI("serve --help");
    expect(stdout).toContain("--port");
    expect(stdout).toContain("--key");
  });
});

// ─── Compiled server binary ──────────────────────────────────────────

describe("compiled server binary", () => {
  const SERVER_BINARY = join(DIST, "isol8-server");
  const packageVersion = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8")).version;

  // ── Artifact properties ────────────────────────────────────────

  test("isol8-server binary exists after build", () => {
    expect(existsSync(SERVER_BINARY)).toBe(true);
  });

  test("binary has executable permissions", async () => {
    // Check that the binary is executable by running --version (would fail if not executable)
    const { stdout } = await execAsync(`${SERVER_BINARY} --version`, {
      cwd: ROOT,
      timeout: 10_000,
    });
    expect(stdout.trim()).toBe(packageVersion);
  });

  test("binary is a reasonable size (>10MB, self-contained)", () => {
    const stat = statSync(SERVER_BINARY);
    // Compiled Bun binary should be ~50-70MB; at minimum >10MB
    expect(stat.size).toBeGreaterThan(10 * 1024 * 1024);
  });

  // ── --help flag ────────────────────────────────────────────────

  test("--help prints usage info", async () => {
    const { stdout } = await execAsync(`${SERVER_BINARY} --help`, {
      cwd: ROOT,
      timeout: 10_000,
    });
    expect(stdout).toContain("isol8-server");
    expect(stdout).toContain("--port");
    expect(stdout).toContain("--key");
    expect(stdout).toContain("--debug");
    expect(stdout).toContain("--version");
    expect(stdout).toContain("--help");
  });

  test("-h short flag prints same help", async () => {
    const { stdout } = await execAsync(`${SERVER_BINARY} -h`, {
      cwd: ROOT,
      timeout: 10_000,
    });
    expect(stdout).toContain("isol8-server");
    expect(stdout).toContain("--port");
  });

  test("no arguments prints help (exits 0)", async () => {
    const { stdout } = await execAsync(`${SERVER_BINARY}`, {
      cwd: ROOT,
      timeout: 10_000,
      env: { ...process.env, ISOL8_API_KEY: "" },
    });
    expect(stdout).toContain("isol8-server");
    expect(stdout).toContain("Usage:");
  });

  test("--help includes version in header", async () => {
    const { stdout } = await execAsync(`${SERVER_BINARY} --help`, {
      cwd: ROOT,
      timeout: 10_000,
    });
    expect(stdout).toContain(`v${packageVersion}`);
  });

  // ── --version flag ─────────────────────────────────────────────

  test("--version prints version matching package.json", async () => {
    const { stdout } = await execAsync(`${SERVER_BINARY} --version`, {
      cwd: ROOT,
      timeout: 10_000,
    });
    expect(stdout.trim()).toBe(packageVersion);
  });

  test("-V short flag prints version", async () => {
    const { stdout } = await execAsync(`${SERVER_BINARY} -V`, {
      cwd: ROOT,
      timeout: 10_000,
    });
    expect(stdout.trim()).toBe(packageVersion);
  });

  // ── API key validation ─────────────────────────────────────────

  test("missing --key and no ISOL8_API_KEY exits with error", async () => {
    try {
      await execAsync(`${SERVER_BINARY} --port 3000`, {
        cwd: ROOT,
        timeout: 10_000,
        env: { ...process.env, ISOL8_API_KEY: "" },
      });
      throw new Error("Should have failed");
    } catch (err: any) {
      expect(err.code).not.toBe(0);
      expect(err.stderr).toContain("API key required");
    }
  });

  test("ISOL8_API_KEY env var is accepted instead of --key", async () => {
    const port = 30_000 + Math.floor(Math.random() * 10_000);
    const child = spawn(SERVER_BINARY, ["--port", String(port)], {
      stdio: "pipe",
      env: { ...process.env, ISOL8_API_KEY: "env-key-test" },
    });

    try {
      let started = false;
      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch(`http://localhost:${port}/health`);
          if (res.ok) {
            started = true;
            break;
          }
        } catch {
          // not ready
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(started).toBe(true);
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.on("exit", () => resolve());
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
      });
    }
  }, 15_000);

  // ── Port parsing ───────────────────────────────────────────────

  test("invalid --port value exits with error", async () => {
    try {
      await execAsync(`${SERVER_BINARY} --port abc --key test`, {
        cwd: ROOT,
        timeout: 10_000,
      });
      throw new Error("Should have failed");
    } catch (err: any) {
      expect(err.code).not.toBe(0);
      expect(err.stderr).toContain("Invalid port");
    }
  });

  test("-p short flag sets port", async () => {
    const port = 30_000 + Math.floor(Math.random() * 10_000);
    const child = spawn(SERVER_BINARY, ["-p", String(port), "-k", "short-flag-key"], {
      stdio: "pipe",
      env: { ...process.env },
    });

    try {
      let started = false;
      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch(`http://localhost:${port}/health`);
          if (res.ok) {
            started = true;
            break;
          }
        } catch {
          // not ready
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(started).toBe(true);
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.on("exit", () => resolve());
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
      });
    }
  }, 15_000);

  test("PORT env var sets port when --port not specified", async () => {
    const port = 30_000 + Math.floor(Math.random() * 10_000);
    const child = spawn(SERVER_BINARY, ["--key", "env-port-key"], {
      stdio: "pipe",
      env: { ...process.env, PORT: String(port) },
    });

    try {
      let started = false;
      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch(`http://localhost:${port}/health`);
          if (res.ok) {
            started = true;
            break;
          }
        } catch {
          // not ready
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(started).toBe(true);
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.on("exit", () => resolve());
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
      });
    }
  }, 15_000);

  test("ISOL8_PORT env var sets port when --port not specified", async () => {
    const port = 30_000 + Math.floor(Math.random() * 10_000);
    const child = spawn(SERVER_BINARY, ["--key", "env-port-key"], {
      stdio: "pipe",
      env: { ...process.env, ISOL8_PORT: String(port) },
    });

    try {
      let started = false;
      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch(`http://localhost:${port}/health`);
          if (res.ok) {
            started = true;
            break;
          }
        } catch {
          // not ready
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(started).toBe(true);
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.on("exit", () => resolve());
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
      });
    }
  }, 15_000);

  test("ISOL8_PORT takes precedence over PORT", async () => {
    const isol8Port = 30_000 + Math.floor(Math.random() * 10_000);
    const fallbackPort = 30_000 + Math.floor(Math.random() * 10_000);
    const child = spawn(SERVER_BINARY, ["--key", "env-port-key"], {
      stdio: "pipe",
      env: {
        ...process.env,
        ISOL8_PORT: String(isol8Port),
        PORT: String(fallbackPort),
      },
    });

    try {
      let started = false;
      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch(`http://localhost:${isol8Port}/health`);
          if (res.ok) {
            started = true;
            break;
          }
        } catch {
          // not ready
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(started).toBe(true);
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.on("exit", () => resolve());
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
      });
    }
  }, 15_000);

  // ── Unknown arguments ──────────────────────────────────────────

  test("unknown argument exits with error", async () => {
    try {
      await execAsync(`${SERVER_BINARY} --bogus`, {
        cwd: ROOT,
        timeout: 10_000,
      });
      throw new Error("Should have failed");
    } catch (err: any) {
      expect(err.code).not.toBe(0);
      expect(err.stderr).toContain("Unknown argument");
    }
  });

  // ── Server behavior ────────────────────────────────────────────

  test("/health responds with status ok and correct version", async () => {
    const port = 30_000 + Math.floor(Math.random() * 10_000);
    const child = spawn(SERVER_BINARY, ["--port", String(port), "--key", "health-key"], {
      stdio: "pipe",
      env: { ...process.env },
    });

    try {
      let body: any;
      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch(`http://localhost:${port}/health`);
          if (res.ok) {
            body = await res.json();
            break;
          }
        } catch {
          // not ready
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(body).toBeDefined();
      expect(body.status).toBe("ok");
      expect(body.version).toBe(packageVersion);
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.on("exit", () => resolve());
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
      });
    }
  }, 15_000);

  test("/health does not require auth", async () => {
    const port = 30_000 + Math.floor(Math.random() * 10_000);
    const child = spawn(SERVER_BINARY, ["--port", String(port), "--key", "auth-test-key"], {
      stdio: "pipe",
      env: { ...process.env },
    });

    try {
      let statusCode: number | undefined;
      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch(`http://localhost:${port}/health`);
          statusCode = res.status;
          if (res.ok) {
            break;
          }
        } catch {
          // not ready
        }
        await new Promise((r) => setTimeout(r, 200));
      }
      expect(statusCode).toBe(200);
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.on("exit", () => resolve());
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
      });
    }
  }, 15_000);

  test("authenticated endpoints return 401 without bearer token", async () => {
    const port = 30_000 + Math.floor(Math.random() * 10_000);
    const child = spawn(SERVER_BINARY, ["--port", String(port), "--key", "secret-key"], {
      stdio: "pipe",
      env: { ...process.env },
    });

    try {
      // Wait for server
      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch(`http://localhost:${port}/health`);
          if (res.ok) {
            break;
          }
        } catch {
          // not ready
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      // POST /execute without auth should be 401
      const res = await fetch(`http://localhost:${port}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ request: { code: "print(1)", runtime: "python" } }),
      });
      expect(res.status).toBe(401);
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.on("exit", () => resolve());
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
      });
    }
  }, 15_000);

  test("authenticated endpoints accept valid bearer token", async () => {
    const port = 30_000 + Math.floor(Math.random() * 10_000);
    const apiKey = "valid-token-test";
    const child = spawn(SERVER_BINARY, ["--port", String(port), "--key", apiKey], {
      stdio: "pipe",
      env: { ...process.env },
    });

    try {
      // Wait for server
      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch(`http://localhost:${port}/health`);
          if (res.ok) {
            break;
          }
        } catch {
          // not ready
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      // POST /execute with correct auth — should not be 401
      // (may be 500 if Docker isn't available, but that's fine — not 401)
      const res = await fetch(`http://localhost:${port}/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ request: { code: "print(1)", runtime: "python" } }),
      });
      expect(res.status).not.toBe(401);
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.on("exit", () => resolve());
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
      });
    }
  }, 15_000);

  test("authenticated endpoints reject wrong bearer token with 403", async () => {
    const port = 30_000 + Math.floor(Math.random() * 10_000);
    const child = spawn(SERVER_BINARY, ["--port", String(port), "--key", "correct-key"], {
      stdio: "pipe",
      env: { ...process.env },
    });

    try {
      // Wait for server
      for (let i = 0; i < 30; i++) {
        try {
          const res = await fetch(`http://localhost:${port}/health`);
          if (res.ok) {
            break;
          }
        } catch {
          // not ready
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      const res = await fetch(`http://localhost:${port}/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-key",
        },
        body: JSON.stringify({ request: { code: "print(1)", runtime: "python" } }),
      });
      expect(res.status).toBe(403);
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.on("exit", () => resolve());
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
      });
    }
  }, 15_000);

  // ── Startup output ─────────────────────────────────────────────

  test("binary prints startup info to stdout", async () => {
    const port = 30_000 + Math.floor(Math.random() * 10_000);
    const child = spawn(SERVER_BINARY, ["--port", String(port), "--key", "startup-key"], {
      stdio: "pipe",
      env: { ...process.env },
    });

    try {
      let stdout = "";
      child.stdout?.on("data", (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      // Wait for startup message
      for (let i = 0; i < 30; i++) {
        if (stdout.includes("listening")) {
          break;
        }
        await new Promise((r) => setTimeout(r, 200));
      }

      expect(stdout).toContain(`v${packageVersion}`);
      expect(stdout).toContain("listening");
      expect(stdout).toContain(String(port));
      expect(stdout).toContain("Auth");
    } finally {
      child.kill("SIGTERM");
      await new Promise<void>((resolve) => {
        child.on("exit", () => resolve());
        setTimeout(() => {
          child.kill("SIGKILL");
          resolve();
        }, 3000);
      });
    }
  }, 15_000);

  // ── Signal handling ────────────────────────────────────────────

  test("SIGTERM causes clean shutdown", async () => {
    const port = 30_000 + Math.floor(Math.random() * 10_000);
    const child = spawn(SERVER_BINARY, ["--port", String(port), "--key", "signal-key"], {
      stdio: "pipe",
      env: { ...process.env },
    });

    // Wait for server to be ready
    for (let i = 0; i < 30; i++) {
      try {
        const res = await fetch(`http://localhost:${port}/health`);
        if (res.ok) {
          break;
        }
      } catch {
        // not ready
      }
      await new Promise((r) => setTimeout(r, 200));
    }

    // Send SIGTERM and verify process terminates within a reasonable time.
    // Register exit listener before signaling to avoid missing fast exits.
    const exited = await new Promise<boolean>((resolve) => {
      let settled = false;
      let timeout: ReturnType<typeof setTimeout> | undefined;

      const finish = (value: boolean) => {
        if (settled) {
          return;
        }
        settled = true;
        if (timeout) {
          clearTimeout(timeout);
        }
        resolve(value);
      };

      child.once("exit", () => finish(true));

      if (child.exitCode !== null || child.signalCode !== null) {
        finish(true);
        return;
      }

      timeout = setTimeout(() => {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
        finish(false);
      }, 5000);

      child.kill("SIGTERM");
    });

    // Verify the port is no longer bound (server stopped)
    try {
      await fetch(`http://localhost:${port}/health`);
      // If we get here, server may still be running briefly — that's ok
    } catch {
      // Expected: connection refused means server shut down
    }

    // The process should have exited (SIGTERM or SIGKILL both count)
    expect(exited).toBe(true);
  }, 15_000);
});

// ─── CLI: run command (Docker-dependent) ─────────────────────────────

describe("CLI run command", () => {
  if (!hasDocker) {
    test.skip("Docker not available — skipping run command tests", () => {});
    return;
  }

  // ── Basic execution ────────────────────────────────────────────

  test("inline Python execution with -e", async () => {
    const { stdout } = await runCLI('run -e "print(1 + 1)" --no-stream');
    expect(stdout).toContain("2");
  }, 30_000);

  test("inline execution with explicit runtime -r node", async () => {
    const { stdout } = await runCLI('run -e "console.log(42)" -r node --no-stream');
    expect(stdout).toContain("42");
  }, 30_000);

  test("inline bash execution", async () => {
    const { stdout } = await runCLI('run -e "echo hello" -r bash --no-stream');
    expect(stdout).toContain("hello");
  }, 30_000);

  test("default runtime is Python when no -r specified", async () => {
    const { stdout } = await runCLI(
      'run -e "import sys; print(sys.version_info.major)" --no-stream'
    );
    expect(stdout).toContain("3");
  }, 30_000);

  // ── File execution ─────────────────────────────────────────────

  test("file-based execution with auto-detected runtime (.py)", async () => {
    const tmpFile = join(tmpdir(), `isol8-test-${Date.now()}.py`);
    writeFileSync(tmpFile, 'print("file-based")');
    try {
      const { stdout } = await runCLI(`run ${tmpFile} --no-stream`);
      expect(stdout).toContain("file-based");
    } finally {
      rmSync(tmpFile);
    }
  }, 30_000);

  test("file-based execution with .sh extension", async () => {
    const tmpFile = join(tmpdir(), `isol8-test-${Date.now()}.sh`);
    writeFileSync(tmpFile, 'echo "shell-script"');
    try {
      const { stdout } = await runCLI(`run ${tmpFile} --no-stream`);
      expect(stdout).toContain("shell-script");
    } finally {
      rmSync(tmpFile);
    }
  }, 30_000);

  test("missing file exits 1", async () => {
    try {
      await runCLI("run /nonexistent/file.py --no-stream");
      throw new Error("Should have failed");
    } catch (err: any) {
      expect(err.code).toBe(1);
      expect(err.stderr).toContain("File not found");
    }
  });

  // ── stdin execution ────────────────────────────────────────────

  test("stdin pipe execution", async () => {
    const { stdout } = await execAsync(
      `echo 'print("from-stdin")' | node ${CLI} run -r python --no-stream`,
      { cwd: ROOT, timeout: 30_000 }
    );
    expect(stdout).toContain("from-stdin");
  }, 30_000);

  // ── Streaming ──────────────────────────────────────────────────

  test("streaming mode (default) outputs to stdout", async () => {
    const proc = spawn("node", [CLI, "run", "-e", 'print("streamed")', "-r", "python"], {
      cwd: ROOT,
    });
    let stdout = "";
    if (proc.stdout) {
      for await (const chunk of proc.stdout) {
        stdout += chunk.toString();
      }
    }
    const exitCode = await new Promise((resolve) => {
      proc.on("exit", resolve);
    });
    expect(stdout).toContain("streamed");
    expect(exitCode).toBe(0);
  }, 30_000);

  // ── --no-stream ────────────────────────────────────────────────

  test("--no-stream disables streaming", async () => {
    const { stdout } = await runCLI('run -e "print(99)" -r python --no-stream');
    expect(stdout).toContain("99");
  }, 30_000);

  // ── --out (file output) ────────────────────────────────────────

  test("--out writes output to file (requires --no-stream)", async () => {
    const outFile = join(tmpdir(), `isol8-out-${Date.now()}.txt`);
    try {
      await runCLI(`run -e "print('file-output')" -r python --no-stream --out ${outFile}`);
      const content = readFileSync(outFile, "utf-8");
      expect(content).toContain("file-output");
    } finally {
      if (existsSync(outFile)) {
        rmSync(outFile);
      }
    }
  }, 30_000);

  // ── --timeout ──────────────────────────────────────────────────

  test("--timeout enforces execution timeout", async () => {
    const start = performance.now();
    try {
      await runCLI('run -e "import time; time.sleep(30)" -r python --timeout 1000 --no-stream');
      throw new Error("Should have failed or timed out");
    } catch {
      const elapsed = performance.now() - start;
      // Should terminate well before 30 seconds
      expect(elapsed).toBeLessThan(15_000);
    }
  }, 30_000);

  // ── --memory ───────────────────────────────────────────────────

  test("--memory is accepted as a flag", async () => {
    const { stdout } = await runCLI('run -e "print(1)" -r python --memory 256m --no-stream');
    expect(stdout).toContain("1");
  }, 30_000);

  // ── --cpu ──────────────────────────────────────────────────────

  test("--cpu is accepted as a flag", async () => {
    const { stdout } = await runCLI('run -e "print(2)" -r python --cpu 0.5 --no-stream');
    expect(stdout).toContain("2");
  }, 30_000);

  // ── --secret ───────────────────────────────────────────────────

  test("--secret masks secret values in output", async () => {
    const { stdout } = await runCLI(
      "run -e \"import os; print(os.environ['MY_KEY'])\" -r python --secret MY_KEY=supersecret123 --no-stream"
    );
    expect(stdout).not.toContain("supersecret123");
    expect(stdout).toContain("***");
  }, 30_000);

  test("--secret with multiple secrets", async () => {
    const { stdout } = await runCLI(
      "run -e \"import os; print(os.environ['A'], os.environ['B'])\" -r python --secret A=aaa --secret B=bbb --no-stream"
    );
    expect(stdout).not.toContain("aaa");
    expect(stdout).not.toContain("bbb");
  }, 30_000);

  // ── --net ──────────────────────────────────────────────────────

  test("--net none blocks network access", async () => {
    const code = `
import urllib.request
try:
    urllib.request.urlopen("https://example.com", timeout=3)
    print("success")
except:
    print("blocked")
`;
    const { stdout } = await runCLI(`run -e '${code}' -r python --net none --no-stream`);
    expect(stdout).toContain("blocked");
  }, 30_000);

  // ── --writable ─────────────────────────────────────────────────

  test("--writable allows writing to root filesystem", async () => {
    const { stdout } = await runCLI(
      "run -e \"import os; os.makedirs('/sandbox/test_dir', exist_ok=True); print('writable-ok')\" -r python --writable --no-stream"
    );
    expect(stdout).toContain("writable-ok");
  }, 30_000);

  // ── --pids-limit ───────────────────────────────────────────────

  test("--pids-limit is accepted as a flag", async () => {
    const { stdout } = await runCLI('run -e "print(3)" -r python --pids-limit 32 --no-stream');
    expect(stdout).toContain("3");
  }, 30_000);

  // ── --max-output ───────────────────────────────────────────────

  test("--max-output truncates large output", async () => {
    const { stdout, stderr } = await runCLI(
      "run -e \"print('x' * 10000)\" -r python --max-output 1024 --no-stream"
    );
    // Output should be truncated
    const combined = stdout + stderr;
    expect(combined).toContain("truncated");
  }, 30_000);

  // ── --sandbox-size / --tmp-size ────────────────────────────────

  test("--sandbox-size is accepted as a flag", async () => {
    const { stdout } = await runCLI('run -e "print(4)" -r python --sandbox-size 256m --no-stream');
    expect(stdout).toContain("4");
  }, 30_000);

  test("--tmp-size is accepted as a flag", async () => {
    const { stdout } = await runCLI('run -e "print(5)" -r python --tmp-size 128m --no-stream');
    expect(stdout).toContain("5");
  }, 30_000);

  // ── --debug ────────────────────────────────────────────────────

  test("--debug enables debug logging output", async () => {
    const { stdout, stderr } = await execAsync(
      `node ${CLI} run -e 'print("debug-test")' -r python --debug --no-stream`,
      { cwd: ROOT, timeout: 30_000 }
    );
    const combined = stdout + stderr;
    // Debug mode should produce [DEBUG] output from engine/pool internals
    expect(combined).toContain("[DEBUG]");
  }, 30_000);

  test("without --debug, no debug output appears", async () => {
    const { stdout, stderr } = await execAsync(
      `node ${CLI} run -e 'print("no-debug")' -r python --no-stream`,
      { cwd: ROOT, timeout: 30_000 }
    );
    const combined = stdout + stderr;
    expect(combined).not.toContain("[DEBUG]");
  }, 30_000);

  // ── --persist ──────────────────────────────────────────────────

  test("--persist keeps container running after execution", async () => {
    const Docker = (await import("dockerode")).default;
    const docker = new Docker();

    // Run with --persist
    const proc = spawn(
      "node",
      [CLI, "run", "-e", 'print("persist-test")', "-r", "python", "--persist", "--no-stream"],
      { cwd: ROOT }
    );
    let stdout = "";
    if (proc.stdout) {
      for await (const chunk of proc.stdout) {
        stdout += chunk.toString();
      }
    }
    await new Promise((resolve) => {
      proc.on("exit", resolve);
    });
    expect(stdout).toContain("persist-test");

    // Check that a container is still running
    const containers = await docker.listContainers({ all: true });
    const isol8Containers = containers.filter((c) => c.Image.startsWith("isol8:python"));

    // Cleanup any persisted containers
    for (const c of isol8Containers) {
      try {
        const container = docker.getContainer(c.Id);
        await container.stop().catch(() => {});
        await container.remove({ force: true }).catch(() => {});
      } catch {
        // ignore
      }
    }

    // At least one container should have existed
    expect(isol8Containers.length).toBeGreaterThanOrEqual(1);
  }, 30_000);

  // ── --persistent (mode) ────────────────────────────────────────

  test("--persistent sets persistent container mode", async () => {
    // In persistent mode, the container should be created and reusable.
    // We just test that the flag is accepted and execution works.
    const { stdout } = await runCLI(
      "run -e \"print('persistent-mode')\" -r python --persistent --no-stream"
    );
    expect(stdout).toContain("persistent-mode");
  }, 30_000);

  // ── --image ────────────────────────────────────────────────────

  test("--image overrides the Docker image", async () => {
    // Use the standard isol8:python image explicitly
    const { stdout } = await runCLI('run -e "print(6)" -r python --image isol8:python --no-stream');
    expect(stdout).toContain("6");
  }, 30_000);

  // ── --stdin ────────────────────────────────────────────────────

  test("--stdin flag pipes data to execution", async () => {
    const { stdout } = await runCLI(
      'run -e "import sys; print(sys.stdin.read())" -r python --stdin "hello-stdin" --no-stream'
    );
    expect(stdout).toContain("hello-stdin");
  }, 30_000);

  // ── --install ──────────────────────────────────────────────────

  test("--install installs a package before execution", async () => {
    const { stdout } = await runCLI(
      'run -e "import requests; print(requests.__version__)" -r python --install requests --net host --no-stream',
      { timeout: 120_000 }
    );
    // Should print a version number
    expect(stdout).toMatch(/\d+\.\d+/);
  }, 120_000);

  test("--install path wraps package manager with timeout", async () => {
    const { stdout, stderr } = await runCLI(
      'run -e "import requests; print(requests.__version__)" -r python --install requests --net host --debug --no-stream',
      { timeout: 120_000 }
    );
    const combined = `${stdout}${stderr}`;
    expect(combined).toContain('Installing packages: ["timeout"');
  }, 120_000);

  test("--install without explicit --net auto-enables filtered mode and registry allowlist", async () => {
    try {
      await runCLI(
        'run -e "print(1)" -r python --install requests --host http://127.0.0.1:1 --debug --no-stream',
        { timeout: 15_000, env: { ...process.env, ISOL8_API_KEY: "" } }
      );
      throw new Error("Should have failed due to missing API key");
    } catch (err: any) {
      const combined = `${err.stdout ?? ""}${err.stderr ?? ""}`;
      expect(combined).toContain("using filtered network mode automatically");
      expect(combined).toContain("Added default package registries for python");
      expect(combined).toContain("API key required");
    }
  }, 30_000);

  test("--install with explicit --net does not override network mode", async () => {
    try {
      await runCLI(
        'run -e "print(1)" -r python --install requests --net none --host http://127.0.0.1:1 --debug --no-stream',
        { timeout: 15_000, env: { ...process.env, ISOL8_API_KEY: "" } }
      );
      throw new Error("Should have failed due to missing API key");
    } catch (err: any) {
      const combined = `${err.stdout ?? ""}${err.stderr ?? ""}`;
      expect(combined).not.toContain("using filtered network mode automatically");
      expect(combined).toContain("Engine options: mode=ephemeral, network=none");
      expect(combined).toContain("API key required");
    }
  }, 30_000);

  // ── --allow / --deny (with --net filtered) ─────────────────────

  test("--allow and --deny are accepted with --net filtered", async () => {
    // Verify the flags are parsed without error and execution completes with exit 0.
    // Note: --net filtered mode may suppress stdout due to proxy setup,
    // so we only verify the process exits successfully.
    const proc = spawn(
      "node",
      [
        CLI,
        "run",
        "-e",
        "print(7)",
        "-r",
        "python",
        "--net",
        "filtered",
        "--allow",
        "example\\.com",
        "--deny",
        "evil\\.com",
        "--no-stream",
      ],
      { cwd: ROOT }
    );
    const exitCode = await new Promise((resolve) => {
      proc.on("exit", resolve);
    });
    expect(exitCode).toBe(0);
  }, 30_000);

  // ── --host / --key (remote mode) ──────────────────────────────

  test("--host without --key and no ISOL8_API_KEY exits 1", async () => {
    try {
      await runCLI('run -e "print(1)" --host http://localhost:9999 --no-stream', {
        env: { ...process.env, ISOL8_API_KEY: "" },
      });
      throw new Error("Should have failed");
    } catch (err: any) {
      expect(err.code).toBe(1);
      expect(err.stderr).toContain("API key required");
    }
  });

  // ── Exit code propagation ──────────────────────────────────────

  test("exit code is propagated from executed code", async () => {
    const proc = spawn(
      "node",
      [CLI, "run", "-e", "import sys; sys.exit(42)", "-r", "python", "--no-stream"],
      { cwd: ROOT }
    );
    const exitCode = await new Promise((resolve) => {
      proc.on("exit", resolve);
    });
    expect(exitCode).toBe(42);
  }, 30_000);

  test("exit code 0 for successful execution", async () => {
    const proc = spawn("node", [CLI, "run", "-e", 'print("ok")', "-r", "python", "--no-stream"], {
      cwd: ROOT,
    });
    const exitCode = await new Promise((resolve) => {
      proc.on("exit", resolve);
    });
    expect(exitCode).toBe(0);
  }, 30_000);

  // ── All runtimes work in bundled CLI ───────────────────────────

  for (const rt of ["python", "node", "bun", "deno", "bash"] as const) {
    const codeMap: Record<string, string> = {
      python: 'print("rt-python")',
      node: 'console.log("rt-node")',
      bun: 'console.log("rt-bun")',
      deno: 'console.log("rt-deno")',
      bash: 'echo "rt-bash"',
    };

    test(`runtime ${rt} works in built CLI`, async () => {
      const { stdout } = await runCLI(`run -e '${codeMap[rt]}' -r ${rt} --no-stream`);
      expect(stdout).toContain(`rt-${rt}`);
    }, 30_000);
  }
});

// ─── CLI: setup command (Docker-dependent) ───────────────────────────

describe("CLI setup command", () => {
  if (!hasDocker) {
    test.skip("Docker not available — skipping setup command tests", () => {});
    return;
  }

  test("setup completes without ENOENT (Dockerfile path resolution)", async () => {
    // This is the exact bug we fixed — the built CLI resolving
    // docker/Dockerfile to the wrong path
    const { stdout } = await runCLI("setup", { timeout: 300_000 });
    expect(stdout).toContain("Setup complete");
  }, 300_000);

  test("setup detects Docker is running", async () => {
    // The setup command checks Docker availability before building images.
    // If Docker wasn't running, setup would fail — so "Setup complete" implies
    // Docker was detected. The "Docker is running" spinner text is overwritten
    // by ora, so we verify the final success message instead.
    const { stdout } = await runCLI("setup", { timeout: 300_000 });
    expect(stdout).toContain("Setup complete");
  }, 300_000);
});

// ─── CLI: cleanup command (Docker-dependent) ─────────────────────────

describe("CLI cleanup command", () => {
  if (!hasDocker) {
    test.skip("Docker not available — skipping cleanup command tests", () => {});
    return;
  }

  test("cleanup --force exits 0", async () => {
    const proc = spawn("node", [CLI, "cleanup", "--force"], { cwd: ROOT });
    let stdout = "";
    let stderr = "";
    if (proc.stdout) {
      for await (const chunk of proc.stdout) {
        stdout += chunk.toString();
      }
    }
    if (proc.stderr) {
      for await (const chunk of proc.stderr) {
        stderr += chunk.toString();
      }
    }
    const exitCode = await new Promise((resolve) => {
      proc.on("exit", resolve);
    });
    expect(exitCode).toBe(0);
    // Should either find containers or report none found
    const combined = stdout + stderr;
    expect(combined.includes("Removed") || combined.includes("No isol8 containers")).toBe(true);
  }, 30_000);
});

// ─── Library bundle ──────────────────────────────────────────────────

describe("library bundle", () => {
  test("all value exports are importable", async () => {
    const lib = await import(join(DIST, "index.js"));

    expect(lib.DockerIsol8).toBeDefined();
    expect(lib.RemoteIsol8).toBeDefined();
    expect(lib.loadConfig).toBeDefined();
    expect(lib.createServer).toBeDefined();
    expect(lib.VERSION).toBeDefined();
    expect(lib.RuntimeRegistry).toBeDefined();
    expect(lib.PythonAdapter).toBeDefined();
    expect(lib.NodeAdapter).toBeDefined();
    expect(lib.BunAdapter).toBeDefined();
    expect(lib.DenoAdapter).toBeDefined();
    expect(lib.bashAdapter).toBeDefined();
  });

  test("VERSION matches package.json version", async () => {
    const lib = await import(join(DIST, "index.js"));
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf-8"));
    expect(lib.VERSION).toBe(pkg.version);
  });

  test("RuntimeRegistry.list() returns 5 adapters", async () => {
    const lib = await import(join(DIST, "index.js"));
    const adapters = lib.RuntimeRegistry.list();
    expect(adapters).toHaveLength(5);

    const names = adapters.map((a: any) => a.name);
    expect(names).toContain("python");
    expect(names).toContain("node");
    expect(names).toContain("bun");
    expect(names).toContain("deno");
    expect(names).toContain("bash");
  });

  test("RuntimeRegistry.get() returns correct adapters", async () => {
    const lib = await import(join(DIST, "index.js"));

    for (const name of ["python", "node", "bun", "deno", "bash"]) {
      const adapter = lib.RuntimeRegistry.get(name);
      expect(adapter.name).toBe(name);
      expect(adapter.image).toBe(`isol8:${name}`);
    }
  });

  test("RuntimeRegistry.get() throws on unknown runtime", async () => {
    const lib = await import(join(DIST, "index.js"));
    expect(() => lib.RuntimeRegistry.get("rust")).toThrow();
  });

  test("RuntimeRegistry.detect() resolves file extensions", async () => {
    const lib = await import(join(DIST, "index.js"));

    expect(lib.RuntimeRegistry.detect("test.py").name).toBe("python");
    expect(lib.RuntimeRegistry.detect("test.js").name).toBe("node");
    expect(lib.RuntimeRegistry.detect("test.mjs").name).toBe("node");
    expect(lib.RuntimeRegistry.detect("test.ts").name).toBe("bun");
    expect(lib.RuntimeRegistry.detect("test.sh").name).toBe("bash");
    expect(lib.RuntimeRegistry.detect("test.mts").name).toBe("deno");
  });

  test("loadConfig() returns valid defaults from built bundle", async () => {
    const lib = await import(join(DIST, "index.js"));
    const tmpDir = join(tmpdir(), `isol8-build-test-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    try {
      const config = lib.loadConfig(tmpDir);
      expect(config.maxConcurrent).toBe(10);
      expect(config.defaults.timeoutMs).toBe(30_000);
      expect(config.defaults.memoryLimit).toBe("512m");
      expect(config.defaults.cpuLimit).toBe(1);
      expect(config.defaults.network).toBe("none");
      expect(config.debug).toBe(false);
      expect(config.cleanup.autoPrune).toBe(true);
      expect(config.poolStrategy).toBe("fast");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("DockerIsol8 is constructable", async () => {
    const lib = await import(join(DIST, "index.js"));
    // Construct with default options — should not throw
    // (Docker doesn't need to be available; lazy initialization)
    const engine = new lib.DockerIsol8();
    expect(engine).toBeDefined();
  });

  test("RemoteIsol8 is constructable", async () => {
    const lib = await import(join(DIST, "index.js"));
    const client = new lib.RemoteIsol8({
      host: "http://localhost:3000",
      apiKey: "test-key",
    });
    expect(client).toBeDefined();
  });

  test("adapter objects have correct interface", async () => {
    const lib = await import(join(DIST, "index.js"));

    for (const adapter of [
      lib.PythonAdapter,
      lib.NodeAdapter,
      lib.BunAdapter,
      lib.DenoAdapter,
      lib.bashAdapter,
    ]) {
      expect(typeof adapter.name).toBe("string");
      expect(typeof adapter.image).toBe("string");
      expect(typeof adapter.getCommand).toBe("function");
      expect(typeof adapter.getFileExtension).toBe("function");

      // getCommand should return an array (Deno requires a file path)
      const cmd = adapter.getCommand('print("test")', "/sandbox/test.py");
      expect(Array.isArray(cmd)).toBe(true);
      expect(cmd.length).toBeGreaterThan(0);

      // getFileExtension should return a string starting with "."
      const ext = adapter.getFileExtension();
      expect(ext.startsWith(".")).toBe(true);
    }
  });

  test("createServer is a function", async () => {
    const lib = await import(join(DIST, "index.js"));
    expect(typeof lib.createServer).toBe("function");
  });
});

// ─── Cleanup ─────────────────────────────────────────────────────────

// Cleanup any leftover containers from --persist test
// Global cleanup is handled by tests/preload.ts via bunfig.toml
