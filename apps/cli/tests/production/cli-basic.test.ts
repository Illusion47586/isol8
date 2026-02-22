/**
 * Production tests: CLI basic commands
 * Tests: --version, --help, no args, unknown commands
 */

import { describe, expect, test } from "bun:test";
import { runIsol8 } from "./utils";

describe("CLI Basic", () => {
  test("--version prints semver", async () => {
    const { stdout } = await runIsol8("--version");
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("--help prints usage", async () => {
    const { stdout } = await runIsol8("--help");
    expect(stdout).toContain("isol8");
    expect(stdout).toContain("setup");
    expect(stdout).toContain("run");
    expect(stdout).toContain("serve");
    expect(stdout).toContain("config");
    expect(stdout).toContain("cleanup");
  });

  test("no args prints help and exits 0", async () => {
    const { stdout } = await runIsol8("");
    expect(stdout).toContain("isol8");
    expect(stdout).toContain("Commands:");
  });

  test("unknown command exits with error", async () => {
    try {
      await runIsol8("unknown-command");
      throw new Error("Should have failed");
    } catch (err: any) {
      expect(err.code).not.toBe(0);
      expect(err.stderr).toContain("unknown");
    }
  });
});
