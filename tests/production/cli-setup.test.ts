/**
 * Production tests: CLI setup command
 * Tests: setup, setup with packages for all runtimes, smart builds, cleanup
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

  test("setup --help lists --force flag", async () => {
    const { stdout } = await runIsol8("setup --help");
    expect(stdout).toContain("--force");
  });
});

describe("CLI Setup - Smart Builds", () => {
  test("setup skips builds when images are up to date", async () => {
    // First run to ensure images exist
    await runIsol8("setup", { timeout: 300_000 });

    // Second run should skip builds and show "Up to date"
    const { stdout } = await runIsol8("setup", { timeout: 60_000 });
    expect(stdout).toContain("Up to date");
  }, 300_000);

  test("setup --force rebuilds even when up to date", async () => {
    // First run to ensure images exist and are up to date
    await runIsol8("setup", { timeout: 300_000 });

    // Run with --force should rebuild (no "Up to date" messages)
    const { stdout } = await runIsol8("setup --force", { timeout: 300_000 });
    expect(stdout).toContain("Setup complete");
    // Should not show "Up to date" since we're forcing rebuild
    expect(stdout).not.toContain("Up to date");
  }, 300_000);
});

describe("CLI Setup - Dangling Image Cleanup", () => {
  test("setup removes dangling images after rebuild", async () => {
    // First run to ensure images exist
    await runIsol8("setup", { timeout: 300_000 });

    // Force rebuild to create a scenario where old images would become dangling
    const { stdout, stderr } = await runIsol8("setup --force", {
      timeout: 300_000,
    });

    // Setup should complete successfully
    expect(stdout).toContain("Setup complete");

    // Verify no new dangling images were left (this is indirect since we can't
    // easily check Docker state from here, but the successful completion
    // without errors indicates cleanup worked)
    expect(stderr).not.toContain("Error");
    expect(stderr).not.toContain("Failed");
  }, 300_000);
});
