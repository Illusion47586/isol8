import { describe, expect, test } from "bun:test";
import { DockerIsol8 } from "@isol8/core";
import { hasDocker } from "./setup";

/**
 * Integration tests for the agent runtime.
 *
 * These tests verify the agent Docker image (isol8:agent) works correctly
 * inside real containers. Since we cannot make actual LLM API calls in tests,
 * we test:
 * - The pi binary is accessible and runnable
 * - The container has required tools (bun, git, bash)
 * - The agent validation logic (filtered network + whitelist required)
 * - Command construction and flag passing
 * - File injection via the files option
 */
describe("Integration: Agent Runtime", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  // ── Validation Tests ──

  test("Agent runtime rejects network: 'none'", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
    });

    await expect(
      engine.execute({
        code: "Write hello world",
        runtime: "agent",
      })
    ).rejects.toThrow('Agent runtime requires network mode "filtered"');
  }, 30_000);

  test("Agent runtime rejects filtered network without whitelist", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "filtered",
      networkFilter: {
        whitelist: [],
        blacklist: [],
      },
    });

    await expect(
      engine.execute({
        code: "Write hello world",
        runtime: "agent",
      })
    ).rejects.toThrow("Agent runtime requires at least one network whitelist entry");
  }, 30_000);

  // ── Container Environment Tests ──
  // These use bash runtime with the agent image override to verify the container contents

  test("Agent container has pi binary available", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      image: "isol8:agent",
    });

    const result = await engine.execute({
      code: "pi --version",
      runtime: "bash",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  }, 30_000);

  test("Agent container has bun available", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      image: "isol8:agent",
    });

    const result = await engine.execute({
      code: "bun --version",
      runtime: "bash",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  }, 30_000);

  test("Agent container has git available", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      image: "isol8:agent",
    });

    const result = await engine.execute({
      code: "git --version",
      runtime: "bash",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("git version");
  }, 30_000);

  test("Agent container has bash available", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      image: "isol8:agent",
    });

    const result = await engine.execute({
      code: "bash --version",
      runtime: "bash",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("GNU bash");
  }, 30_000);

  // ── pi CLI Behavior Tests (no API key needed) ──

  test("pi --help runs without error", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      image: "isol8:agent",
    });

    const result = await engine.execute({
      code: "pi --help",
      runtime: "bash",
    });

    // pi --help should output help text and exit 0
    expect(result.exitCode).toBe(0);
    expect(result.stdout.length).toBeGreaterThan(0);
  }, 30_000);

  // ── File Injection Tests ──

  test("Files are injected into the container sandbox", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      image: "isol8:agent",
    });

    const result = await engine.execute({
      code: "cat /sandbox/hello.txt && cat /sandbox/world.txt",
      runtime: "bash",
      files: {
        "/sandbox/hello.txt": "Hello from file injection!",
        "/sandbox/world.txt": "Second file content",
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hello from file injection!");
    expect(result.stdout).toContain("Second file content");
  }, 30_000);

  test("Injected files are readable by the sandbox user", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      image: "isol8:agent",
    });

    const result = await engine.execute({
      code: 'ls -la /sandbox/test.py && echo "readable"',
      runtime: "bash",
      files: {
        "/sandbox/test.py": 'print("hello")',
      },
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("readable");
  }, 30_000);
});
