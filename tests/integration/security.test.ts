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
  }, 60_000);

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

    // Container setup adds overhead; total should still be well under 5s (the sleep duration)
    expect(end - start).toBeLessThan(5000);
    // When killed, exit code is usually 137 (SIGKILL) or similar non-zero
    expect(result.exitCode).not.toBe(0);
  }, 30_000);

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
  }, 30_000);

  test("Network: 'filtered' blocks raw socket bypass via iptables", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "filtered",
      networkFilter: {
        whitelist: ["^example\\.com$"],
        blacklist: [],
      },
    });

    // Attempt a raw socket connection that bypasses the proxy.
    // With iptables enforcement, this should be dropped at the kernel level.
    const result = await engine.execute({
      code: `
import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(3)
    s.connect(("1.1.1.1", 80))
    s.close()
    print("bypass_success")
except Exception as e:
    print("bypass_blocked")
      `,
      runtime: "python",
      timeoutMs: 15_000,
    });

    // The raw socket connection should be blocked by iptables
    expect(result.stdout).toContain("bypass_blocked");
  }, 60_000);

  test("Network: 'filtered' allows HTTP through proxy", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "filtered",
      networkFilter: {
        whitelist: ["^example\\.com$"],
        blacklist: [],
      },
    });

    // HTTP request through proxy should work for whitelisted host
    const result = await engine.execute({
      code: `
import urllib.request
try:
    r = urllib.request.urlopen("http://example.com", timeout=5)
    print("proxy_allowed")
except Exception as e:
    print(f"proxy_error: {e}")
      `,
      runtime: "python",
      timeoutMs: 15_000,
    });

    expect(result.stdout).toContain("proxy_allowed");
  }, 60_000);
});
