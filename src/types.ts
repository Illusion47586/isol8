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

// ─── Git Operations ───

/**
 * Git clone operation configuration.
 */
export interface GitCloneOptions {
  /** Repository URL to clone (HTTPS or SSH). */
  url: string;
  /** Local path where the repository should be cloned (relative to /sandbox). */
  path?: string;
  /** Branch or tag to checkout after cloning. */
  branch?: string;
  /** Depth for shallow clone (e.g., 1 for latest commit only). */
  depth?: number;
  /** Whether to clone submodules recursively. */
  recursive?: boolean;
}

/**
 * Git commit operation configuration.
 */
export interface GitCommitOptions {
  /** Commit message. */
  message: string;
  /** Author name for the commit. */
  authorName?: string;
  /** Author email for the commit. */
  authorEmail?: string;
  /** Whether to stage all changes before committing. */
  all?: boolean;
  /** Specific files to stage (if not using --all). */
  files?: string[];
  /** Path to the git repository (relative to /sandbox). */
  repoPath?: string;
}

/**
 * Git push operation configuration.
 */
export interface GitPushOptions {
  /** Remote name (default: "origin"). */
  remote?: string;
  /** Branch name to push. */
  branch: string;
  /** Whether to force push. */
  force?: boolean;
  /** Whether to set upstream tracking. */
  setUpstream?: boolean;
  /** Path to the git repository (relative to /sandbox). */
  repoPath?: string;
}

/**
 * Git pull operation configuration.
 */
export interface GitPullOptions {
  /** Remote name (default: "origin"). */
  remote?: string;
  /** Branch name to pull. */
  branch?: string;
  /** Whether to rebase instead of merge. */
  rebase?: boolean;
  /** Path to the git repository (relative to /sandbox). */
  repoPath?: string;
}

/**
 * Git checkout operation configuration.
 */
export interface GitCheckoutOptions {
  /** Branch, tag, or commit SHA to checkout. */
  target: string;
  /** Whether to create a new branch. */
  createBranch?: boolean;
  /** Path to the git repository (relative to /sandbox). */
  repoPath?: string;
}

/**
 * Configuration for Git operations to perform before/after code execution.
 * All operations are executed in the order specified.
 */
export interface GitOperations {
  /** Clone a repository before execution. */
  clone?: GitCloneOptions;
  /** Checkout a branch/commit before execution. */
  checkout?: GitCheckoutOptions;
  /** Pull latest changes before execution. */
  pull?: GitPullOptions;
  /** Commit changes after execution. */
  commit?: GitCommitOptions;
  /** Push changes after execution. */
  push?: GitPushOptions;
}

/**
 * Security configuration for Git operations.
 */
export interface GitSecurityConfig {
  /** List of allowed Git host domains (e.g., ["github.com", "gitlab.com"]).
   * If specified, only these hosts are permitted.
   */
  allowedHosts?: string[];
  /** List of blocked URL patterns (regex strings) for SSRF prevention.
   * Matching URLs are always denied, even if whitelisted.
   */
  blockedPatterns?: string[];
  /** Whether to allow private/internal IP addresses (default: false for SSRF protection). */
  allowPrivateIPs?: boolean;
  /** Environment variable names containing Git credentials (e.g., ["GIT_TOKEN", "GITHUB_TOKEN"]).
   * These will be masked in output logs.
   */
  credentialEnvVars?: string[];
}

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

  /**
   * Optional file extension to use for the script file (e.g. ".cjs", ".mjs").
   * If not provided, defaults to the runtime adapter's default extension.
   */
  fileExtension?: string;

  /**
   * Data to pipe to the process via stdin.
   * Written to a temporary file and piped into the command.
   */
  stdin?: string;

  /**
   * Files to inject into the container before execution.
   * Keys are absolute paths inside the container, values are file contents.
   */
  files?: Record<string, string | Buffer>;

  /**
   * Absolute paths of files to retrieve from the container after execution.
   * Retrieved files are included in {@link ExecutionResult.files} as base64 strings.
   */
  outputPaths?: string[];

  /**
   * Packages to install before execution via the runtime's package manager.
   * e.g. `["numpy", "pandas"]` for Python or `["lodash"]` for Node.
   */
  installPackages?: string[];

  /**
   * Additional metadata to include in audit logs (userId, tenantId, etc.).
   * Passed through to audit logs when audit logging is enabled.
   */
  metadata?: Record<string, string>;

  /**
   * Git operations to perform before and after code execution.
   * Operations are executed in order: clone → checkout → pull → (execute) → commit → push.
   */
  git?: GitOperations;
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

  /** Unique identifier for this execution. */
  executionId: string;

  /** Runtime used for this execution. */
  runtime: Runtime;

  /** ISO 8601 timestamp of when execution started. */
  timestamp: string;

  /** Docker container ID (if available). */
  containerId?: string;

  /**
   * Files retrieved from the container after execution.
   * Keys are paths, values are base64-encoded file contents.
   * Only populated when {@link ExecutionRequest.outputPaths} is specified.
   */
  files?: Record<string, string>;

  /**
   * Resource usage metrics collected during execution.
   * Only populated when audit logging with trackResources is enabled.
   */
  resourceUsage?: {
    /** CPU usage as percentage (0-100 * num_cores) */
    cpuPercent: number;
    /** Current memory usage in megabytes */
    memoryMB: number;
    /** Peak memory usage in megabytes (if tracked) */
    peakMemoryMB?: number;
    /** Bytes received during execution */
    networkBytesIn: number;
    /** Bytes sent during execution */
    networkBytesOut: number;
  };

  /**
   * Network request logs collected during execution.
   * Only populated when `logNetwork` is enabled and network mode is "filtered".
   */
  networkLogs?: NetworkLogEntry[];
} /**
 * A chunk of streaming output from an execution.
 *
 * Yielded by {@link Isol8Engine.executeStream} as output arrives in real-time.
 */
export interface StreamEvent {
  /** Event type: output chunk, process exit, or error. */
  type: "stdout" | "stderr" | "exit" | "error";
  /** Text content for stdout/stderr, exit code string for exit, error message for error. */
  data: string;
}

/**
 * Security events raised during execution (policy violations, alerts).
 */
export interface SecurityEvent {
  type: string;
  message: string;
  details?: Record<string, unknown>;
  timestamp: string;
}

/**
 * A network request logged by the proxy in filtered network mode.
 */
export interface NetworkLogEntry {
  /** ISO 8601 timestamp of when the request was made. */
  timestamp: string;
  /** HTTP method (GET, POST, CONNECT, etc.). */
  method: string;
  /** Target hostname. */
  host: string;
  /** Request path for HTTP requests, null for HTTPS CONNECT tunnels. */
  path: string | null;
  /** Whether the request was allowed through or blocked by the filter. */
  action: "ALLOW" | "BLOCK";
  /** Time taken to handle the request in milliseconds. */
  durationMs: number;
}

/**
 * Audit record for an execution. Stored in immutable append-only logs.
 */
export interface ExecutionAudit {
  executionId: string;
  userId: string; // Required field as per issue
  timestamp: string;
  runtime: Runtime;
  codeHash: string; // SHA256 of input code
  containerId: string; // Required field as per issue
  exitCode: number;
  durationMs: number; // Required field as per issue
  resourceUsage?: {
    /** CPU usage as percentage (0-100 * num_cores) */
    cpuPercent: number;
    /** Current memory usage in megabytes */
    memoryMB: number;
    /** Peak memory usage in megabytes (if tracked) */
    peakMemoryMB?: number;
    /** Bytes received during execution */
    networkBytesIn: number;
    /** Bytes sent during execution */
    networkBytesOut: number;
  };
  securityEvents?: SecurityEvent[]; // Initially optional, can be enhanced later
  networkLogs?: NetworkLogEntry[];
  // Optional fields that may be omitted by configuration for privacy
  code?: string;
  stdout?: string;
  stderr?: string;
  // Additional metadata passed by client
  metadata?: Record<string, string>;
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

  /** Size of the `/sandbox` tmpfs mount (e.g. `"64m"`, `"256m"`). Packages installed with `--install` are stored here. @default "512m" */
  sandboxSize?: string;

  /** Size of the `/tmp` tmpfs mount (e.g. `"64m"`, `"128m"`). @default "256m" */
  tmpSize?: string;

  /** Enable debug logging. @default false */
  debug?: boolean;

  /**
   * Keep the container running after execution for inspection/debugging.
   * When true, the container is not cleaned up or returned to the pool.
   * @default false
   */
  persist?: boolean;

  /**
   * Enable network request logging. Only works when network mode is "filtered".
   * Logs are collected from the proxy and included in ExecutionResult.
   * @default false
   */
  logNetwork?: boolean;

  /** Security settings. */
  security?: SecurityConfig;

  /** Audit logging configuration. */
  audit?: AuditConfig;

  /**
   * Pool strategy for container reuse.
   * - "secure": Clean container before returning (slower but ensures clean state)
   * - "fast": Use dual-pool system - instant acquire, background cleanup (faster)
   * @default "fast"
   */
  poolStrategy?: "secure" | "fast";

  /**
   * Pool size configuration.
   * For "secure" mode: number of containers to keep warm
   * For "fast" mode: { clean: number of ready containers, dirty: number being cleaned }
   * @default 1 (for fast mode: { clean: 1, dirty: 1 })
   */
  poolSize?: number | { clean: number; dirty: number };
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

  /**
   * Execute code and stream output chunks as they arrive.
   *
   * @param req - Execution request.
   * @returns An async iterable of {@link StreamEvent} objects.
   */
  executeStream(req: ExecutionRequest): AsyncIterable<StreamEvent>;
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
  /** Default size of the `/sandbox` tmpfs mount. @default "512m" */
  sandboxSize: string;
  /** Default size of the `/tmp` tmpfs mount. @default "256m" */
  tmpSize: string;
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
 * Security configuration for the execution environment.
 */
export interface SecurityConfig {
  /**
   * Seccomp profile mode.
   * - "strict": Use the default strict profile (default).
   * - "unconfined": Do not apply any seccomp profile.
   * - "custom": Use the profile at `customProfilePath`.
   */
  seccomp?: "strict" | "unconfined" | "custom";
  /** Path to a custom seccomp profile JSON file. Required if seccomp is "custom". */
  customProfilePath?: string;
}

/** Configuration for audit logging. */
export interface AuditConfig {
  /** Enable audit logging. @default false */
  enabled: boolean;
  /** Destination for audit logs (filesystem, stdout) @default "filesystem" */
  destination: "filesystem" | "stdout" | string;
  /** Custom directory for audit log files @default undefined (uses ./.isol8_audit) */
  logDir?: string;
  /** Script to run after each log entry (receives file path as argument) @default undefined */
  postLogScript?: string;
  /** Track resource usage (CPU, memory, network) @default true */
  trackResources: boolean;
  /** Retention period for audit logs in days @default 90 */
  retentionDays: number;
  /** Whether to include the source code in audit logs @default false */
  includeCode: boolean;
  /** Whether to include output (stdout/stderr) in audit logs @default false */
  includeOutput: boolean;
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

  /** Security settings. */
  security: SecurityConfig;

  /** Audit logging configuration. */
  audit: AuditConfig;

  /** Enable debug logging. @default false */
  debug: boolean;
}

/**
 * User configuration file schema (partial/optional version of Isol8Config).
 * Used for generating the JSON Schema.
 */
export interface Isol8UserConfig {
  /** JSON Schema URI for editor validation/completion. */
  $schema?: string;

  /** Enable debug logging. @default false */
  debug?: boolean;

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

  /** Security settings. */
  security?: SecurityConfig;

  /** Audit logging configuration. */
  audit?: Partial<AuditConfig>;
}
