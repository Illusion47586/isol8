/**
 * Production tests: CLI cleanup command
 * Tests: cleanup, --force flag, container removal
 */

import { describe, expect, test } from "bun:test";
import { runIsol8 } from "./utils";

describe("CLI Cleanup", () => {
  test("cleanup --force runs without error", async () => {
    const { stdout, stderr } = await runIsol8("cleanup --force");
    const combined = stdout + stderr;
    expect(combined).toMatch(/removed|No isol8 containers found|Found/);
  }, 60_000);

  test("cleanup --help lists flags", async () => {
    const { stdout } = await runIsol8("cleanup --help");
    expect(stdout).toContain("--force");
    expect(stdout).toContain("--images");
  });
});
