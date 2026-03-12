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
import type { Isol8Config, Isol8UserConfig, PrebuiltImageConfig, Runtime } from "./types";

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
    readonlyRootFs: true,
  },
  network: {
    whitelist: [],
    blacklist: [],
  },
  cleanup: {
    autoPrune: true,
    maxContainerAgeMs: 3_600_000,
  },
  poolStrategy: "fast",
  poolSize: { clean: 1, dirty: 1 },

  security: {
    seccomp: "strict",
  },
  remoteCode: {
    enabled: false,
    allowedSchemes: ["https"],
    allowedHosts: [],
    blockedHosts: [
      "^localhost$",
      "^127(?:\\.[0-9]{1,3}){3}$",
      "^\\[::1\\]$",
      "^::1$",
      "^10(?:\\.[0-9]{1,3}){3}$",
      "^172\\.(?:1[6-9]|2[0-9]|3[0-1])(?:\\.[0-9]{1,3}){2}$",
      "^192\\.168(?:\\.[0-9]{1,3}){2}$",
      "^169\\.254(?:\\.[0-9]{1,3}){2}$",
      "^metadata\\.google\\.internal$",
      "^169\\.254\\.169\\.254$",
    ],
    maxCodeSize: 10 * 1024 * 1024,
    fetchTimeoutMs: 30_000,
    requireHash: false,
    enableCache: true,
    cacheTtl: 3600,
  },
  audit: {
    enabled: false,
    destination: "filesystem",
    logDir: undefined,
    postLogScript: undefined,
    trackResources: true,
    retentionDays: 90,
    includeCode: false,
    includeOutput: false,
  },
  auth: {
    enabled: false,
    defaultTtlMs: 86_400_000, // 24 hours
    cleanupIntervalMs: 3_600_000, // 1 hour
  },
  prebuiltImages: [],
  debug: false,
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
      const parsed = JSON.parse(raw) as Partial<Isol8UserConfig>;
      return mergeConfig(DEFAULT_CONFIG, parsed);
    }
  }

  return { ...DEFAULT_CONFIG };
}

/**
 * Expands the `dependencies` shorthand into `prebuiltImages` entries.
 *
 * `{ dependencies: { python: ["numpy"] } }` expands to:
 * `[{ tag: "isol8:python-custom", runtime: "python", installPackages: ["numpy"] }]`
 */
function expandDependencies(
  deps: Partial<Record<Runtime, string[]>> | undefined
): PrebuiltImageConfig[] {
  if (!deps) {
    return [];
  }
  return (Object.entries(deps) as [Runtime, string[]][]).map(([runtime, packages]) => ({
    tag: `isol8:${runtime}-custom`,
    runtime,
    installPackages: packages,
  }));
}

/**
 * Deep-merges a partial config with defaults. Each top-level section is merged
 * independently so that specifying e.g. `{ defaults: { timeoutMs: 5000 } }`
 * preserves all other default values.
 *
 * The `dependencies` shorthand field (from `Isol8UserConfig`) is expanded into
 * `prebuiltImages` entries and appended after any explicit `prebuiltImages`.
 */
function mergeConfig(defaults: Isol8Config, overrides: Partial<Isol8UserConfig>): Isol8Config {
  const explicitPrebuilt = overrides.prebuiltImages ?? defaults.prebuiltImages;
  const fromDeps = expandDependencies(overrides.dependencies);
  const prebuiltImages =
    fromDeps.length > 0 ? [...explicitPrebuilt, ...fromDeps] : explicitPrebuilt;

  return {
    maxConcurrent: overrides.maxConcurrent ?? defaults.maxConcurrent,
    defaults: {
      ...defaults.defaults,
      ...overrides.defaults,
      readonlyRootFs: overrides.defaults?.readonlyRootFs ?? defaults.defaults.readonlyRootFs,
    },
    network: {
      whitelist: overrides.network?.whitelist ?? defaults.network.whitelist,
      blacklist: overrides.network?.blacklist ?? defaults.network.blacklist,
    },
    cleanup: {
      ...defaults.cleanup,
      ...overrides.cleanup,
    },
    poolStrategy: overrides.poolStrategy ?? defaults.poolStrategy,
    poolSize: overrides.poolSize ?? defaults.poolSize,
    security: {
      seccomp: overrides.security?.seccomp ?? defaults.security.seccomp,
      customProfilePath:
        overrides.security?.customProfilePath ?? defaults.security.customProfilePath,
    },
    remoteCode: {
      ...defaults.remoteCode,
      ...overrides.remoteCode,
      allowedSchemes: overrides.remoteCode?.allowedSchemes ?? defaults.remoteCode.allowedSchemes,
      allowedHosts: overrides.remoteCode?.allowedHosts ?? defaults.remoteCode.allowedHosts,
      blockedHosts: overrides.remoteCode?.blockedHosts ?? defaults.remoteCode.blockedHosts,
    },
    audit: {
      ...defaults.audit,
      ...overrides.audit,
    },
    auth: {
      ...defaults.auth,
      ...overrides.auth,
    },
    prebuiltImages,
    debug: overrides.debug ?? defaults.debug,
  };
}

export { DEFAULT_CONFIG };
