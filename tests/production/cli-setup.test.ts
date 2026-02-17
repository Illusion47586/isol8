/**
 * Production tests: CLI setup command
 * Tests: setup, setup with packages for all runtimes
 */

import { describe, expect, test } from "bun:test";
import { runIsol8 } from "./utils";

describe("CLI Setup", () => {
  test("setup completes successfully", async () => {
    const { stdout } = await runIsol8("setup", { timeout: 300_000 });
    expect(stdout).toContain("Setup complete");
  }, 300_000);

  test("setup --help lists package flags", async () => {
    const { stdout } = await runIsol8("setup --help");
    expect(stdout).toContain("--python");
    expect(stdout).toContain("--node");
    expect(stdout).toContain("--bun");
    expect(stdout).toContain("--deno");
    expect(stdout).toContain("--bash");
  });
});
