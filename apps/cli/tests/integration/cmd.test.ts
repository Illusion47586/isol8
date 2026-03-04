import { describe, expect, test } from "bun:test";
import { DockerIsol8 } from "@isol8/core";
import { hasDocker } from "./setup";

describe("Integration: cmd execution", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  const engine = new DockerIsol8({
    mode: "ephemeral",
    network: "none",
    memoryLimit: "128m",
  });

  test("cmd runs bash regardless of runtime=python", async () => {
    const result = await engine.execute({
      cmd: "echo hello-from-cmd",
      runtime: "python",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello-from-cmd");
  }, 30_000);

  test("cmd runs bash regardless of runtime=node", async () => {
    const result = await engine.execute({
      cmd: "echo hello-from-cmd",
      runtime: "node",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello-from-cmd");
  }, 30_000);

  test("cmd runs bash regardless of runtime=bun", async () => {
    const result = await engine.execute({
      cmd: "echo hello-from-cmd",
      runtime: "bun",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello-from-cmd");
  }, 30_000);

  test("cmd runs bash regardless of runtime=deno", async () => {
    const result = await engine.execute({
      cmd: "echo hello-from-cmd",
      runtime: "deno",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello-from-cmd");
  }, 30_000);

  test("cmd runs bash regardless of runtime=bash", async () => {
    const result = await engine.execute({
      cmd: "echo hello-from-cmd",
      runtime: "bash",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello-from-cmd");
  }, 30_000);

  test("cmd supports multi-step shell pipeline", async () => {
    const result = await engine.execute({
      cmd: "echo 'hello world' | tr '[:lower:]' '[:upper:]'",
      runtime: "python",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("HELLO WORLD");
  }, 30_000);

  test("cmd non-zero exit code is preserved", async () => {
    const result = await engine.execute({
      cmd: "exit 42",
      runtime: "bash",
    });
    expect(result.exitCode).toBe(42);
  }, 30_000);

  test("cmd with env vars", async () => {
    const result = await engine.execute({
      cmd: "echo $MY_VAR",
      runtime: "python",
      env: { MY_VAR: "from-env" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("from-env");
  }, 30_000);
});
