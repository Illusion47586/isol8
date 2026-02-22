import { describe, expect, test } from "bun:test";
import { DockerIsol8 } from "@isol8/core";
import { hasDocker } from "./setup";

describe("Integration: File I/O", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  const engine = new DockerIsol8({
    mode: "ephemeral",
    network: "none",
    readonlyRootFs: false,
    security: { seccomp: "unconfined" },
  });

  // This test ensures that the writeFileViaExec (which uses spawn + stdin) works correctly
  test("writes and reads files correctly", async () => {
    const secret = `secret-${Math.random()}`;

    // Execute code that reads a file we inject
    // And writes a file we retrieve
    const result = await engine.execute({
      // Read the injected file and print it
      code: "cat /sandbox/in.txt",
      runtime: "bash",
      files: {
        "/sandbox/in.txt": secret,
      },
      env: {},
      timeoutMs: 5000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain(secret);
  }, 10_000);

  test("writes large content correctly", async () => {
    // 100KB string
    const largeContent = "a".repeat(100 * 1024);

    const result = await engine.execute({
      code: "wc -c < /sandbox/large.txt",
      runtime: "bash",
      files: {
        "/sandbox/large.txt": largeContent,
      },
      timeoutMs: 10_000,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe((100 * 1024).toString());
  }, 15_000);
});
