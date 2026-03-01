/**
 * @module engine/docker
 *
 * The Docker-backed isol8 engine. Creates and manages Docker containers
 * for executing untrusted code with resource limits, network controls, and
 * output sanitization.
 */

import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import Docker from "dockerode";
import { RuntimeRegistry } from "../runtime";
import type { RuntimeAdapter } from "../runtime/adapter";
import type {
  ExecutionRequest,
  ExecutionResult,
  Isol8Engine,
  Isol8Mode,
  Isol8Options,
  NetworkFilterConfig,
  NetworkMode,
  RemoteCodePolicy,
  SecurityConfig,
  StartOptions,
  StreamEvent,
} from "../types.js";
import { logger } from "../utils/logger";
import { AuditLogger } from "./audit";
import { fetchRemoteCode } from "./code-fetcher";
import { Semaphore } from "./concurrency";
import { EMBEDDED_DEFAULT_SECCOMP_PROFILE } from "./default-seccomp-profile";
import { ExecutionManager, NetworkManager, VolumeManager } from "./managers";
import { ContainerPool } from "./pool";
import { type ContainerResourceUsage, calculateResourceDelta, getContainerStats } from "./stats";
import { parseMemoryLimit, resolveWorkdir } from "./utils";

const SANDBOX_WORKDIR = "/sandbox";
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB default

/** Options for constructing a {@link DockerIsol8} instance. Extends {@link Isol8Options} with Docker-specific settings. */
export interface DockerIsol8Options extends Isol8Options {
  /** Custom dockerode instance. Defaults to connecting to the local Docker socket. */
  docker?: Docker;
}

/**
 * Docker-backed isol8 engine that executes code in isolated containers.
 *
 * Supports two modes:
 * - **Ephemeral** — a new container is created and destroyed per `execute()` call.
 * - **Persistent** — a long-lived container is reused across calls, preserving state.
 *
 * @example
 * ```typescript
 * const isol8 = new DockerIsol8({ network: "none", memoryLimit: "256m" });
 * await isol8.start();
 * const result = await isol8.execute({ code: "print(1+1)", runtime: "python" });
 * await isol8.stop();
 * ```
 */
export class DockerIsol8 implements Isol8Engine {
  private readonly docker: Docker;
  private readonly mode: Isol8Mode;
  private readonly network: NetworkMode;
  private readonly networkFilter?: NetworkFilterConfig;
  private readonly cpuLimit: number;
  private readonly memoryLimit: string;
  private readonly pidsLimit: number;
  private readonly readonlyRootFs: boolean;
  private readonly maxOutputSize: number;
  private readonly secrets: Record<string, string>;
  private readonly defaultTimeoutMs: number;
  private readonly overrideImage?: string;
  private readonly semaphore: Semaphore;
  private readonly sandboxSize: string;
  private readonly tmpSize: string;
  private readonly security: SecurityConfig;
  private readonly persist: boolean;
  private readonly logNetwork: boolean;
  private readonly poolStrategy: "secure" | "fast";
  private readonly poolSize: number | { clean: number; dirty: number };
  private readonly auditLogger?: AuditLogger;
  private readonly remoteCodePolicy: RemoteCodePolicy;

  private readonly networkManager: NetworkManager;
  private readonly executionManager: ExecutionManager;
  private readonly volumeManager: VolumeManager;

  private container: Docker.Container | null = null;
  private persistentRuntime: RuntimeAdapter | null = null;
  private pool: ContainerPool | null = null;
  private readonly imageCache = new Map<string, string>();

  private async resolveExecutionRequest(
    req: ExecutionRequest
  ): Promise<ExecutionRequest & { code: string }> {
    const inlineCode = req.code?.trim();
    const codeUrl = req.codeUrl?.trim();

    if (inlineCode && codeUrl) {
      throw new Error("ExecutionRequest.code and ExecutionRequest.codeUrl are mutually exclusive.");
    }
    if (!(inlineCode || codeUrl)) {
      throw new Error("ExecutionRequest must include either code or codeUrl.");
    }

    if (inlineCode) {
      return { ...req, code: req.code! };
    }

    const fetched = await fetchRemoteCode(
      {
        codeUrl: codeUrl!,
        codeHash: req.codeHash,
        allowInsecureCodeUrl: req.allowInsecureCodeUrl,
      },
      this.remoteCodePolicy
    );

    return { ...req, code: fetched.code };
  }

  /**
   * @param options - Sandbox configuration options.
   * @param maxConcurrent - Maximum number of concurrent executions (controls the internal semaphore).
   */
  constructor(options: DockerIsol8Options = {}, maxConcurrent = 10) {
    this.docker = options.docker ?? new Docker();
    this.mode = options.mode ?? "ephemeral";
    this.network = options.network ?? "none";
    this.networkFilter = options.networkFilter;
    this.cpuLimit = options.cpuLimit ?? 1.0;
    this.memoryLimit = options.memoryLimit ?? "512m";
    this.pidsLimit = options.pidsLimit ?? 64;
    this.readonlyRootFs = options.readonlyRootFs ?? true;
    this.maxOutputSize = options.maxOutputSize ?? MAX_OUTPUT_BYTES;
    this.secrets = options.secrets ?? {};
    this.defaultTimeoutMs = options.timeoutMs ?? 30_000;
    this.overrideImage = options.image;
    this.semaphore = new Semaphore(maxConcurrent);
    this.sandboxSize = options.sandboxSize ?? "512m";
    this.tmpSize = options.tmpSize ?? "256m";
    this.persist = options.persist ?? false;
    this.security = options.security ?? { seccomp: "strict" };
    this.logNetwork = options.logNetwork ?? false;
    this.poolStrategy = options.poolStrategy ?? "fast";
    this.poolSize = options.poolSize ?? { clean: 1, dirty: 1 };
    this.remoteCodePolicy = options.remoteCode ?? {
      enabled: false,
      allowedSchemes: ["https"],
      allowedHosts: [],
      blockedHosts: [],
      maxCodeSize: 10 * 1024 * 1024,
      fetchTimeoutMs: 30_000,
      requireHash: false,
      enableCache: true,
      cacheTtl: 3600,
    };

    // Initialize audit logger if audit config is provided
    if (options.audit) {
      this.auditLogger = new AuditLogger(options.audit);
    }

    // Initialize managers
    this.networkManager = new NetworkManager({
      network: this.network,
      networkFilter: this.networkFilter,
    });

    this.executionManager = new ExecutionManager({
      secrets: this.secrets,
      maxOutputSize: this.maxOutputSize,
    });

    this.volumeManager = new VolumeManager({
      readonlyRootFs: this.readonlyRootFs,
      sandboxWorkdir: SANDBOX_WORKDIR,
    });

    if (options.debug) {
      logger.setDebug(true);
    }
  }

  /**
   * Initialize isol8.
   *
   * In ephemeral mode this can optionally pre-warm the container pool.
   * In persistent mode the container is created lazily on first execute.
   */
  async start(options: StartOptions = {}): Promise<void> {
    if (this.mode !== "ephemeral") {
      return;
    }

    const prewarm = options.prewarm;
    if (!prewarm) {
      return;
    }

    const pool = this.ensurePool();
    const images = new Set<string>();

    const adapters =
      typeof prewarm === "object" && prewarm.runtimes?.length
        ? prewarm.runtimes.map((runtime) => RuntimeRegistry.get(runtime))
        : RuntimeRegistry.list();

    for (const adapter of adapters) {
      try {
        const resolved = await this.resolveImage(adapter);
        images.add(resolved.image);
      } catch (err) {
        logger.debug(`[Pool] Pre-warm image resolution failed for ${adapter.name}: ${err}`);
      }
    }

    await Promise.all(
      [...images].map(async (image) => {
        try {
          await pool.warm(image);
          logger.debug(`[Pool] Pre-warmed image: ${image}`);
        } catch (err) {
          logger.debug(`[Pool] Pre-warm failed for ${image}: ${err}`);
        }
      })
    );
  }

  /** Stop and remove the container (if one exists). Safe to call multiple times. */
  async stop(): Promise<void> {
    if (this.container) {
      try {
        await this.container.stop({ t: 2 });
      } catch {
        // Container may already be stopped
      }
      try {
        await this.container.remove({ force: true });
      } catch {
        // Container may already be removed
      }
      this.container = null;
      this.persistentRuntime = null;
    }

    // Drain the warm container pool
    if (this.pool) {
      await this.pool.drain();
      this.pool = null;
    }
  }

  /**
   * Execute code in isol8. Acquires a semaphore permit to enforce
   * the concurrency limit, then delegates to ephemeral or persistent execution.
   */
  async execute(req: ExecutionRequest): Promise<ExecutionResult> {
    await this.semaphore.acquire();
    const startTime = Date.now();
    try {
      const request = await this.resolveExecutionRequest(req);
      const result =
        this.mode === "persistent"
          ? await this.executePersistent(request, startTime)
          : await this.executeEphemeral(request, startTime);

      return result;
    } finally {
      this.semaphore.release();
    }
  }

  /**
   * Record an audit entry for the execution.
   */
  private async recordAudit(
    req: ExecutionRequest & { code: string },
    result: ExecutionResult,
    startTime: number,
    container?: Docker.Container
  ): Promise<void> {
    try {
      // Calculate code hash using Web Crypto API
      const enc = new TextEncoder();
      const data = enc.encode(req.code);
      const digest = await crypto.subtle.digest("SHA-256", data);
      const codeHash = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");

      // Collect security events if container is available
      let securityEvents: import("../types").SecurityEvent[] | undefined;
      if (container && this.network === "filtered") {
        securityEvents = await this.collectSecurityEvents(container);
        if (securityEvents.length === 0) {
          securityEvents = undefined;
        }
      }

      // Collect network logs if enabled
      let networkLogs: import("../types").NetworkLogEntry[] | undefined;
      if (this.logNetwork && result.networkLogs) {
        networkLogs = result.networkLogs;
      }

      const audit = {
        executionId: result.executionId,
        userId: req.metadata?.userId || "",
        timestamp: new Date(startTime).toISOString(),
        runtime: result.runtime,
        codeHash,
        containerId: result.containerId || "",
        exitCode: result.exitCode,
        durationMs: result.durationMs,
        resourceUsage: result.resourceUsage,
        securityEvents,
        networkLogs,
        metadata: req.metadata,
      };

      // Apply privacy filtering and record
      this.auditLogger!.record(audit);
    } catch (err) {
      logger.error("Failed to record audit log:", err);
    }
  }

  /**
   * Collect security events from the container (e.g., network filter blocks).
   */
  private async collectSecurityEvents(
    container: Docker.Container
  ): Promise<import("../types").SecurityEvent[]> {
    const events: import("../types").SecurityEvent[] = [];

    try {
      // Read security events from proxy log
      const exec = await container.exec({
        Cmd: ["cat", "/tmp/isol8-proxy/security-events.jsonl"],
        AttachStdout: true,
        AttachStderr: false,
        User: "root",
      });

      const stream = await exec.start({ Tty: false });
      const chunks: Buffer[] = [];

      for await (const chunk of stream as AsyncIterable<Buffer>) {
        chunks.push(chunk);
      }

      const output = Buffer.concat(chunks).toString("utf-8").trim();
      if (output) {
        for (const line of output.split("\n")) {
          if (line.trim()) {
            try {
              const event = JSON.parse(line);
              events.push({
                type: event.type || "unknown",
                message: `Security event: ${event.type}`,
                details: event.details || {},
                timestamp: event.timestamp || new Date().toISOString(),
              });
            } catch {
              // Skip malformed lines
            }
          }
        }
      }
    } catch {
      // No security events file or container doesn't exist anymore
    }

    return events;
  }

  /**
   * Collect network logs from the container (requests made through the proxy).
   */
  private async collectNetworkLogs(
    container: Docker.Container
  ): Promise<import("../types").NetworkLogEntry[]> {
    const logs: import("../types").NetworkLogEntry[] = [];

    try {
      const exec = await container.exec({
        Cmd: ["cat", "/tmp/isol8-proxy/network.jsonl"],
        AttachStdout: true,
        AttachStderr: false,
        User: "root",
      });

      const stream = await exec.start({ Tty: false });
      const chunks: Buffer[] = [];

      for await (const chunk of stream as AsyncIterable<Buffer>) {
        chunks.push(chunk);
      }

      const output = Buffer.concat(chunks).toString("utf-8").trim();
      logger.debug(
        `[NetworkLogs] Raw output length: ${output.length}, first 100 chars: ${output.substring(0, 100).replace(/\\n/g, "\\n")}`
      );
      // Filter to only lines that contain valid JSON
      // Find the JSON object by looking for the first { and last }
      const jsonLines = output.split("\n").filter((line) => line.includes("timestamp"));
      logger.debug(
        `[NetworkLogs] Found ${jsonLines.length} JSON lines out of ${output.split("\n").length} total lines`
      );
      for (const line of jsonLines) {
        // Extract JSON by finding the first { and last }
        const startIdx = line.indexOf("{");
        const endIdx = line.lastIndexOf("}");
        if (startIdx === -1 || endIdx === -1) {
          continue;
        }
        const jsonStr = line.substring(startIdx, endIdx + 1);
        try {
          const entry = JSON.parse(jsonStr);
          logs.push({
            timestamp: entry.timestamp || new Date().toISOString(),
            method: entry.method || "UNKNOWN",
            host: entry.host || "",
            path: entry.path,
            action: entry.action || "ALLOW",
            durationMs: entry.durationMs || 0,
          });
          logger.debug(`[NetworkLogs] Successfully parsed line: ${JSON.stringify(entry)}`);
        } catch (e) {
          logger.debug(
            `[NetworkLogs] Failed to parse line: ${line.substring(0, 50)}..., error: ${e}`
          );
        }
      }
      logger.debug(`[NetworkLogs] Total parsed logs: ${logs.length}`);
    } catch {
      // No network logs file or container doesn't exist anymore
    }

    return logs;
  }

  /**
   * Upload a file into the running container via a tar archive.
   * Only available in persistent mode after at least one `execute()` call.
   *
   * @param path - Absolute path inside the container.
   * @param content - File contents.
   * @throws {Error} If no container is active.
   */
  async putFile(path: string, content: Buffer | string): Promise<void> {
    if (!this.container) {
      throw new Error("No active container. Call execute() first in persistent mode.");
    }
    await this.volumeManager.putFile(this.container, path, content);
  }

  /**
   * Download a file from the running container.
   *
   * @param path - Absolute path inside the container.
   * @returns File contents as a Buffer.
   * @throws {Error} If no container is active.
   */
  async getFile(path: string): Promise<Buffer> {
    if (!this.container) {
      throw new Error("No active container. Call execute() first in persistent mode.");
    }

    return this.volumeManager.getFile(this.container, path);
  }

  /** The Docker container ID, or `null` if no container is active. Used by the server for session tracking. */
  get containerId(): string | null {
    return this.container?.id ?? null;
  }

  /**
   * Execute code and stream output chunks as they arrive.
   * Yields {@link StreamEvent} objects for stdout, stderr, exit, and error events.
   */
  async *executeStream(req: ExecutionRequest): AsyncIterable<StreamEvent> {
    await this.semaphore.acquire();
    try {
      const request = await this.resolveExecutionRequest(req);
      const adapter = this.getAdapter(request.runtime);
      const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
      const resolved = await this.resolveImage(adapter, request.installPackages);
      const image = resolved.image;
      const execWorkdir = request.workdir ? resolveWorkdir(request.workdir) : SANDBOX_WORKDIR;

      // Create container (always ephemeral-style for streaming)
      const container: Docker.Container = await this.docker.createContainer({
        Image: image,
        Cmd: ["sleep", "infinity"],
        WorkingDir: SANDBOX_WORKDIR,
        Env: this.executionManager.buildEnv(
          undefined,
          this.networkManager.proxyPort,
          this.network,
          this.networkFilter
        ),
        NetworkDisabled: this.network === "none",
        HostConfig: this.buildHostConfig(),
        StopTimeout: 2,
      });

      try {
        await container.start();

        await this.networkManager.startProxy(container);
        await this.networkManager.setupIptables(container);

        // Write code
        const ext = request.fileExtension ?? adapter.getFileExtension();
        const filePath = `${SANDBOX_WORKDIR}/main${ext}`;
        await this.volumeManager.writeFileViaExec(container, filePath, request.code);

        // Install packages if requested
        if (resolved.remainingPackages.length > 0) {
          await this.executionManager.installPackages(
            container,
            request.runtime,
            resolved.remainingPackages,
            timeoutMs
          );
        }

        // Run setup script if provided
        if (request.setupScript) {
          await this.executionManager.runSetupScript(
            container,
            request.setupScript,
            timeoutMs,
            this.volumeManager
          );
        }

        // Inject input files
        if (request.files) {
          for (const [fPath, fContent] of Object.entries(request.files)) {
            await this.volumeManager.writeFileViaExec(container, fPath, fContent);
          }
        }

        // Build command
        const rawCmd = adapter.getCommand(request.code, filePath);
        const timeoutSec = Math.ceil(timeoutMs / 1000);
        let cmd: string[];
        if (request.stdin) {
          const stdinPath = `${SANDBOX_WORKDIR}/_stdin`;
          await this.volumeManager.writeFileViaExec(container, stdinPath, request.stdin);
          const cmdStr = rawCmd.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
          cmd = this.executionManager.wrapWithTimeout(
            ["sh", "-c", `cat ${stdinPath} | ${cmdStr}`],
            timeoutSec
          );
        } else {
          cmd = this.executionManager.wrapWithTimeout(rawCmd, timeoutSec);
        }

        const exec = await container.exec({
          Cmd: cmd,
          Env: this.executionManager.buildEnv(
            request.env,
            this.networkManager.proxyPort,
            this.network,
            this.networkFilter
          ),
          AttachStdout: true,
          AttachStderr: true,
          WorkingDir: execWorkdir,
          User: "sandbox",
        });

        const execStream = await exec.start({ Tty: false });

        yield* this.executionManager.streamExecOutput(execStream, exec, container, timeoutMs);
      } finally {
        if (this.persist) {
          logger.debug(`[Persist] Leaving container running for inspection: ${container.id}`);
        } else {
          try {
            await container.remove({ force: true });
          } catch {
            // Best effort cleanup
          }
        }
      }
    } finally {
      this.semaphore.release();
    }
  }

  // ─── Private methods ───

  private async resolveImage(
    adapter: RuntimeAdapter,
    requestedPackages?: string[]
  ): Promise<{ image: string; remainingPackages: string[] }> {
    if (this.overrideImage) {
      return { image: this.overrideImage, remainingPackages: requestedPackages ?? [] };
    }

    const cacheKey = `${adapter.name}:${(requestedPackages ?? []).join(",")}`;
    const cached = this.imageCache.get(cacheKey);
    if (cached) {
      return { image: cached, remainingPackages: [] }; // Assume cached means fully satisfied
    }

    const baseImage = adapter.image;
    let bestImage = baseImage;
    let remainingPackages = requestedPackages ?? [];

    if (requestedPackages && requestedPackages.length > 0) {
      const { LABELS, normalizePackages } = await import("./image-builder");
      const normalizedReq = normalizePackages(requestedPackages);

      // Search local images for a matching custom image
      const images = await this.docker.listImages({
        filters: {
          label: [`${LABELS.runtime}=${adapter.name}`],
        },
      });

      for (const img of images) {
        if (!img.RepoTags || img.RepoTags.length === 0) {
          continue;
        }

        const depsLabel = img.Labels?.[LABELS.dependencies];
        if (!depsLabel) {
          continue;
        }

        const imgDeps = depsLabel.split(",");

        // Exact match
        if (
          img.RepoTags[0] &&
          normalizedReq.length === imgDeps.length &&
          normalizedReq.every((p) => imgDeps.includes(p))
        ) {
          bestImage = img.RepoTags[0];
          remainingPackages = [];
          logger.debug(`[Docker] Found exact custom image match: ${bestImage}`);
          break;
        }

        // Superset match (image has all requested deps and potentially more)
        if (img.RepoTags[0] && normalizedReq.every((p) => imgDeps.includes(p))) {
          bestImage = img.RepoTags[0];
          remainingPackages = [];
          logger.debug(`[Docker] Found superset custom image match: ${bestImage}`);
          // Don't break here, we might find an exact match later
        }
      }
    }

    // Ensure the base image exists if we're falling back to it
    if (bestImage === baseImage) {
      try {
        await this.docker.getImage(baseImage).inspect();
      } catch {
        logger.debug(`[Docker] Base image ${baseImage} not found. Building...`);
        const { buildBaseImages } = await import("./image-builder");
        await buildBaseImages(this.docker, undefined, false, [adapter.name]);
      }
    }

    if (remainingPackages.length === 0) {
      this.imageCache.set(cacheKey, bestImage);
    }
    return { image: bestImage, remainingPackages };
  }

  private ensurePool(): ContainerPool {
    if (!this.pool) {
      this.pool = new ContainerPool({
        docker: this.docker,
        poolStrategy: this.poolStrategy,
        poolSize: this.poolSize,
        networkMode: this.network,
        securityMode: this.security.seccomp ?? "strict",
        createOptions: {
          Cmd: ["sleep", "infinity"],
          WorkingDir: SANDBOX_WORKDIR,
          Env: this.executionManager.buildEnv(
            undefined,
            this.networkManager.proxyPort,
            this.network,
            this.networkFilter
          ),
          NetworkDisabled: this.network === "none",
          HostConfig: this.buildHostConfig(),
          StopTimeout: 2,
        },
      });
    }

    return this.pool;
  }

  private async executeEphemeral(
    req: ExecutionRequest & { code: string },
    startTime: number
  ): Promise<ExecutionResult> {
    const adapter = this.getAdapter(req.runtime);
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;
    const resolved = await this.resolveImage(adapter, req.installPackages);
    const image = resolved.image;
    const execWorkdir = req.workdir ? resolveWorkdir(req.workdir) : SANDBOX_WORKDIR;

    // Lazily initialize the container pool
    const pool = this.ensurePool();

    // Acquire a pre-warmed container from the pool
    const container = await pool.acquire(image);

    // Collect baseline stats if resource tracking is enabled
    let startStats: ContainerResourceUsage | undefined;
    if (this.auditLogger) {
      try {
        startStats = await getContainerStats(container);
      } catch (err) {
        logger.debug("Failed to collect baseline stats:", err);
      }
    }

    try {
      // Start proxy for filtered network mode
      await this.networkManager.startProxy(container);
      await this.networkManager.setupIptables(container);

      // Fast path: for simple executions, avoid file write and execute inline.
      // Falls back to file-based path for runtimes that require file input (e.g. Deno)
      // or when request options require filesystem artifacts.
      const canUseInline =
        !(req.stdin || req.files || req.outputPaths) &&
        (!req.installPackages || req.installPackages.length === 0);

      let rawCmd: string[];
      if (canUseInline) {
        try {
          rawCmd = adapter.getCommand(req.code);
        } catch {
          const ext = req.fileExtension ?? adapter.getFileExtension();
          const filePath = `${SANDBOX_WORKDIR}/main${ext}`;
          await this.volumeManager.writeFileViaExec(container, filePath, req.code);
          rawCmd = adapter.getCommand(req.code, filePath);
        }
      } else {
        const ext = req.fileExtension ?? adapter.getFileExtension();
        const filePath = `${SANDBOX_WORKDIR}/main${ext}`;
        await this.volumeManager.writeFileViaExec(container, filePath, req.code);
        rawCmd = adapter.getCommand(req.code, filePath);
      }

      // Install packages if requested
      if (resolved.remainingPackages.length > 0) {
        await this.executionManager.installPackages(
          container,
          req.runtime,
          resolved.remainingPackages,
          timeoutMs
        );
      }

      // Run setup script if provided
      if (req.setupScript) {
        await this.executionManager.runSetupScript(
          container,
          req.setupScript,
          timeoutMs,
          this.volumeManager
        );
      }

      // Execute the actual command, wrapped with timeout to ensure kill on expiry
      const timeoutSec = Math.ceil(timeoutMs / 1000);

      // Handle stdin: write to file and pipe into command
      let cmd: string[];
      if (req.stdin) {
        const stdinPath = `${SANDBOX_WORKDIR}/_stdin`;
        await this.volumeManager.writeFileViaExec(container, stdinPath, req.stdin);
        const cmdStr = rawCmd.map((a) => `'${a.replace(/'/g, "'\\''")}' `).join("");
        cmd = this.executionManager.wrapWithTimeout(
          ["sh", "-c", `cat ${stdinPath} | ${cmdStr}`],
          timeoutSec
        );
      } else {
        cmd = this.executionManager.wrapWithTimeout(rawCmd, timeoutSec);
      }

      // Inject input files
      if (req.files) {
        for (const [fPath, fContent] of Object.entries(req.files)) {
          await this.volumeManager.writeFileViaExec(container, fPath, fContent);
        }
      }

      const exec = await container.exec({
        Cmd: cmd,
        Env: this.executionManager.buildEnv(
          req.env,
          this.networkManager.proxyPort,
          this.network,
          this.networkFilter
        ),
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: execWorkdir,
        User: "sandbox",
      });

      const start = performance.now();
      const execStream = await exec.start({ Tty: false });

      const { stdout, stderr, truncated } = await this.executionManager.collectExecOutput(
        execStream,
        container,
        timeoutMs
      );
      const durationMs = Math.round(performance.now() - start);

      const inspectResult = await exec.inspect();

      // Collect final stats and calculate resource usage delta
      let resourceUsage: ExecutionResult["resourceUsage"];
      if (startStats) {
        try {
          const endStats = await getContainerStats(container);
          resourceUsage = calculateResourceDelta(startStats, endStats);
        } catch (err) {
          logger.debug("Failed to collect final stats:", err);
        }
      }

      // Collect network logs if enabled and network mode is filtered
      let networkLogs: ExecutionResult["networkLogs"];
      if (this.logNetwork && this.network === "filtered") {
        try {
          networkLogs = await this.collectNetworkLogs(container);
          if (networkLogs.length === 0) {
            networkLogs = undefined;
          }
        } catch (err) {
          logger.debug("Failed to collect network logs:", err);
        }
      }

      const result: ExecutionResult = {
        stdout: this.executionManager.postProcessOutput(stdout, truncated),
        stderr: this.executionManager.postProcessOutput(stderr, false),
        exitCode: inspectResult.ExitCode ?? 1,
        durationMs,
        truncated,
        executionId: randomUUID(),
        runtime: req.runtime,
        timestamp: new Date().toISOString(),
        containerId: container.id,
        ...(resourceUsage ? { resourceUsage } : {}),
        ...(networkLogs ? { networkLogs } : {}),
        ...(req.outputPaths
          ? { files: await this.volumeManager.retrieveFiles(container, req.outputPaths) }
          : {}),
      };

      // Record audit log if audit logger is configured
      if (this.auditLogger) {
        await this.recordAudit(req, result, startTime, container);
      }

      return result;
    } finally {
      if (this.persist) {
        logger.debug(`[Persist] Leaving container running for inspection: ${container.id}`);
      } else {
        // Return container to pool for reuse - fire-and-forget for performance
        pool.release(container, image).catch((err) => {
          logger.debug(`[Pool] release failed: ${err}`);
          container.remove({ force: true }).catch(() => {});
        });
      }
    }
  }

  private async executePersistent(
    req: ExecutionRequest & { code: string },
    startTime: number
  ): Promise<ExecutionResult> {
    const adapter = this.getAdapter(req.runtime);
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;
    const execWorkdir = req.workdir ? resolveWorkdir(req.workdir) : SANDBOX_WORKDIR;

    let remainingPackages = req.installPackages ?? [];

    // Lazily create the persistent container
    if (!this.container) {
      remainingPackages = await this.startPersistentContainer(adapter, req.installPackages);
    } else if (this.persistentRuntime?.name !== adapter.name) {
      throw new Error(
        `Cannot switch runtime from "${this.persistentRuntime?.name}" to "${adapter.name}". Each persistent container supports a single runtime. Create a new Isol8 instance for a different runtime.`
      );
    }

    const ext = req.fileExtension ?? adapter.getFileExtension();
    const filePath = `${SANDBOX_WORKDIR}/exec_${Date.now()}${ext}`;

    // Write code to the container
    await this.volumeManager.putFile(this.container!, filePath, req.code);

    // Inject input files
    if (req.files) {
      for (const [fPath, fContent] of Object.entries(req.files)) {
        await this.volumeManager.putFile(this.container!, fPath, fContent);
      }
    }

    const rawCmd = adapter.getCommand(req.code, filePath);
    const timeoutSec = Math.ceil(timeoutMs / 1000);

    // Install packages if requested
    if (remainingPackages.length > 0) {
      await this.executionManager.installPackages(
        this.container!,
        req.runtime,
        remainingPackages,
        timeoutMs
      );
    }

    // Run setup script if provided
    if (req.setupScript) {
      await this.executionManager.runSetupScript(
        this.container!,
        req.setupScript,
        timeoutMs,
        this.volumeManager
      );
    }

    // Handle stdin
    let cmd: string[];
    if (req.stdin) {
      const stdinPath = `${SANDBOX_WORKDIR}/_stdin_${Date.now()}`;
      await this.volumeManager.writeFileViaExec(this.container!, stdinPath, req.stdin);
      const cmdStr = rawCmd.map((a) => `'${a.replace(/'/g, "'\\''")}' `).join("");
      cmd = this.executionManager.wrapWithTimeout(
        ["sh", "-c", `cat ${stdinPath} | ${cmdStr}`],
        timeoutSec
      );
    } else {
      cmd = this.executionManager.wrapWithTimeout(rawCmd, timeoutSec);
    }

    const execEnv = this.executionManager.buildEnv(
      req.env,
      this.networkManager.proxyPort,
      this.network,
      this.networkFilter
    );

    const exec = await this.container!.exec({
      Cmd: cmd,
      Env: execEnv,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: execWorkdir,
      User: "sandbox",
    });

    const start = performance.now();
    const execStream = await exec.start({ Tty: false });

    const { stdout, stderr, truncated } = await this.executionManager.collectExecOutput(
      execStream,
      this.container!,
      timeoutMs
    );
    const durationMs = Math.round(performance.now() - start);

    const inspectResult = await exec.inspect();

    // Collect resource stats if tracking is enabled
    let resourceUsage: ExecutionResult["resourceUsage"];
    if (this.auditLogger) {
      try {
        const endStats = await getContainerStats(this.container!);
        // For persistent mode, we don't have baseline, so use current values
        resourceUsage = {
          cpuPercent: endStats.cpuPercent,
          memoryMB: endStats.memoryMB,
          networkBytesIn: endStats.networkBytesIn,
          networkBytesOut: endStats.networkBytesOut,
        };
      } catch (err) {
        logger.debug("Failed to collect resource stats:", err);
      }
    }

    // Collect network logs if enabled and network mode is filtered
    let networkLogs: ExecutionResult["networkLogs"];
    if (this.logNetwork && this.network === "filtered") {
      try {
        networkLogs = await this.collectNetworkLogs(this.container!);
        if (networkLogs.length === 0) {
          networkLogs = undefined;
        }
      } catch (err) {
        logger.debug("Failed to collect network logs:", err);
      }
    }

    const result: ExecutionResult = {
      stdout: this.executionManager.postProcessOutput(stdout, truncated),
      stderr: this.executionManager.postProcessOutput(stderr, false),
      exitCode: inspectResult.ExitCode ?? 1,
      durationMs,
      truncated,
      executionId: randomUUID(),
      runtime: req.runtime,
      timestamp: new Date().toISOString(),
      containerId: this.container?.id,
      ...(resourceUsage ? { resourceUsage } : {}),
      ...(networkLogs ? { networkLogs } : {}),
      ...(req.outputPaths
        ? { files: await this.retrieveFiles(this.container!, req.outputPaths) }
        : {}),
    };

    // Record audit log if audit logger is configured
    if (this.auditLogger) {
      await this.recordAudit(req, result, startTime, this.container!);
    }

    return result;
  }

  private async retrieveFiles(
    container: Docker.Container,
    paths: string[]
  ): Promise<Record<string, string>> {
    return this.volumeManager.retrieveFiles(container, paths);
  }

  private async startPersistentContainer(
    adapter: RuntimeAdapter,
    requestedPackages?: string[]
  ): Promise<string[]> {
    const resolved = await this.resolveImage(adapter, requestedPackages);

    this.container = await this.docker.createContainer({
      Image: resolved.image,
      Cmd: ["sleep", "infinity"],
      WorkingDir: SANDBOX_WORKDIR,
      Env: this.executionManager.buildEnv(
        undefined,
        this.networkManager.proxyPort,
        this.network,
        this.networkFilter
      ),
      NetworkDisabled: this.network === "none",
      HostConfig: this.buildHostConfig(),
      StopTimeout: 2,
      Labels: {
        "isol8.managed": "true",
        "isol8.runtime": adapter.name,
      },
    });

    await this.container.start();

    // Start proxy for filtered network mode
    await this.networkManager.startProxy(this.container);
    await this.networkManager.setupIptables(this.container);

    this.persistentRuntime = adapter;
    return resolved.remainingPackages;
  }

  private getAdapter(runtime: string): RuntimeAdapter {
    return RuntimeRegistry.get(runtime);
  }

  private buildHostConfig(): Docker.HostConfig {
    const config: Docker.HostConfig = {
      Memory: parseMemoryLimit(this.memoryLimit),
      NanoCpus: Math.floor(this.cpuLimit * 1e9),
      PidsLimit: this.pidsLimit,
      ReadonlyRootfs: this.readonlyRootFs,
      Tmpfs: {
        "/tmp": `rw,noexec,nosuid,nodev,size=${this.tmpSize}`,
        [SANDBOX_WORKDIR]: `rw,exec,nosuid,nodev,size=${this.sandboxSize},uid=100,gid=101`,
      },
      SecurityOpt: this.buildSecurityOpts(),
    };

    if (this.network === "filtered") {
      config.NetworkMode = "bridge";
      // CAP_NET_ADMIN is required for iptables rules that enforce proxy-only
      // outbound traffic from the sandbox user. The capability is used once
      // at container startup (by root) to set rules, then the sandbox user
      // (which runs all user code) cannot modify them.
      config.CapAdd = ["NET_ADMIN"];
    } else if (this.network === "host") {
      config.NetworkMode = "host";
    }

    return config;
  }

  private buildSecurityOpts(): string[] {
    const opts = ["no-new-privileges"];

    if (this.security.seccomp === "unconfined") {
      opts.push("seccomp=unconfined");
      return opts;
    }

    if (this.security.seccomp === "custom" && this.security.customProfilePath) {
      try {
        const profile = readFileSync(this.security.customProfilePath, "utf-8");
        opts.push(`seccomp=${profile}`);
      } catch (e) {
        throw new Error(
          `Failed to load custom seccomp profile at ${this.security.customProfilePath}: ${e}`
        );
      }
      return opts;
    }

    // Default strict mode
    try {
      const profile = this.loadDefaultSeccompProfile();
      opts.push(`seccomp=${profile}`);
    } catch (e) {
      throw new Error(`Failed to load default seccomp profile: ${e}`);
    }

    return opts;
  }

  private loadDefaultSeccompProfile(): string {
    // Try resolving relative to this file (dev mode)
    // Note: in bundled code, import.meta.url might point to dist/index.js

    // 1. Try ../../docker/seccomp-profile.json (Development structure)
    // In dev: src/engine/docker.ts -> ../../docker
    const devPath = new URL("../../docker/seccomp-profile.json", import.meta.url);
    if (existsSync(devPath)) {
      return readFileSync(devPath, "utf-8");
    }

    // 2. Try ./docker/seccomp-profile.json (Production/Dist structure)
    // In dist: dist/index.js -> ./docker
    const prodPath = new URL("./docker/seccomp-profile.json", import.meta.url);
    if (existsSync(prodPath)) {
      return readFileSync(prodPath, "utf-8");
    }

    // 3. Embedded fallback for standalone compiled binaries.
    if (EMBEDDED_DEFAULT_SECCOMP_PROFILE.length > 0) {
      logger.debug(
        `Default seccomp profile file not found. Using embedded profile. Tried: ${devPath.pathname}, ${prodPath.pathname}`
      );
      return EMBEDDED_DEFAULT_SECCOMP_PROFILE;
    }

    throw new Error("Embedded default seccomp profile is unavailable");
  }

  /**
   * Remove all isol8 containers (both running and stopped).
   *
   * This static utility method finds and removes all containers created by isol8,
   * identified by images starting with `isol8:`.
   *
   * @param docker - Optional Docker instance. If not provided, creates a new one.
   * @returns Promise resolving to an object with counts of removed and failed containers.
   *
   * @example
   * ```typescript
   * import { DockerIsol8 } from "isol8";
   *
   * // Remove all isol8 containers
   * const result = await DockerIsol8.cleanup();
   * console.log(`Removed ${result.removed} containers`);
   * if (result.failed > 0) {
   *   console.log(`Failed to remove ${result.failed} containers`);
   * }
   * ```
   */
  static async cleanup(
    docker?: Docker
  ): Promise<{ removed: number; failed: number; errors: string[] }> {
    const dockerInstance = docker ?? new Docker();

    // Find all isol8 containers
    const containers = await dockerInstance.listContainers({ all: true });
    const isol8Containers = containers.filter((c) => c.Image.startsWith("isol8:"));

    let removed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const containerInfo of isol8Containers) {
      try {
        const container = dockerInstance.getContainer(containerInfo.Id);
        await container.remove({ force: true });
        removed++;
      } catch (err) {
        failed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        errors.push(`${containerInfo.Id.slice(0, 12)}: ${errorMsg}`);
      }
    }

    return { removed, failed, errors };
  }

  /**
   * Remove all isol8 Docker images.
   *
   * Images are identified by repo tags starting with `isol8:`
   * (for example `isol8:python` or `isol8:python-custom-<hash>`).
   */
  static async cleanupImages(
    docker?: Docker
  ): Promise<{ removed: number; failed: number; errors: string[] }> {
    const dockerInstance = docker ?? new Docker();

    const images = await dockerInstance.listImages({ all: true });
    const isol8Images = images.filter((img) =>
      img.RepoTags?.some((tag) => tag.startsWith("isol8:"))
    );

    let removed = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const imageInfo of isol8Images) {
      try {
        const image = dockerInstance.getImage(imageInfo.Id);
        await image.remove({ force: true });
        removed++;
      } catch (err) {
        failed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        const imageRef = imageInfo.RepoTags?.[0] ?? imageInfo.Id.slice(0, 12);
        errors.push(`${imageRef}: ${errorMsg}`);
      }
    }

    return { removed, failed, errors };
  }
}
