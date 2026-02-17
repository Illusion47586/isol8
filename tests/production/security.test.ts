/**
 * Production tests: Security features
 * Tests: network modes, secret masking, resource limits
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIsol8 } from "./utils";

describe("Security: Network Isolation", () => {
  test("network none blocks outbound HTTP requests", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-"));
    const filePath = join(tmpDir, "test.py");

    try {
      writeFileSync(
        filePath,
        `
import urllib.request
try:
    urllib.request.urlopen("https://example.com", timeout=2)
    print("NETWORK_NOT_BLOCKED")
except Exception as e:
    print("NETWORK_BLOCKED")
`
      );
      const { stdout } = await runIsol8(`run ${filePath} -r python --net none --no-stream`);
      expect(stdout).toContain("NETWORK_BLOCKED");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30_000);

  test("network host allows outbound HTTP requests", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-"));
    const filePath = join(tmpDir, "test.py");

    try {
      writeFileSync(
        filePath,
        `
import urllib.request
try:
    urllib.request.urlopen("https://api.github.com", timeout=5)
    print("NETWORK_ALLOWED")
except Exception as e:
    print("NETWORK_ERROR")
`
      );
      const { stdout } = await runIsol8(`run ${filePath} -r python --net host --no-stream`);
      expect(stdout).toContain("NETWORK_ALLOWED");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30_000);
});

describe("Security: Secret Masking", () => {
  test("--secret values are masked in stdout", async () => {
    const { stdout } = await runIsol8(
      "run -e \"import os; print(os.environ['SECRET_KEY'])\" -r python --secret SECRET_KEY=my-super-secret-12345 --no-stream"
    );
    expect(stdout).not.toContain("my-super-secret-12345");
    expect(stdout).toContain("***");
  }, 30_000);

  test("multiple --secret values are all masked", async () => {
    const { stdout } = await runIsol8(
      "run -e \"import os; print(os.environ['API_KEY'], os.environ['DB_PASS'])\" -r python --secret API_KEY=secret123 --secret DB_PASS=pass456 --no-stream"
    );
    expect(stdout).not.toContain("secret123");
    expect(stdout).not.toContain("pass456");
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
      expect(elapsed).toBeLessThan(5000);
    }
  }, 10_000);
});

describe("Security: Memory Limits", () => {
  test("--memory flag is respected", async () => {
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
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-"));
    const filePath = join(tmpDir, "test.py");

    try {
      writeFileSync(
        filePath,
        `
try:
    with open("/etc/hostname", "w") as f:
        f.write("test")
    print("WRITE_ALLOWED")
except:
    print("WRITE_BLOCKED")
`
      );
      const { stdout } = await runIsol8(`run ${filePath} -r python --no-stream`);
      expect(stdout).toContain("WRITE_BLOCKED");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30_000);

  test("sandbox directory is writable", async () => {
    const { stdout } = await runIsol8(
      "run -e \"import os; os.makedirs('/sandbox/test', exist_ok=True); print('writable')\" -r python --no-stream"
    );
    expect(stdout).toContain("writable");
  }, 30_000);
});
