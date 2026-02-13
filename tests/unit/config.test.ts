import { describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CONFIG, loadConfig } from "../../src/config";

describe("loadConfig", () => {
  const tmpDir = join(tmpdir(), `isol8-test-${Date.now()}`);

  test("returns defaults when no config file exists", () => {
    const config = loadConfig("/nonexistent/path");
    expect(config.maxConcurrent).toBe(DEFAULT_CONFIG.maxConcurrent);
    expect(config.defaults.timeoutMs).toBe(30_000);
    expect(config.defaults.network).toBe("none");
    expect(config.defaults.memoryLimit).toBe("512m");
  });

  test("loads config from CWD", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "isol8.config.json"),
      JSON.stringify({
        maxConcurrent: 5,
        defaults: { timeoutMs: 10_000 },
      })
    );

    const config = loadConfig(tmpDir);
    expect(config.maxConcurrent).toBe(5);
    expect(config.defaults.timeoutMs).toBe(10_000);
    // Non-specified fields should retain defaults
    expect(config.defaults.memoryLimit).toBe("512m");
    expect(config.defaults.network).toBe("none");

    rmSync(tmpDir, { recursive: true });
  });

  test("merges dependencies from config", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "isol8.config.json"),
      JSON.stringify({
        dependencies: {
          python: ["numpy", "pandas"],
          node: ["lodash"],
        },
      })
    );

    const config = loadConfig(tmpDir);
    expect(config.dependencies.python).toEqual(["numpy", "pandas"]);
    expect(config.dependencies.node).toEqual(["lodash"]);

    rmSync(tmpDir, { recursive: true });
  });
});
