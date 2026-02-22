/**
 * Build output tests — verifies the bundled packages work correctly.
 *
 * These tests run against the built artifacts in `dist/` directories
 * (what users actually install), not the TypeScript source.
 */

import { beforeAll, describe, expect, test } from "bun:test";
import { exec } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";

const execAsync = promisify(exec);

const ROOT = resolve(import.meta.dir, "../..");
const CLI_DIST = join(ROOT, "apps/cli/dist");
const CORE_DIST = join(ROOT, "packages/core/dist");
const SERVER_DIST = join(ROOT, "apps/server/dist");
const CLI = join(CLI_DIST, "cli.js");

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
  const result = await execAsync("bun run build", { cwd: ROOT, timeout: 180_000 });
  if (result.stderr?.includes("build failed")) {
    throw new Error(`Build failed: ${result.stderr}`);
  }
}, 240_000);

// ─── CLI Artifact integrity ─────────────────────────────────────────────

describe("CLI artifact integrity", () => {
  test("CLI bundle exists", () => {
    expect(existsSync(CLI)).toBe(true);
  });

  test("CLI bundle has Node.js shebang", () => {
    const content = readFileSync(CLI, "utf-8");
    expect(content.startsWith("#!/usr/bin/env node")).toBe(true);
  });

  test("CLI bundle is ESM format", () => {
    const content = readFileSync(CLI, "utf-8");
    expect(content).toContain("import");
  });

  test("CLI dist includes docker assets", () => {
    expect(existsSync(join(CLI_DIST, "docker/Dockerfile"))).toBe(true);
    expect(existsSync(join(CLI_DIST, "docker/proxy.sh"))).toBe(true);
    expect(existsSync(join(CLI_DIST, "docker/proxy-handler.sh"))).toBe(true);
  });
});

// ─── Core Artifact integrity ────────────────────────────────────────────

describe("Core artifact integrity", () => {
  test("library bundle exists", () => {
    expect(existsSync(join(CORE_DIST, "index.js"))).toBe(true);
  });

  test("library bundle is ESM format", () => {
    const content = readFileSync(join(CORE_DIST, "index.js"), "utf-8");
    expect(content).toContain("export");
  });

  test("library bundle keeps externals as imports", () => {
    const content = readFileSync(join(CORE_DIST, "index.js"), "utf-8");
    for (const pkg of ["dockerode", "hono"]) {
      expect(content).toContain(`"${pkg}"`);
    }
  });

  test("type declarations exist", () => {
    expect(existsSync(join(CORE_DIST, "index.d.ts"))).toBe(true);
  });

  test("docker assets copied to dist", () => {
    expect(existsSync(join(CORE_DIST, "docker/Dockerfile"))).toBe(true);
    expect(existsSync(join(CORE_DIST, "docker/proxy.sh"))).toBe(true);
  });
});

// ─── Server Artifact integrity ──────────────────────────────────────────

describe("Server artifact integrity", () => {
  test("server binary exists", () => {
    expect(existsSync(join(SERVER_DIST, "isol8-server"))).toBe(true);
  });

  test("server binary is a reasonable size", () => {
    const stat = statSync(join(SERVER_DIST, "isol8-server"));
    // Compiled Bun binary should be >10MB
    expect(stat.size).toBeGreaterThan(10 * 1024 * 1024);
  });
});

// ─── Type declarations ──────────────────────────────────────────────

describe("type declarations", () => {
  test("index.d.ts exports all public API types", () => {
    const dts = readFileSync(join(CORE_DIST, "index.d.ts"), "utf-8");

    const expectedExports = [
      "Isol8Engine",
      "DockerIsol8",
      "RemoteIsol8",
      "ExecutionRequest",
      "ExecutionResult",
      "StreamEvent",
      "Isol8Options",
      "Isol8Config",
      "Runtime",
      "RuntimeAdapter",
      "RuntimeRegistry",
      "loadConfig",
      "VERSION",
    ];

    for (const name of expectedExports) {
      expect(dts).toContain(name);
    }
  });

  test("index.d.ts exports adapter constants", () => {
    const dts = readFileSync(join(CORE_DIST, "index.d.ts"), "utf-8");

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

      expect(config.maxConcurrent).toBe(10);
      expect(config.debug).toBe(false);
      expect(config.defaults.timeoutMs).toBe(30_000);
      expect(config.defaults.memoryLimit).toBe("512m");
      expect(config.defaults.cpuLimit).toBe(1);
      expect(config.defaults.network).toBe("none");
      expect(config.defaults.sandboxSize).toBe("512m");
      expect(config.defaults.tmpSize).toBe("256m");
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

      expect(config.defaults.timeoutMs).toBe(60_000);
      expect(config.defaults.memoryLimit).toBe("1g");
      expect(config.defaults.cpuLimit).toBe(1);
      expect(config.defaults.network).toBe("none");
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

// ─── CLI: run command (Docker-dependent) ─────────────────────────────

describe("CLI run command", () => {
  if (!hasDocker) {
    test.skip("Docker not available — skipping run command tests", () => {});
    return;
  }

  beforeAll(async () => {
    await runCLI("setup", { timeout: 300_000 });
  }, 330_000);

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
});
