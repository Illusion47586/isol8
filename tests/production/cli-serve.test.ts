/**
 * Production tests: CLI serve command
 * Tests: serve --help, API key validation, standalone binary launch path
 */

import { describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { cleanupTempDir, createTempDir, runIsol8 } from "./utils";

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

  test("serve uses existing standalone binary when version matches", async () => {
    const { stdout: versionOutput } = await runIsol8("--version");
    const version = versionOutput.trim();
    const fakeHome = createTempDir("isol8-serve-home-");
    const binDir = join(fakeHome, ".isol8", "bin");
    const binaryPath = join(binDir, "isol8-server");

    mkdirSync(binDir, { recursive: true });
    writeFileSync(
      binaryPath,
      `#!/usr/bin/env bash
if [ "$1" = "--version" ]; then
  echo "${version}"
  exit 0
fi
echo "FAKE_SERVER_STARTED $*" >&2
exit 0
`,
      "utf-8"
    );
    chmodSync(binaryPath, 0o755);

    try {
      const { stderr } = await runIsol8("serve --key test-key --port 30123", {
        env: { HOME: fakeHome },
        timeout: 10_000,
      });
      expect(stderr).toContain("FAKE_SERVER_STARTED --port 30123 --key test-key");
    } finally {
      cleanupTempDir(fakeHome);
    }
  }, 30_000);
});
