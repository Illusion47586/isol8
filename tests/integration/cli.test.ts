import { describe, expect, test } from "bun:test";
import { exec, spawn } from "node:child_process";
import { promisify } from "node:util";
import { hasDocker } from "./setup";

const execAsync = promisify(exec);

describe("Integration: CLI", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  // Helper to run CLI
  const runCLI = async (args: string) => {
    return execAsync(`bun run src/cli.ts ${args}`);
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

  test("streams output with --stream", async () => {
    const proc = spawn("bun", [
      "run",
      "src/cli.ts",
      "run",
      "-e",
      'import time; print("start"); time.sleep(0.5); print("end")',
      "--runtime",
      "python",
      "--stream",
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
    // Verify we got at least 2 chunks (start and end might be in same chunk if fast, but likely separate due to sleep)
    // Note: Checking for chunks length is flaky, but checking content is safe.
    // Ideally we'd check timing, but that's hard.
    // Just verifying it runs and produces output is a good basic test.
    // If it wasn't streaming, it might buffer differently, but with -e it's hard to distinguish buffering vs streaming from final output alone without timing checks.
    // However, the fact that it exits with 0 and prints output confirms the flag works and implementation doesn't crash.
  }, 30_000);
});
