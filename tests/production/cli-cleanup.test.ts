/**
 * Production tests: CLI cleanup command
 * Tests: cleanup, --force flag, container removal
 */

import { describe, expect, test } from "bun:test";
import { runIsol8 } from "./utils";

describe("CLI Cleanup", () => {
  test("cleanup --force removes isol8 containers", async () => {
    // First, run something to create a container
    await runIsol8('run -e "print(1)" -r python --no-stream');

    // Then cleanup
    const { stdout } = await runIsol8("cleanup --force");
    // Should either find and remove containers or report none found
    expect(stdout).toMatch(/removed|No isol8 containers found/);
  }, 60_000);

  test("cleanup --help lists flags", async () => {
    const { stdout } = await runIsol8("cleanup --help");
    expect(stdout).toContain("--force");
  });
});
