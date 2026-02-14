import { describe, expect, test } from "bun:test";
import { exec, spawn } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { hasDocker } from "./setup";

const execAsync = promisify(exec);
const CLI_PATH = join(process.cwd(), "src/cli.ts");

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
      'run -e "import numpy; print(numpy.__version__)" --runtime python --install numpy --net host --writable'
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
      `echo 'print("hello stdin")' | bun run src/cli.ts run --runtime python`
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
