/**
 * Production tests: Remote execution via --host
 * Tests: RemoteIsol8 client, --host and --key flags
 */

import { describe, expect, test } from "bun:test";
import { getRandomPort, runIsol8, spawnIsol8, waitForServer } from "./utils";

describe("Remote Execution", () => {
  test("--host without --key or ISOL8_API_KEY exits with error", async () => {
    try {
      await runIsol8('run -e "print(1)" --host http://localhost:9999 --no-stream', {
        env: { ISOL8_API_KEY: "" },
      });
      throw new Error("Should have failed");
    } catch (err: any) {
      expect(err.code).toBe(1);
      expect(err.stderr).toContain("API key required");
    }
  });

  test("remote execution via local server", async () => {
    const port = getRandomPort();
    const apiKey = "remote-test-key";

    // Start local server
    const serverProc = spawnIsol8(["serve", "--port", String(port), "--key", apiKey]);

    try {
      // Wait for server to be ready
      const ready = await waitForServer(port, 10_000);
      expect(ready).toBe(true);

      // Execute remotely
      const { stdout } = await runIsol8(
        `run -e "print('remote-execution-works')" -r python --host http://localhost:${port} --key ${apiKey} --no-stream`
      );
      expect(stdout).toContain("remote-execution-works");
    } finally {
      serverProc.kill("SIGTERM");
      await new Promise((resolve) => {
        serverProc.on("exit", resolve);
        setTimeout(resolve, 3000);
      });
    }
  }, 30_000);

  test("remote execution with wrong key fails", async () => {
    const port = getRandomPort();
    const apiKey = "correct-key";

    // Start local server
    const serverProc = spawnIsol8(["serve", "--port", String(port), "--key", apiKey]);

    try {
      const ready = await waitForServer(port, 10_000);
      expect(ready).toBe(true);

      // Execute with wrong key
      try {
        await runIsol8(
          `run -e "print(1)" -r python --host http://localhost:${port} --key wrong-key --no-stream`
        );
        throw new Error("Should have failed");
      } catch (err: any) {
        expect(err.code).not.toBe(0);
      }
    } finally {
      serverProc.kill("SIGTERM");
      await new Promise((resolve) => {
        serverProc.on("exit", resolve);
        setTimeout(resolve, 3000);
      });
    }
  }, 30_000);
});
