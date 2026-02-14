import { describe, expect, test } from "bun:test";
import { exec } from "node:child_process";
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
});
