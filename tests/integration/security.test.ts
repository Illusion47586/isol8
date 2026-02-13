import { describe, expect, test } from "bun:test";
import { DockerIsol8 } from "../../src/engine/docker";
import { hasDocker } from "./setup";

describe("Integration: Security & Limits", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  test("Network: 'none' blocks outbound requests", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
    });

    // Python requests should fail
    const result = await engine.execute({
      code: `
import urllib.request
try:
    urllib.request.urlopen("https://example.com", timeout=2)
    print("success")
except:
    print("failure")
      `,
      runtime: "python",
    });

    expect(result.stdout).toContain("failure");
  }, 30_000);

  test("Timeout kills execution", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
    });

    const start = performance.now();
    const result = await engine.execute({
      code: "import time; time.sleep(5)",
      runtime: "python",
      timeoutMs: 1000, // 1s timeout
    });
    const end = performance.now();

    // Should finish around 1s, not 5s
    expect(end - start).toBeLessThan(3000);
    // When killed, exit code is usually 137 (SIGKILL) or similar non-zero
    expect(result.exitCode).not.toBe(0);
  });

  test("Memory limit enforcement", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      memoryLimit: "32m", // Low limit
    });

    // Allocate 100MB
    const result = await engine.execute({
      code: "x = 'a' * 1024 * 1024 * 100",
      runtime: "python",
    });

    // Should crash/OOM
    expect(result.exitCode).not.toBe(0);
  });
});
