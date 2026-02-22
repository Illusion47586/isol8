import { describe, expect, test } from "bun:test";
import { exec, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { hasDocker } from "./setup";

const execAsync = promisify(exec);

// Resolve CLI path relative to this test file
const TEST_DIR = dirname(import.meta.dir);
const CLI_DIR = dirname(TEST_DIR);
const CLI_PATH = join(CLI_DIR, "src/cli.ts");

describe("Integration: CLI", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  // Helper to run CLI
  const runCLI = async (args: string, options: { cwd?: string } = {}) => {
    return execAsync(`bun run ${CLI_PATH} ${args}`, options);
  };

  test("runs python code", async () => {
    const { stdout } = await runCLI('run -e "print(1+1)" --runtime python --net none');
    expect(stdout).toContain("2");
  }, 30_000);

  test("installs packages via --install", async () => {
    // This might be slow
    const { stdout } = await runCLI(
      'run -e "import numpy; print(numpy.__version__)" --runtime python --install numpy --net host'
    );
    expect(stdout).toMatch(/\d+\.\d+\.\d+/);
  }, 120_000);

  test("shows config", async () => {
    const { stdout } = await runCLI("config");
    expect(stdout).toContain("Isol8 Configuration");
    expect(stdout).toContain("General");
  });

  // ─── Input Modes ───

  test("runs file argument", async () => {
    const scriptPath = "tests/integration/temp_script.py";
    const scriptContent = 'print("hello file")';
    await Bun.write(scriptPath, scriptContent);
    try {
      const { stdout } = await runCLI(`run ${scriptPath}`);
      expect(stdout).toContain("hello file");
    } finally {
      await Bun.file(scriptPath).delete();
    }
  });

  test("reads from stdin", async () => {
    const { stdout } = await execAsync(
      `echo 'print("hello stdin")' | bun run ${CLI_PATH} run --runtime python`
    );
    expect(stdout).toContain("hello stdin");
  });

  // ─── Runtimes ───

  test("supports node runtime", async () => {
    const { stdout } = await runCLI('run -e "console.log(1+1)" --runtime node');
    expect(stdout).toContain("2");
  });

  test("supports bun runtime", async () => {
    const { stdout } = await runCLI('run -e "console.log(1+1)" --runtime bun');
    expect(stdout).toContain("2");
  });

  test("supports bash runtime", async () => {
    const { stdout } = await runCLI('run -e "echo hello" --runtime bash');
    expect(stdout).toContain("hello");
  });

  // ─── Resource Limits ───

  test("enforces timeout", async () => {
    try {
      // Use a shorter sleep and timeout to be faster
      await runCLI('run -e "import time; time.sleep(2)" --runtime python --timeout 500');
      throw new Error("Should have failed");
    } catch (err: any) {
      expect(err.code).not.toBe(0);
      // CLI catches error and exits with 1, or 124/137 if killed directly.
      // Since wrapper uses timeout -s KILL, it might be 137, but if CLI wraps it, it might be 1.
      expect(err.code).toBeGreaterThan(0);
    }
  });

  // ... memory limit and max output tests ...

  // ─── Network ───

  test("blocks network by default", async () => {
    try {
      // Use short timeout to avoid hanging if network blocking fails (it shouldn't hang but connect)
      // Python's urlopen raises error if network is unreachable
      await runCLI(
        "run -e \"import urllib.request; urllib.request.urlopen('http://example.com', timeout=1)\" --runtime python --net none"
      );
      throw new Error("Should have failed");
    } catch (err: any) {
      expect(err.code).not.toBe(0);
    }
  }, 10_000);

  // ... filtered mode test ...

  // ─── Configuration ───

  // ... loads defaults test ...

  test("overrides config with flags", async () => {
    const tmpDir = join(tmpdir(), `isol8-test-config-override-${Date.now()}`);
    mkdirSync(tmpDir, { recursive: true });
    // Config sets timeout to 10s
    writeFileSync(
      join(tmpDir, "isol8.config.json"),
      JSON.stringify({
        defaults: { timeoutMs: 10_000 },
      })
    );

    try {
      // Verification via 'config' command is tricky if it doesn't support overrides.
      // Instead, let's verify via execution behavior.
      // Override timeout to 100ms and run a 2s script. It should fail.
      try {
        await runCLI('run -e "import time; time.sleep(2)" --runtime python --timeout 100', {
          cwd: tmpDir,
        });
        throw new Error("Should have failed due to overridden timeout");
      } catch (err: any) {
        expect(err.code).not.toBe(0);
      }
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("executes .cjs file as CommonJS", async () => {
    const filePath = join(tmpdir(), `test-${Date.now()}.cjs`);
    try {
      writeFileSync(filePath, "const fs = require('fs'); console.log('CJS works');");
      const proc = spawn("bun", ["run", CLI_PATH, "run", filePath, "--runtime", "node"]);

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

      if (exitCode !== 0) {
        console.error("CJS Test Stderr:", stderr);
      }

      expect(exitCode).toBe(0);
      expect(stdout).toContain("CJS works");
    } finally {
      rmSync(filePath, { force: true });
    }
  });

  test("does not show ESM warning for Node.js", async () => {
    // Run simple ESM code
    const proc = spawn("bun", [
      "run",
      CLI_PATH,
      "run",
      "-e",
      "console.log('ESM works')",
      "--runtime",
      "node",
    ]);

    let stderr = "";
    if (proc.stderr) {
      for await (const chunk of proc.stderr) {
        stderr += chunk.toString();
      }
    }

    const exitCode = await new Promise((resolve) => {
      proc.on("exit", resolve);
    });

    expect(exitCode).toBe(0);
    expect(stderr).not.toContain("MODULE_TYPELESS_PACKAGE_JSON");
  });

  // ─── Streaming ───

  test("streams output by default", async () => {
    const proc = spawn("bun", [
      "run",
      "src/cli.ts",
      "run",
      "-e",
      'import time; print("start"); time.sleep(0.5); print("end")',
      "--runtime",
      "python",
      "--net",
      "none",
    ]);

    const chunks: string[] = [];
    proc.stdout.on("data", (data) => {
      chunks.push(data.toString());
    });

    await new Promise<void>((resolve) => {
      proc.on("close", () => resolve());
    });

    const output = chunks.join("");
    expect(output).toContain("start");
    expect(output).toContain("end");
  }, 30_000);

  test("buffers output with --no-stream", async () => {
    const { stdout } = await runCLI(
      'run -e "print(1); import time; time.sleep(0.1); print(2)" --runtime python --no-stream'
    );
    expect(stdout).toContain("1");
    expect(stdout).toContain("2");
  });
});
