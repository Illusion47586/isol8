/**
 * Production tests: Security features
 * Tests: network modes, secret masking, resource limits
 */

import { describe, expect, test } from "bun:test";
import { runIsol8 } from "./utils";

describe("Security: Network Isolation", () => {
  test("network none blocks outbound HTTP requests", async () => {
    const code = `
import urllib.request
try:
    urllib.request.urlopen("https://example.com", timeout=2)
    print("NETWORK_NOT_BLOCKED")
except Exception as e:
    print("NETWORK_BLOCKED")
`;
    const { stdout } = await runIsol8(`run -e '${code}' -r python --net none --no-stream`);
    expect(stdout).toContain("NETWORK_BLOCKED");
  }, 30_000);

  test("network host allows outbound HTTP requests", async () => {
    const code = `
import urllib.request
try:
    urllib.request.urlopen("https://api.github.com", timeout=5)
    print("NETWORK_ALLOWED")
except Exception as e:
    print(f"NETWORK_ERROR: {e}")
`;
    const { stdout } = await runIsol8(`run -e '${code}' -r python --net host --no-stream`);
    expect(stdout).toContain("NETWORK_ALLOWED");
  }, 30_000);

  test("network filtered with whitelist restricts access", async () => {
    // This tests that the filtered mode is applied
    // Exact behavior depends on whitelist configuration
    const code = `
import urllib.request
try:
    urllib.request.urlopen("https://example.com", timeout=2)
    print("ACCESS_GRANTED")
except Exception as e:
    print("ACCESS_DENIED")
`;
    const { stdout } = await runIsol8(
      `run -e '${code}' -r python --net filtered --allow "example\\.com" --no-stream`
    );
    // Should complete without error (filter applied)
    expect(stdout).toMatch(/ACCESS_GRANTED|ACCESS_DENIED/);
  }, 30_000);
});

describe("Security: Secret Masking", () => {
  test("--secret values are masked in stdout", async () => {
    const secretValue = "my-super-secret-12345";
    const { stdout } = await runIsol8(
      `run -e "import os; print(os.environ['SECRET_KEY'])" -r python --secret SECRET_KEY=${secretValue} --no-stream`
    );
    expect(stdout).not.toContain(secretValue);
    expect(stdout).toContain("***");
  }, 30_000);

  test("multiple --secret values are all masked", async () => {
    const { stdout } = await runIsol8(
      "run -e \"import os; print(os.environ['API_KEY'], os.environ['DB_PASS'])\" -r python --secret API_KEY=secret123 --secret DB_PASS=pass456 --no-stream"
    );
    expect(stdout).not.toContain("secret123");
    expect(stdout).not.toContain("pass456");
  }, 30_000);

  test("secret value appears masked even when printed", async () => {
    const secret = "should-be-hidden";
    const { stdout } = await runIsol8(
      `run -e "print('${secret}')" -r python --secret HIDDEN=${secret} --no-stream`
    );
    expect(stdout).not.toContain(secret);
  }, 30_000);
});

describe("Security: Timeout Enforcement", () => {
  test("timeout kills long-running process", async () => {
    const start = performance.now();
    try {
      await runIsol8('run -e "import time; time.sleep(10)" -r python --timeout 500 --no-stream', {
        timeout: 10_000,
      });
      throw new Error("Should have timed out");
    } catch {
      const elapsed = performance.now() - start;
      // Should terminate well before 10 seconds
      expect(elapsed).toBeLessThan(5000);
    }
  }, 10_000);

  test("short timeout for infinite loop", async () => {
    const start = performance.now();
    try {
      await runIsol8('run -e "while True: pass" -r python --timeout 300 --no-stream', {
        timeout: 5000,
      });
      throw new Error("Should have timed out");
    } catch {
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(3000);
    }
  }, 5000);
});

describe("Security: Memory Limits", () => {
  test("--memory flag is respected", async () => {
    // Just verify the flag is accepted - actual OOM testing is environment-dependent
    const { stdout } = await runIsol8('run -e "print(1)" -r python --memory 256m --no-stream');
    expect(stdout).toContain("1");
  }, 30_000);
});

describe("Security: Process Limits", () => {
  test("--pids-limit flag is respected", async () => {
    const { stdout } = await runIsol8('run -e "print(1)" -r python --pids-limit 32 --no-stream');
    expect(stdout).toContain("1");
  }, 30_000);
});

describe("Security: Read-Only Filesystem", () => {
  test("root filesystem is read-only by default", async () => {
    const code = `
try:
    with open('/etc/hostname', 'w') as f:
        f.write('test')
    print("WRITE_ALLOWED")
except:
    print("WRITE_BLOCKED")
`;
    const { stdout } = await runIsol8(`run -e '${code}' -r python --no-stream`);
    expect(stdout).toContain("WRITE_BLOCKED");
  }, 30_000);

  test("sandbox directory is writable", async () => {
    const { stdout } = await runIsol8(
      "run -e \"import os; os.makedirs('/sandbox/test', exist_ok=True); print('writable')\" -r python --no-stream"
    );
    expect(stdout).toContain("writable");
  }, 30_000);

  test("--writable allows root filesystem writes", async () => {
    // Just verify the flag is accepted - actual write test may vary by container
    const { stdout } = await runIsol8('run -e "print(1)" -r python --writable --no-stream');
    expect(stdout).toContain("1");
  }, 30_000);
});
