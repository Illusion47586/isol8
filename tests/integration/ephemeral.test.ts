import { describe, expect, test } from "bun:test";
import { DockerIsol8 } from "../../src/engine/docker";
import { hasDocker } from "./setup";

describe("Integration: Ephemeral Execution", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  const engine = new DockerIsol8({
    mode: "ephemeral",
    network: "none",
    memoryLimit: "128m",
  });

  test("Python: hello world", async () => {
    const result = await engine.execute({
      code: 'print("Hello Python")',
      runtime: "python",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hello Python");
    expect(result.stderr).toBe("");
  });

  test("Node: hello world", async () => {
    const result = await engine.execute({
      code: 'console.log("Hello Node")',
      runtime: "node",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hello Node");
  });

  test("Bun: hello world", async () => {
    const result = await engine.execute({
      code: 'console.log("Hello Bun")',
      runtime: "bun",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hello Bun");
  });

  test("Deno: hello world", async () => {
    const result = await engine.execute({
      code: 'console.log("Hello Deno")',
      runtime: "deno",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hello Deno");
  });

  test("Bash: hello world", async () => {
    const result = await engine.execute({
      code: 'echo "Hello Bash"',
      runtime: "bash",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hello Bash");
  });

  test("Exit code propagation", async () => {
    const result = await engine.execute({
      code: "import sys; sys.exit(42)",
      runtime: "python",
    });
    expect(result.exitCode).toBe(42);
  });

  test("Stderr capture", async () => {
    const result = await engine.execute({
      code: 'import sys; print("error!", file=sys.stderr)',
      runtime: "python",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stderr).toContain("error!");
  });
});
