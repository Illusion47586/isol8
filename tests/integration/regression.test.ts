import { describe, expect, test } from "bun:test";
import { DockerIsol8 } from "../../src/engine/docker";
import { hasDocker } from "./setup";

describe("Regression Tests", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  test("Regression: Network isolation race condition (run 5 times)", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
    });

    const code = `
import urllib.request
try:
    urllib.request.urlopen("https://example.com", timeout=2)
    print("success")
except:
    print("failure")
    `;

    for (let i = 0; i < 5; i++) {
      const result = await engine.execute({
        code,
        runtime: "python",
      });
      expect(result.stdout.trim()).toBe("failure");
    }
  }, 120_000);

  test("Regression: Memory limit timeout", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      memoryLimit: "32m",
    });

    const result = await engine.execute({
      code: "x = 'a' * 1024 * 1024 * 100",
      runtime: "python",
      timeoutMs: 10_000,
    });

    // Should not time out (which would result in "EXECUTION TIMED OUT" in stderr)
    // Should be killed by OOM (exit code 137 usually)
    expect(result.stderr).not.toContain("EXECUTION TIMED OUT");
    expect(result.exitCode).not.toBe(0);
  }, 30_000);
});
