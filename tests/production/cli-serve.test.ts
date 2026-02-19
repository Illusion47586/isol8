/**
 * Production tests: CLI serve command
 * Tests: serve --help, API key validation, standalone binary download path
 */

import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempDir, createTempDir, getRandomPort, runIsol8, spawnIsol8 } from "./utils";

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

  test("serve --update downloads and launches standalone binary", async () => {
    const fakeHome = createTempDir("isol8-serve-home-");
    const binaryPath = join(fakeHome, ".isol8", "bin", "isol8-server");
    const port = getRandomPort();
    const proc = spawnIsol8(["serve", "--update", "--key", "test-key", "--port", String(port)], {
      env: { HOME: fakeHome },
    });
    let output = "";

    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`Timed out waiting for serve startup. Output:\n${output}`));
        }, 120_000);

        const onData = (chunk: Buffer) => {
          output += chunk.toString();
          if (output.includes(`listening on http://localhost:${port}`)) {
            clearTimeout(timeout);
            resolve();
          }
        };

        proc.stdout?.on("data", onData);
        proc.stderr?.on("data", onData);
        proc.on("error", (err) => {
          clearTimeout(timeout);
          reject(err);
        });
        proc.on("exit", (code, signal) => {
          clearTimeout(timeout);
          reject(
            new Error(`serve exited early (code=${code}, signal=${signal}). Output:\n${output}`)
          );
        });
      });

      expect(existsSync(binaryPath)).toBe(true);
    } finally {
      proc.kill("SIGTERM");
      cleanupTempDir(fakeHome);
    }
  }, 180_000);
});
