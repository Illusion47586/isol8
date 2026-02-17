/**
 * Production tests: CLI serve command
 * Tests: serve --help, API key validation
 */

import { describe, expect, test } from "bun:test";
import { runIsol8 } from "./utils";

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
});
