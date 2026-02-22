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
    expect(config.remoteCode.enabled).toBe(false);
    expect(config.remoteCode.allowedSchemes).toEqual(["https"]);
    expect(config.poolStrategy).toBe("fast");
    expect(config.poolSize).toEqual({ clean: 1, dirty: 1 });
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

  test("cleanup.autoPrune defaults to true", () => {
    const config = loadConfig("/nonexistent/path");
    expect(config.cleanup.autoPrune).toBe(true);
  });

  test("debug defaults to false", () => {
    const config = loadConfig("/nonexistent/path");
    expect(config.debug).toBe(false);
  });

  test("merging preserves cleanup.autoPrune and debug when not overridden", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "isol8.config.json"), JSON.stringify({ maxConcurrent: 3 }));

    const config = loadConfig(tmpDir);
    expect(config.maxConcurrent).toBe(3);
    // These should retain their defaults
    expect(config.cleanup.autoPrune).toBe(true);
    expect(config.debug).toBe(false);

    rmSync(tmpDir, { recursive: true });
  });

  test("cleanup.autoPrune can be overridden to false", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "isol8.config.json"),
      JSON.stringify({ cleanup: { autoPrune: false } })
    );

    const config = loadConfig(tmpDir);
    expect(config.cleanup.autoPrune).toBe(false);
    // maxContainerAgeMs should retain its default
    expect(config.cleanup.maxContainerAgeMs).toBe(3_600_000);

    rmSync(tmpDir, { recursive: true });
  });

  test("debug can be overridden to true", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(join(tmpDir, "isol8.config.json"), JSON.stringify({ debug: true }));

    const config = loadConfig(tmpDir);
    expect(config.debug).toBe(true);

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

  test("merges remoteCode policy from config", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "isol8.config.json"),
      JSON.stringify({
        remoteCode: {
          enabled: true,
          allowedHosts: ["^raw\\.githubusercontent\\.com$"],
          requireHash: true,
        },
      })
    );

    const config = loadConfig(tmpDir);
    expect(config.remoteCode.enabled).toBe(true);
    expect(config.remoteCode.allowedSchemes).toEqual(["https"]);
    expect(config.remoteCode.allowedHosts).toEqual(["^raw\\.githubusercontent\\.com$"]);
    expect(config.remoteCode.requireHash).toBe(true);

    rmSync(tmpDir, { recursive: true });
  });

  test("merges pool defaults from config", () => {
    mkdirSync(tmpDir, { recursive: true });
    writeFileSync(
      join(tmpDir, "isol8.config.json"),
      JSON.stringify({
        poolStrategy: "secure",
        poolSize: 3,
      })
    );

    const config = loadConfig(tmpDir);
    expect(config.poolStrategy).toBe("secure");
    expect(config.poolSize).toBe(3);

    rmSync(tmpDir, { recursive: true });
  });
});
