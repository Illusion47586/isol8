/**
 * Production tests: CLI config command
 * Tests: config resolution, --json flag, all config fields
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIsol8 } from "./utils";

describe("CLI Config", () => {
  test("config prints human-readable output with defaults", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-test-"));

    try {
      const { stdout } = await runIsol8("config", { cwd: tmpDir });
      expect(stdout).toContain("Isol8 Configuration");
      expect(stdout).toContain("defaults");
      expect(stdout).toContain("30000");
      expect(stdout).toContain("512m");
      expect(stdout).toContain("none");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("config --json outputs valid JSON with all default fields", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-test-"));

    try {
      const { stdout } = await runIsol8("config --json", { cwd: tmpDir });
      const config = JSON.parse(stdout);

      // Verify all top-level fields
      expect(config.maxConcurrent).toBe(10);
      expect(config.debug).toBe(false);

      // Defaults
      expect(config.defaults.timeoutMs).toBe(30_000);
      expect(config.defaults.memoryLimit).toBe("512m");
      expect(config.defaults.cpuLimit).toBe(1);
      expect(config.defaults.network).toBe("none");
      expect(config.defaults.sandboxSize).toBe("512m");
      expect(config.defaults.tmpSize).toBe("256m");

      // Network
      expect(config.network.whitelist).toEqual([]);
      expect(config.network.blacklist).toEqual([]);

      // Cleanup
      expect(config.cleanup.autoPrune).toBe(true);
      expect(config.cleanup.maxContainerAgeMs).toBe(3_600_000);

      // Dependencies
      expect(config.dependencies).toBeDefined();
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("config merges CWD config file with defaults", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-test-"));

    try {
      writeFileSync(
        join(tmpDir, "isol8.config.json"),
        JSON.stringify({
          defaults: { timeoutMs: 60_000, memoryLimit: "1g" },
        })
      );

      const { stdout } = await runIsol8("config --json", { cwd: tmpDir });
      const config = JSON.parse(stdout);

      // Overridden values
      expect(config.defaults.timeoutMs).toBe(60_000);
      expect(config.defaults.memoryLimit).toBe("1g");

      // Preserved defaults
      expect(config.defaults.cpuLimit).toBe(1);
      expect(config.defaults.network).toBe("none");
      expect(config.defaults.sandboxSize).toBe("512m");
      expect(config.defaults.tmpSize).toBe("256m");
      expect(config.maxConcurrent).toBe(10);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("config reflects custom dependencies", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-test-"));

    try {
      writeFileSync(
        join(tmpDir, "isol8.config.json"),
        JSON.stringify({
          dependencies: { python: ["numpy", "pandas"], node: ["lodash"] },
        })
      );

      const { stdout } = await runIsol8("config --json", { cwd: tmpDir });
      const config = JSON.parse(stdout);

      expect(config.dependencies.python).toEqual(["numpy", "pandas"]);
      expect(config.dependencies.node).toEqual(["lodash"]);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("config reflects custom network filter", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-test-"));

    try {
      writeFileSync(
        join(tmpDir, "isol8.config.json"),
        JSON.stringify({
          network: { whitelist: ["api\\.openai\\.com"], blacklist: ["evil\\.com"] },
        })
      );

      const { stdout } = await runIsol8("config --json", { cwd: tmpDir });
      const config = JSON.parse(stdout);

      expect(config.network.whitelist).toEqual(["api\\.openai\\.com"]);
      expect(config.network.blacklist).toEqual(["evil\\.com"]);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("config reflects custom cleanup settings", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-test-"));

    try {
      writeFileSync(
        join(tmpDir, "isol8.config.json"),
        JSON.stringify({
          cleanup: { autoPrune: false, maxContainerAgeMs: 7_200_000 },
        })
      );

      const { stdout } = await runIsol8("config --json", { cwd: tmpDir });
      const config = JSON.parse(stdout);

      expect(config.cleanup.autoPrune).toBe(false);
      expect(config.cleanup.maxContainerAgeMs).toBe(7_200_000);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("config reflects debug: true", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-test-"));

    try {
      writeFileSync(join(tmpDir, "isol8.config.json"), JSON.stringify({ debug: true }));

      const { stdout } = await runIsol8("config --json", { cwd: tmpDir });
      const config = JSON.parse(stdout);
      expect(config.debug).toBe(true);
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("config shows source as defaults when no config file", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-test-"));

    try {
      const { stdout } = await runIsol8("config", { cwd: tmpDir });
      expect(stdout).toContain("defaults");
      expect(stdout).toContain("no config file");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });

  test("config shows config file source when present", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-test-"));

    try {
      writeFileSync(join(tmpDir, "isol8.config.json"), JSON.stringify({ maxConcurrent: 5 }));

      const { stdout } = await runIsol8("config", { cwd: tmpDir });
      expect(stdout).toContain("isol8.config.json");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  });
});
