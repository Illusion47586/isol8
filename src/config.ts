/**
 * @module config
 *
 * Configuration discovery and loading for isol8. Searches for `isol8.config.json`
 * in the working directory and then in `~/.isol8/config.json`, merging any found
 * config with built-in defaults.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { Isol8Config } from "./types";

/**
 * Built-in default configuration. Used as the base for all config merges.
 * All values here are the "safe defaults" — network disabled, conservative limits.
 */
const DEFAULT_CONFIG: Isol8Config = {
  maxConcurrent: 10,
  defaults: {
    timeoutMs: 30_000,
    memoryLimit: "512m",
    cpuLimit: 1.0,
    network: "none",
    sandboxSize: "512m",
    tmpSize: "256m",
  },
  network: {
    whitelist: [],
    blacklist: [],
  },
  cleanup: {
    autoPrune: true,
    maxContainerAgeMs: 3_600_000,
  },
  dependencies: {},
};

/**
 * Discovers and loads the isol8 configuration file.
 *
 * Search order (first match wins):
 * 1. `isol8.config.json` in CWD (or the provided `cwd` argument)
 * 2. `~/.isol8/config.json`
 *
 * If no config file is found, returns a copy of {@link DEFAULT_CONFIG}.
 * Partial configs are deep-merged with defaults — you only need to specify
 * the fields you want to override.
 *
 * @param cwd - Optional working directory to search from (defaults to `process.cwd()`).
 * @returns The resolved configuration.
 *
 * @example
 * ```typescript
 * const config = loadConfig();
 * console.log(config.defaults.timeoutMs); // 30000
 * ```
 */
export function loadConfig(cwd?: string): Isol8Config {
  const searchPaths = [
    join(resolve(cwd ?? process.cwd()), "isol8.config.json"),
    join(homedir(), ".isol8", "config.json"),
  ];

  for (const configPath of searchPaths) {
    if (existsSync(configPath)) {
      const raw = readFileSync(configPath, "utf-8");
      const parsed = JSON.parse(raw) as Partial<Isol8Config>;
      return mergeConfig(DEFAULT_CONFIG, parsed);
    }
  }

  return { ...DEFAULT_CONFIG };
}

/**
 * Deep-merges a partial config with defaults. Each top-level section is merged
 * independently so that specifying e.g. `{ defaults: { timeoutMs: 5000 } }`
 * preserves all other default values.
 */
function mergeConfig(defaults: Isol8Config, overrides: Partial<Isol8Config>): Isol8Config {
  return {
    maxConcurrent: overrides.maxConcurrent ?? defaults.maxConcurrent,
    defaults: {
      ...defaults.defaults,
      ...overrides.defaults,
    },
    network: {
      whitelist: overrides.network?.whitelist ?? defaults.network.whitelist,
      blacklist: overrides.network?.blacklist ?? defaults.network.blacklist,
    },
    cleanup: {
      ...defaults.cleanup,
      ...overrides.cleanup,
    },
    dependencies: {
      ...defaults.dependencies,
      ...overrides.dependencies,
    },
  };
}

export { DEFAULT_CONFIG };
