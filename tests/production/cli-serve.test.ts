/**
 * Production tests: CLI serve command and server binary
 * Tests: serve startup, auth, health endpoint, binary download
 */

import { describe, expect, test } from "bun:test";
import { getRandomPort, runIsol8, spawnIsol8, waitForServer } from "./utils";

describe("CLI Serve", () => {
  test("serve without --key or ISOL8_API_KEY exits with error", async () => {
    try {
      await runIsol8("serve", { env: { ISOL8_API_KEY: "" } });
      throw new Error("Should have failed");
    } catch (err: any) {
      expect(err.code).toBe(1);
      expect(err.stderr).toContain("API key required");
    }
  });

  test("serve --help lists all flags", async () => {
    const { stdout } = await runIsol8("serve --help");
    expect(stdout).toContain("--port");
    expect(stdout).toContain("--key");
    expect(stdout).toContain("--update");
    expect(stdout).toContain("--debug");
  });

  test("serve starts server with API key via flag", async () => {
    const port = getRandomPort();
    const apiKey = "test-key-123";

    const proc = spawnIsol8(["serve", "--port", String(port), "--key", apiKey]);

    try {
      const ready = await waitForServer(port, 10_000);
      expect(ready).toBe(true);

      // Test health endpoint (no auth required)
      const healthRes = await fetch(`http://localhost:${port}/health`);
      expect(healthRes.status).toBe(200);
      const health = (await healthRes.json()) as { status: string; version: string };
      expect(health.status).toBe("ok");
      expect(health.version).toMatch(/^\d+\.\d+\.\d+/);
    } finally {
      proc.kill("SIGTERM");
      await new Promise((resolve) => {
        proc.on("exit", resolve);
        setTimeout(resolve, 3000);
      });
    }
  }, 20_000);

  test("serve starts server with API key via env var", async () => {
    const port = getRandomPort();
    const apiKey = "env-key-456";

    const proc = spawnIsol8(["serve", "--port", String(port)], {
      env: { ISOL8_API_KEY: apiKey },
    });

    try {
      const ready = await waitForServer(port, 10_000);
      expect(ready).toBe(true);
    } finally {
      proc.kill("SIGTERM");
      await new Promise((resolve) => {
        proc.on("exit", resolve);
        setTimeout(resolve, 3000);
      });
    }
  }, 20_000);

  test("serve requires auth for /execute endpoint", async () => {
    const port = getRandomPort();
    const apiKey = "auth-test-key";

    const proc = spawnIsol8(["serve", "--port", String(port), "--key", apiKey]);

    try {
      const ready = await waitForServer(port, 10_000);
      expect(ready).toBe(true);

      // No auth header - should be 401
      const res = await fetch(`http://localhost:${port}/execute`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: "print(1)", runtime: "python" }),
      });
      expect(res.status).toBe(401);
    } finally {
      proc.kill("SIGTERM");
      await new Promise((resolve) => {
        proc.on("exit", resolve);
        setTimeout(resolve, 3000);
      });
    }
  }, 20_000);

  test("serve accepts valid auth for /execute", async () => {
    const port = getRandomPort();
    const apiKey = "valid-auth-key";

    const proc = spawnIsol8(["serve", "--port", String(port), "--key", apiKey]);

    try {
      const ready = await waitForServer(port, 10_000);
      expect(ready).toBe(true);

      // Valid auth - should not be 401/403 (may be 500 if Docker issue, but that's OK)
      const res = await fetch(`http://localhost:${port}/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({ code: "print(1)", runtime: "python" }),
      });
      expect(res.status).not.toBe(401);
      expect(res.status).not.toBe(403);
    } finally {
      proc.kill("SIGTERM");
      await new Promise((resolve) => {
        proc.on("exit", resolve);
        setTimeout(resolve, 3000);
      });
    }
  }, 20_000);

  test("serve rejects wrong auth token", async () => {
    const port = getRandomPort();
    const apiKey = "correct-key";

    const proc = spawnIsol8(["serve", "--port", String(port), "--key", apiKey]);

    try {
      const ready = await waitForServer(port, 10_000);
      expect(ready).toBe(true);

      // Wrong auth token - should be 403
      const res = await fetch(`http://localhost:${port}/execute`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer wrong-key",
        },
        body: JSON.stringify({ code: "print(1)", runtime: "python" }),
      });
      expect(res.status).toBe(403);
    } finally {
      proc.kill("SIGTERM");
      await new Promise((resolve) => {
        proc.on("exit", resolve);
        setTimeout(resolve, 3000);
      });
    }
  }, 20_000);
});
