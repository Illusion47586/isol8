/**
 * @module types
 *
 * Core type definitions for isol8. All public interfaces used by
 * the library, CLI, server, and client are defined here.
 */

// ─── Execution ───

/**
 * Supported code execution runtimes.
 *
 * - `"python"` — CPython 3.x
 * - `"node"` — Node.js LTS
 * - `"bun"` — Bun runtime
 * - `"deno"` — Deno runtime
 * - `"bash"` — Bash shell
 */
export type Runtime = "python" | "node" | "bun" | "deno" | "bash";

/**
 * Network access mode for isol8 containers.
 *
 * - `"none"` — All network access blocked (default, most secure).
 * - `"host"` — Full host network access (use with caution).
 * - `"filtered"` — HTTP/HTTPS traffic routed through a proxy that enforces
 *   whitelist/blacklist regex rules on hostnames.
 */
export type NetworkMode = "none" | "host" | "filtered";

/**
 * A request to execute code inside isol8.
 */
export interface ExecutionRequest {
  /** Source code to execute. */
  code: string;

  /** Target runtime. Must match a registered {@link RuntimeAdapter}. */
  runtime: Runtime;

  /**
   * Execution timeout in milliseconds. Overrides the default.
   * The container is killed if this limit is exceeded.
   */
  timeoutMs?: number;

  /**
   * Additional environment variables injected into the container.
   * Keys matching secret names will be masked in output.
   */
  env?: Record<string, string>;
}

/**
 * The result of a code execution.
 */
export interface ExecutionResult {
  /** Captured standard output (may be truncated). */
  stdout: string;

  /** Captured standard error. */
  stderr: string;

  /** Process exit code. `0` indicates success. */
  exitCode: number;

  /** Wall-clock execution time in milliseconds. */
  durationMs: number;

  /** `true` if stdout was truncated due to exceeding {@link Isol8Options.maxOutputSize}. */
  truncated: boolean;
}

// ─── Isol8 ───

/**
 * Isol8 lifecycle mode.
 *
 * - `"ephemeral"` — A new container is created and destroyed for each `execute()` call.
 * - `"persistent"` — A single long-lived container is reused across `execute()` calls,
 *   preserving filesystem state between runs.
 */
export type Isol8Mode = "ephemeral" | "persistent";

/**
 * Options for configuring an isol8 instance.
 */
export interface Isol8Options {
  /** Lifecycle mode. @default "ephemeral" */
  mode?: Isol8Mode;

  /** Default runtime for executions. Can be overridden per-request. */
  runtime?: Runtime;

  /** Network access mode. @default "none" */
  network?: NetworkMode;

  /** Hostname-based network filtering rules (only used when `network` is `"filtered"`). */
  networkFilter?: NetworkFilterConfig;

  /** CPU limit as a fraction of one core (e.g. `0.5` = half a core). @default 1.0 */
  cpuLimit?: number;

  /** Memory limit string (e.g. `"512m"`, `"1g"`). @default "512m" */
  memoryLimit?: string;

  /** Maximum number of processes allowed inside the container. @default 64 */
  pidsLimit?: number;

  /** Mount the root filesystem as read-only. @default true */
  readonlyRootFs?: boolean;

  /** Maximum output size in bytes before truncation. @default 1048576 (1MB) */
  maxOutputSize?: number;

  /**
   * Secret values to pass as environment variables. Their values are automatically
   * masked (replaced with `***`) in stdout/stderr output.
   */
  secrets?: Record<string, string>;

  /** Default execution timeout in milliseconds. @default 30000 */
  timeoutMs?: number;

  /** Override the Docker image (ignores runtime adapter image). */
  image?: string;
}

/**
 * The core isol8 engine abstraction. Both {@link DockerIsol8} and {@link RemoteIsol8}
 * implement this interface.
 */
export interface Isol8Engine {
  /** Initialize the engine. Must be called before `execute()`. */
  start(): Promise<void>;

  /** Tear down the engine, stopping and removing any containers. */
  stop(): Promise<void>;

  /** Execute code and return the result. */
  execute(req: ExecutionRequest): Promise<ExecutionResult>;

  /**
   * Upload a file into the container.
   * Only available in persistent mode after at least one `execute()` call.
   *
   * @param path - Absolute path inside the container (e.g. `/sandbox/data.csv`).
   * @param content - File contents as a string or Buffer.
   */
  putFile(path: string, content: Buffer | string): Promise<void>;

  /**
   * Download a file from the container.
   * Only available in persistent mode.
   *
   * @param path - Absolute path inside the container.
   * @returns File contents as a Buffer.
   */
  getFile(path: string): Promise<Buffer>;
}

// ─── Network ───

/**
 * Hostname-based network filter configuration for `"filtered"` network mode.
 *
 * Patterns are ECMAScript regular expressions matched against the hostname
 * of outgoing HTTP/HTTPS requests.
 *
 * Evaluation order: blacklist is checked first — matching hosts are always denied.
 * If a whitelist is provided, only matching hosts are permitted.
 */
export interface NetworkFilterConfig {
  /** Regex patterns for allowed hostnames. If non-empty, only matching hosts are allowed. */
  whitelist: string[];

  /** Regex patterns for blocked hostnames. Matching hosts are always denied, even if whitelisted. */
  blacklist: string[];
}

// ─── Configuration ───

/** Configuration for default execution settings. */
export interface Isol8Defaults {
  /** Default timeout in milliseconds. @default 30000 */
  timeoutMs: number;
  /** Default memory limit. @default "512m" */
  memoryLimit: string;
  /** Default CPU limit (1.0 = one full core). @default 1.0 */
  cpuLimit: number;
  /** Default network mode. @default "none" */
  network: NetworkMode;
}

/** Configuration for container cleanup and lifecycle. */
export interface Isol8Cleanup {
  /** Automatically prune idle persistent containers. @default true */
  autoPrune: boolean;
  /** Maximum idle time (ms) before pruning. One hour = 3600000. @default 3600000 */
  maxContainerAgeMs: number;
}

/**
 * Runtime-specific packages to bake into custom Docker images.
 * Populated via `isol8.config.json` or CLI flags on `isol8 setup`.
 */
export interface Isol8Dependencies {
  /** Python packages to install via pip. */
  python?: string[];
  /** Node.js packages to install globally via npm. */
  node?: string[];
  /** Bun packages to install globally. */
  bun?: string[];
  /** Deno module URLs to pre-cache. */
  deno?: string[];
  /** Bash packages to install via apk (Alpine). */
  bash?: string[];
}

/**
 * Top-level configuration schema for isol8.
 *
 * Loaded from `isol8.config.json` in the working directory or `~/.isol8/config.json`.
 * Partial configs are deep-merged with built-in defaults.
 *
 * @see {@link loadConfig} for the loading/merge logic.
 * @see `schema/isol8.config.schema.json` for the JSON Schema.
 */
export interface Isol8Config {
  /** Maximum number of containers that can run concurrently. @default 10 */
  maxConcurrent: number;

  /** Default execution settings applied to all runs. */
  defaults: Isol8Defaults;

  /** Global network filtering rules for `"filtered"` mode. */
  network: NetworkFilterConfig;

  /** Container cleanup and lifecycle settings. */
  cleanup: Isol8Cleanup;

  /** Runtime-specific packages to bake into custom Docker images. */
  dependencies: Isol8Dependencies;
}

/**
 * User configuration file schema (partial/optional version of Isol8Config).
 * Used for generating the JSON Schema.
 */
export interface Isol8UserConfig {
  /** JSON Schema URI for editor validation/completion. */
  $schema?: string;

  /** Maximum number of containers that can run concurrently. @default 10 */
  maxConcurrent?: number;

  /** Default execution settings applied to all runs. (Partial override allowed). */
  defaults?: Partial<Isol8Defaults>;

  /** Global network filtering rules for `"filtered"` mode. */
  network?: Partial<NetworkFilterConfig>;

  /** Container cleanup and lifecycle settings. (Partial override allowed). */
  cleanup?: Partial<Isol8Cleanup>;

  /** Runtime-specific packages to bake into custom Docker images. */
  dependencies?: Isol8Dependencies;
}
