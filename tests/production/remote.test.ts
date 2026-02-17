/**
 * Production tests: Remote execution via --host
 * Tests: RemoteIsol8 client, --host and --key flags
 */

import { describe, expect, test } from "bun:test";
import { runIsol8 } from "./utils";

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
});
