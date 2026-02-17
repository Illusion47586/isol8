/**
 * @module engine/docker
 *
 * The Docker-backed isol8 engine. Creates and manages Docker containers
 * for executing untrusted code with resource limits, network controls, and
 * output sanitization.
 */

import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { PassThrough } from "node:stream";
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
  SecurityConfig,
  StreamEvent,
} from "../types";
import { logger } from "../utils/logger";
import { Semaphore } from "./concurrency";
import { ContainerPool } from "./pool";
import {
  createTarBuffer,
  extractFromTar,
  maskSecrets,
  parseMemoryLimit,
  truncateOutput,
} from "./utils";

/**
 * Writes a file into a running container using `docker exec`.
 * This bypasses the `putArchive` limitation where Docker rejects archive
 * uploads when `ReadonlyRootfs` is enabled — even to writable tmpfs mounts.
 *
 * Uses attached stdin to prevent leaking file content in process arguments (ps).
 */
async function writeFileViaExec(
  container: Docker.Container,
  filePath: string,
  content: Buffer | string
): Promise<void> {
  const data = typeof content === "string" ? Buffer.from(content, "utf-8") : content;

  return new Promise((resolve, reject) => {
    const child = spawn(
      "docker",
      ["exec", "-i", "-u", "sandbox", container.id, "sh", "-c", `cat > ${filePath}`],
      {
        stdio: ["pipe", "ignore", "pipe"],
      }
    );

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn docker exec: ${err.message}`));
    });

    // Handle stderr to capture errors
    let stderr = "";
    child.stderr.on("data", (chunk) => (stderr += chunk.toString()));

    // Write content to stdin
    // Note: If data is very large, we might need to handle backpressure,
    // but for typical source code/config files, this is fine.
    child.stdin.write(data);
    child.stdin.end();

    child.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`Failed to write file ${filePath}: ${stderr} (exit code ${code})`));
      } else {
        resolve();
      }
    });
  });
}

/**
 * Reads a file from a running container using `docker exec`.
 * This bypasses the `getArchive` limitation where Docker rejects archive
 * downloads when `ReadonlyRootfs` is enabled — even from writable tmpfs mounts.
 *
 * Works by running `base64 <path>` and decoding the output.
 */
async function readFileViaExec(container: Docker.Container, filePath: string): Promise<Buffer> {
  const exec = await container.exec({
    Cmd: ["base64", filePath],
    AttachStdout: true,
    AttachStderr: true,
    User: "sandbox",
  });

  const stream = await exec.start({ Tty: false });

  const chunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];

  const stdoutStream = new PassThrough();
  const stderrStream = new PassThrough();
  container.modem.demuxStream(stream, stdoutStream, stderrStream);

  stdoutStream.on("data", (chunk: Buffer) => chunks.push(chunk));
  stderrStream.on("data", (chunk: Buffer) => stderrChunks.push(chunk));

  await new Promise<void>((resolve, reject) => {
    stream.on("end", resolve);
    stream.on("error", reject);
  });

  const inspectResult = await exec.inspect();
  if (inspectResult.ExitCode !== 0) {
    const stderr = Buffer.concat(stderrChunks).toString("utf-8").trim();
    throw new Error(
      `Failed to read file ${filePath} in container: ${stderr} (exit code ${inspectResult.ExitCode})`
    );
  }

  const b64Output = Buffer.concat(chunks).toString("utf-8").trim();
  return Buffer.from(b64Output, "base64");
}

const SANDBOX_WORKDIR = "/sandbox";
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB default
const PROXY_PORT = 8118;
const PROXY_STARTUP_TIMEOUT_MS = 5000;
const PROXY_POLL_INTERVAL_MS = 100;

/**
 * Starts the bash proxy inside the container for filtered network mode.
 * Waits until the proxy is listening on PROXY_PORT before returning.
 */
async function startProxy(
  container: Docker.Container,
  networkFilter?: { whitelist: string[]; blacklist: string[] }
): Promise<void> {
  const envParts: string[] = [];
  if (networkFilter) {
    envParts.push(`ISOL8_WHITELIST='${JSON.stringify(networkFilter.whitelist)}'`);
    envParts.push(`ISOL8_BLACKLIST='${JSON.stringify(networkFilter.blacklist)}'`);
  }
  const envPrefix = envParts.length > 0 ? `${envParts.join(" ")} ` : "";

  // Start proxy in background
  const startExec = await container.exec({
    Cmd: ["sh", "-c", `${envPrefix}bash /usr/local/bin/proxy.sh &`],
  });
  await startExec.start({ Detach: true });

  // Poll until proxy is ready
  const deadline = Date.now() + PROXY_STARTUP_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const checkExec = await container.exec({
        Cmd: ["sh", "-c", `nc -z 127.0.0.1 ${PROXY_PORT} 2>/dev/null`],
      });
      await checkExec.start({ Detach: true });
      let info = await checkExec.inspect();
      while (info.Running) {
        await new Promise((r) => setTimeout(r, 50));
        info = await checkExec.inspect();
      }
      if (info.ExitCode === 0) {
        return;
      }
    } catch {
      // Ignore, keep polling
    }
    await new Promise((r) => setTimeout(r, PROXY_POLL_INTERVAL_MS));
  }
  throw new Error("Proxy failed to start within timeout");
}

/**
 * Sets up iptables rules inside the container to enforce network filtering.
 *
 * Only traffic from the `sandbox` user (uid 100) to the local proxy
 * on PROXY_PORT is allowed. All other outbound traffic from the sandbox
 * user is dropped at the kernel level, preventing raw-socket bypass of
 * the HTTP proxy.
 *
 * Rules added (in order):
 *   1. Allow all loopback traffic (lo interface)
 *   2. Allow established/related connections (return traffic)
 *   3. Allow sandbox user → 127.0.0.1:PROXY_PORT (TCP)
 *   4. Drop all other outbound from sandbox user (uid 100)
 *
 * Must be called AFTER startProxy() since the proxy needs to bind first.
 * Runs as root (default exec user) since iptables requires CAP_NET_ADMIN.
 */
async function setupIptables(container: Docker.Container): Promise<void> {
  const rules = [
    // Allow all loopback traffic
    "/usr/sbin/iptables -A OUTPUT -o lo -j ACCEPT",
    // Allow established/related connections (responses to allowed requests)
    "/usr/sbin/iptables -A OUTPUT -m state --state ESTABLISHED,RELATED -j ACCEPT",
    // Allow sandbox user to reach the proxy
    `/usr/sbin/iptables -A OUTPUT -p tcp -d 127.0.0.1 --dport ${PROXY_PORT} -m owner --uid-owner 100 -j ACCEPT`,
    // Drop everything else from the sandbox user
    "/usr/sbin/iptables -A OUTPUT -m owner --uid-owner 100 -j DROP",
  ].join(" && ");

  const exec = await container.exec({
    Cmd: ["sh", "-c", rules],
    // Runs as root (default) — iptables requires elevated privileges
  });
  await exec.start({ Detach: true });

  // Wait for the exec to complete
  let info = await exec.inspect();
  while (info.Running) {
    await new Promise((r) => setTimeout(r, 50));
    info = await exec.inspect();
  }

  if (info.ExitCode !== 0) {
    throw new Error(`Failed to set up iptables rules (exit code ${info.ExitCode})`);
  }

  logger.debug("[Filtered] iptables rules applied — sandbox user restricted to proxy only");
}

/**
 * Wraps a command with the `timeout` utility so the process is killed
 * after the specified duration. Returns the wrapped command.
 */
function wrapWithTimeout(cmd: string[], timeoutSec: number): string[] {
  return ["timeout", "-s", "KILL", String(timeoutSec), ...cmd];
}

/**
 * Returns the package manager install command for a given runtime.
 */
function getInstallCommand(runtime: string, packages: string[]): string[] {
  switch (runtime) {
    case "python":
      return ["pip", "install", "--user", "--no-cache-dir", "--break-system-packages", ...packages];
    case "node":
      // Install to /sandbox (local node_modules) so resolution works for both CJS and ESM
      return ["npm", "install", "--prefix", "/sandbox", ...packages];
    case "bun":
      // Bun global install - use /sandbox for writable location
      return ["bun", "install", "-g", "--global-dir=/sandbox/.bun-global", ...packages];
    case "deno":
      // Deno uses URL imports; cache modules to /sandbox
      return ["sh", "-c", packages.map((p) => `deno cache ${p}`).join(" && ")];
    case "bash":
      return ["apk", "add", "--no-cache", ...packages];
    default:
      throw new Error(`Unknown runtime for package install: ${runtime}`);
  }
}

/**
 * Installs packages inside a container using the runtime's package manager.
 */
async function installPackages(
  container: Docker.Container,
  runtime: string,
  packages: string[]
): Promise<void> {
  const cmd = getInstallCommand(runtime, packages);
  // Debug log
  logger.debug(`Installing packages: ${JSON.stringify(cmd)}`);

  // Set environment for writable install locations
  // Use /sandbox instead of /tmp because /tmp has noexec flag which prevents loading .so files
  const env: string[] = [
    "PATH=/sandbox/.local/bin:/sandbox/.npm-global/bin:/sandbox/.bun-global/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin",
  ];

  if (runtime === "python") {
    env.push("PYTHONUSERBASE=/sandbox/.local");
  } else if (runtime === "node") {
    env.push("NPM_CONFIG_PREFIX=/sandbox/.npm-global");
    env.push("NPM_CONFIG_CACHE=/sandbox/.npm-cache");
    env.push("npm_config_cache=/sandbox/.npm-cache");
  } else if (runtime === "bun") {
    env.push("BUN_INSTALL_GLOBAL_DIR=/sandbox/.bun-global");
    env.push("BUN_INSTALL_CACHE_DIR=/sandbox/.bun-cache");
    env.push("BUN_INSTALL_BIN=/sandbox/.bun-global/bin");
  } else if (runtime === "deno") {
    env.push("DENO_DIR=/sandbox/.deno");
  }

  const exec = await container.exec({
    Cmd: cmd,
    AttachStdout: true,
    AttachStderr: true,
    Env: env,
    // Bash uses apk which requires root; all others install to user directories
    User: runtime === "bash" ? "root" : "sandbox",
  });

  const stream = await exec.start({ Detach: false, Tty: false });

  return new Promise<void>((resolve, reject) => {
    let stderr = "";
    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    container.modem.demuxStream(stream, stdoutStream, stderrStream);

    stderrStream.on("data", (chunk) => {
      stderr += chunk.toString();
    });

    stream.on("end", async () => {
      try {
        const info = await exec.inspect();
        if (info.ExitCode !== 0) {
          reject(new Error(`Package install failed (exit code ${info.ExitCode}): ${stderr}`));
        } else {
          resolve();
        }
      } catch (err) {
        reject(err);
      }
    });

    stream.on("error", reject);
  });
}

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
  // No, I'll just add security field
  private readonly security: SecurityConfig;
  private readonly persist: boolean;

  private container: Docker.Container | null = null;
  private persistentRuntime: RuntimeAdapter | null = null;
  private pool: ContainerPool | null = null;

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

    if (options.debug) {
      logger.setDebug(true);
    }
  }

  /**
   * Initialize isol8. Currently a no-op — containers are created
   * lazily on first `execute()` call.
   */
  async start(): Promise<void> {
    // For persistent mode, container is started lazily on first execute
    // For ephemeral mode, this is a no-op
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
    try {
      return this.mode === "persistent"
        ? await this.executePersistent(req)
        : await this.executeEphemeral(req);
    } finally {
      this.semaphore.release();
    }
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
    if (this.readonlyRootFs) {
      await writeFileViaExec(this.container, path, content);
    } else {
      const tar = createTarBuffer(path, content);
      await this.container.putArchive(tar, { path: "/" });
    }
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

    if (this.readonlyRootFs) {
      return readFileViaExec(this.container, path);
    }

    const stream = await this.container.getArchive({ path });

    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    const tarBuffer = Buffer.concat(chunks);
    return extractFromTar(tarBuffer, path);
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
      const adapter = this.getAdapter(req.runtime);
      const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;
      const image = await this.resolveImage(adapter);

      // Create container (always ephemeral-style for streaming)
      const container = await this.docker.createContainer({
        Image: image,
        Cmd: ["sleep", "infinity"],
        WorkingDir: SANDBOX_WORKDIR,
        Env: this.buildEnv(),
        NetworkDisabled: this.network === "none",
        HostConfig: this.buildHostConfig(),
        StopTimeout: 2,
      });

      try {
        await container.start();

        if (this.network === "filtered") {
          await startProxy(container, this.networkFilter);
          await setupIptables(container);
        }

        // Write code
        const ext = req.fileExtension ?? adapter.getFileExtension();
        const filePath = `${SANDBOX_WORKDIR}/main${ext}`;
        await writeFileViaExec(container, filePath, req.code);

        // Install packages if requested
        if (req.installPackages?.length) {
          await installPackages(container, req.runtime, req.installPackages);
        }

        // Inject input files
        if (req.files) {
          for (const [fPath, fContent] of Object.entries(req.files)) {
            await writeFileViaExec(container, fPath, fContent);
          }
        }

        // Build command
        const rawCmd = adapter.getCommand(req.code, filePath);
        const timeoutSec = Math.ceil(timeoutMs / 1000);
        let cmd: string[];
        if (req.stdin) {
          const stdinPath = `${SANDBOX_WORKDIR}/_stdin`;
          await writeFileViaExec(container, stdinPath, req.stdin);
          const cmdStr = rawCmd.map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(" ");
          cmd = wrapWithTimeout(["sh", "-c", `cat ${stdinPath} | ${cmdStr}`], timeoutSec);
        } else {
          cmd = wrapWithTimeout(rawCmd, timeoutSec);
        }

        const exec = await container.exec({
          Cmd: cmd,
          Env: this.buildEnv(req.env),
          AttachStdout: true,
          AttachStderr: true,
          WorkingDir: SANDBOX_WORKDIR,
          User: "sandbox",
        });

        const execStream = await exec.start({ Tty: false });

        yield* this.streamExecOutput(execStream, exec, container, timeoutMs);
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

  private async resolveImage(adapter: RuntimeAdapter): Promise<string> {
    if (this.overrideImage) {
      return this.overrideImage;
    }
    // Prefer custom image if it exists
    const customTag = `${adapter.image}-custom`;
    try {
      await this.docker.getImage(customTag).inspect();
      return customTag;
    } catch {
      return adapter.image;
    }
  }

  private async executeEphemeral(req: ExecutionRequest): Promise<ExecutionResult> {
    const adapter = this.getAdapter(req.runtime);
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;
    const image = await this.resolveImage(adapter);

    // Lazily initialize the container pool
    if (!this.pool) {
      this.pool = new ContainerPool({
        docker: this.docker,
        poolSize: 2,
        createOptions: {
          Cmd: ["sleep", "infinity"],
          WorkingDir: SANDBOX_WORKDIR,
          Env: this.buildEnv(),
          NetworkDisabled: this.network === "none",
          HostConfig: this.buildHostConfig(),
          StopTimeout: 2,
        },
      });
    }

    // Acquire a pre-warmed container from the pool
    const container = await this.pool.acquire(image);

    try {
      // Start proxy for filtered network mode
      if (this.network === "filtered") {
        await startProxy(container, this.networkFilter);
        await setupIptables(container);
      }

      // Write code to the active tmpfs via exec (putArchive fails with ReadonlyRootfs)
      const ext = req.fileExtension ?? adapter.getFileExtension();
      const filePath = `${SANDBOX_WORKDIR}/main${ext}`;
      await writeFileViaExec(container, filePath, req.code);

      // Install packages if requested
      if (req.installPackages?.length) {
        await installPackages(container, req.runtime, req.installPackages);
      }

      // Execute the actual command, wrapped with timeout to ensure kill on expiry
      const rawCmd = adapter.getCommand(req.code, filePath);
      const timeoutSec = Math.ceil(timeoutMs / 1000);

      // Handle stdin: write to file and pipe into command
      let cmd: string[];
      if (req.stdin) {
        const stdinPath = `${SANDBOX_WORKDIR}/_stdin`;
        await writeFileViaExec(container, stdinPath, req.stdin);
        const cmdStr = rawCmd.map((a) => `'${a.replace(/'/g, "'\\''")}' `).join("");
        cmd = wrapWithTimeout(["sh", "-c", `cat ${stdinPath} | ${cmdStr}`], timeoutSec);
      } else {
        cmd = wrapWithTimeout(rawCmd, timeoutSec);
      }

      // Inject input files
      if (req.files) {
        for (const [fPath, fContent] of Object.entries(req.files)) {
          await writeFileViaExec(container, fPath, fContent);
        }
      }

      const exec = await container.exec({
        Cmd: cmd,
        Env: this.buildEnv(req.env),
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: SANDBOX_WORKDIR,
        User: "sandbox",
      });

      const start = performance.now();
      const execStream = await exec.start({ Tty: false });

      const { stdout, stderr, truncated } = await this.collectExecOutput(
        execStream,
        container,
        timeoutMs
      );
      const durationMs = Math.round(performance.now() - start);

      const inspectResult = await exec.inspect();

      return {
        stdout: this.postProcessOutput(stdout, truncated),
        stderr: this.postProcessOutput(stderr, false),
        exitCode: inspectResult.ExitCode ?? 1,
        durationMs,
        truncated,
        executionId: randomUUID(),
        runtime: req.runtime,
        timestamp: new Date().toISOString(),
        containerId: container.id,
        ...(req.outputPaths ? { files: await this.retrieveFiles(container, req.outputPaths) } : {}),
      };
    } finally {
      if (this.persist) {
        logger.debug(`[Persist] Leaving container running for inspection: ${container.id}`);
      } else {
        // Return container to pool for reuse (pool will clean sandbox)
        await this.pool!.release(container, image);
      }
    }
  }

  private async executePersistent(req: ExecutionRequest): Promise<ExecutionResult> {
    const adapter = this.getAdapter(req.runtime);
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;

    // Lazily create the persistent container
    if (!this.container) {
      await this.startPersistentContainer(adapter);
    } else if (this.persistentRuntime?.name !== adapter.name) {
      throw new Error(
        `Cannot switch runtime from "${this.persistentRuntime?.name}" to "${adapter.name}". Each persistent container supports a single runtime. Create a new Isol8 instance for a different runtime.`
      );
    }

    const ext = req.fileExtension ?? adapter.getFileExtension();
    const filePath = `${SANDBOX_WORKDIR}/exec_${Date.now()}${ext}`;

    // Write code to the container
    if (this.readonlyRootFs) {
      await writeFileViaExec(this.container!, filePath, req.code);
    } else {
      const tar = createTarBuffer(filePath, req.code);
      await this.container!.putArchive(tar, { path: "/" });
    }

    // Inject input files
    if (req.files) {
      for (const [fPath, fContent] of Object.entries(req.files)) {
        if (this.readonlyRootFs) {
          await writeFileViaExec(this.container!, fPath, fContent);
        } else {
          const tar = createTarBuffer(fPath, fContent);
          await this.container!.putArchive(tar, { path: "/" });
        }
      }
    }

    const rawCmd = adapter.getCommand(req.code, filePath);
    const timeoutSec = Math.ceil(timeoutMs / 1000);

    // Install packages if requested
    if (req.installPackages?.length) {
      await installPackages(this.container!, req.runtime, req.installPackages);
    }

    // Handle stdin
    let cmd: string[];
    if (req.stdin) {
      const stdinPath = `${SANDBOX_WORKDIR}/_stdin_${Date.now()}`;
      await writeFileViaExec(this.container!, stdinPath, req.stdin);
      const cmdStr = rawCmd.map((a) => `'${a.replace(/'/g, "'\\''")}' `).join("");
      cmd = wrapWithTimeout(["sh", "-c", `cat ${stdinPath} | ${cmdStr}`], timeoutSec);
    } else {
      cmd = wrapWithTimeout(rawCmd, timeoutSec);
    }

    const execEnv = this.buildEnv(req.env);

    const exec = await this.container!.exec({
      Cmd: cmd,
      Env: execEnv,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: SANDBOX_WORKDIR,
      User: "sandbox",
    });

    const start = performance.now();
    const execStream = await exec.start({ Tty: false });

    const { stdout, stderr, truncated } = await this.collectExecOutput(
      execStream,
      this.container!,
      timeoutMs
    );
    const durationMs = Math.round(performance.now() - start);

    const inspectResult = await exec.inspect();

    return {
      stdout: this.postProcessOutput(stdout, truncated),
      stderr: this.postProcessOutput(stderr, false),
      exitCode: inspectResult.ExitCode ?? 1,
      durationMs,
      truncated,
      executionId: randomUUID(),
      runtime: req.runtime,
      timestamp: new Date().toISOString(),
      containerId: this.container?.id,
      ...(req.outputPaths
        ? { files: await this.retrieveFiles(this.container!, req.outputPaths) }
        : {}),
    };
  }

  private async retrieveFiles(
    container: Docker.Container,
    paths: string[]
  ): Promise<Record<string, string>> {
    const files: Record<string, string> = {};
    for (const p of paths) {
      try {
        const buf = this.readonlyRootFs
          ? await readFileViaExec(container, p)
          : await this.getFileFromContainer(container, p);
        files[p] = buf.toString("base64");
      } catch {
        // Skip files that don't exist
      }
    }
    return files;
  }

  private async getFileFromContainer(container: Docker.Container, path: string): Promise<Buffer> {
    const stream = await container.getArchive({ path });
    const chunks: Buffer[] = [];
    for await (const chunk of stream as AsyncIterable<Buffer>) {
      chunks.push(chunk);
    }
    return extractFromTar(Buffer.concat(chunks), path);
  }

  private async startPersistentContainer(adapter: RuntimeAdapter): Promise<void> {
    const image = await this.resolveImage(adapter);

    this.container = await this.docker.createContainer({
      Image: image,
      Cmd: ["sleep", "infinity"],
      WorkingDir: SANDBOX_WORKDIR,
      Env: this.buildEnv(),
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
    if (this.network === "filtered") {
      await startProxy(this.container, this.networkFilter);
      await setupIptables(this.container);
    }

    this.persistentRuntime = adapter;
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
        logger.error(`Failed to load custom seccomp profile: ${e}`);
      }
      return opts;
    }

    // Default strict mode
    try {
      const profile = this.loadDefaultSeccompProfile();
      if (profile) {
        opts.push(`seccomp=${profile}`);
      }
    } catch (e) {
      logger.error(`Failed to load default seccomp profile: ${e}`);
    }

    return opts;
  }

  private loadDefaultSeccompProfile(): string | null {
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

    // 3. Fallback: Try reading absolute path if we assume standard install location?
    // Not reliable.

    logger.warn("Could not locate default seccomp profile. Running without seccomp filter.");
    return null;
  }

  private buildEnv(extra?: Record<string, string>): string[] {
    const env: string[] = [
      "PYTHONUNBUFFERED=1",
      "PYTHONUSERBASE=/sandbox/.local",
      "NPM_CONFIG_PREFIX=/sandbox/.npm-global",
      "DENO_DIR=/sandbox/.deno",
      "PATH=/sandbox/.local/bin:/sandbox/.npm-global/bin:/sandbox/.bun-global/bin:/usr/local/bin:/usr/bin:/bin",
      "NODE_PATH=/usr/local/lib/node_modules:/sandbox/.npm-global/lib/node_modules:/sandbox/node_modules",
    ];

    // Add secrets as env vars
    for (const [key, value] of Object.entries(this.secrets)) {
      env.push(`${key}=${value}`);
    }

    // Add extra env vars
    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        env.push(`${key}=${value}`);
      }
    }

    // Add proxy config for filtered mode. Always set the HTTP(S)_PROXY
    // environment variables when running in "filtered" mode so runtimes
    // will use the in-container proxy. If a networkFilter is provided,
    // also export the whitelist/blacklist JSON so the proxy enforces rules.
    if (this.network === "filtered") {
      if (this.networkFilter) {
        env.push(`ISOL8_WHITELIST=${JSON.stringify(this.networkFilter.whitelist)}`);
        env.push(`ISOL8_BLACKLIST=${JSON.stringify(this.networkFilter.blacklist)}`);
      }
      env.push(`HTTP_PROXY=http://127.0.0.1:${PROXY_PORT}`);
      env.push(`HTTPS_PROXY=http://127.0.0.1:${PROXY_PORT}`);
      env.push(`http_proxy=http://127.0.0.1:${PROXY_PORT}`);
      env.push(`https_proxy=http://127.0.0.1:${PROXY_PORT}`);
    }

    return env;
  }

  private async *streamExecOutput(
    stream: NodeJS.ReadableStream,
    exec: Docker.Exec,
    container: Docker.Container,
    timeoutMs: number
  ): AsyncGenerator<StreamEvent> {
    // Bridge event-based stream to async generator via a queue
    const queue: StreamEvent[] = [];
    let resolve: (() => void) | null = null;
    let done = false;

    const push = (event: StreamEvent) => {
      queue.push(event);
      if (resolve) {
        resolve();
        resolve = null;
      }
    };

    const timer = setTimeout(() => {
      push({ type: "error", data: "EXECUTION TIMED OUT" });
      push({ type: "exit", data: "137" });
      done = true;
    }, timeoutMs);

    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    container.modem.demuxStream(stream, stdoutStream, stderrStream);

    stdoutStream.on("data", (chunk: Buffer) => {
      let text = chunk.toString("utf-8");
      if (Object.keys(this.secrets).length > 0) {
        text = maskSecrets(text, this.secrets);
      }
      push({ type: "stdout", data: text });
    });

    stderrStream.on("data", (chunk: Buffer) => {
      let text = chunk.toString("utf-8");
      if (Object.keys(this.secrets).length > 0) {
        text = maskSecrets(text, this.secrets);
      }
      push({ type: "stderr", data: text });
    });

    stream.on("end", async () => {
      clearTimeout(timer);
      try {
        const info = await exec.inspect();
        push({ type: "exit", data: (info.ExitCode ?? 0).toString() });
      } catch {
        push({ type: "exit", data: "1" });
      }
      done = true;
    });

    stream.on("error", (err: Error) => {
      clearTimeout(timer);
      push({ type: "error", data: err.message });
      push({ type: "exit", data: "1" });
      done = true;
    });

    // Drain the queue as events arrive
    while (!done || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else if (resolve) {
        await new Promise<void>((r) => {
          resolve = r;
        });
      } else {
        await new Promise((r) => setTimeout(r, 10));
      }
    }
  }

  private async collectExecOutput(
    stream: NodeJS.ReadableStream,
    container: Docker.Container,
    timeoutMs: number
  ): Promise<{ stdout: string; stderr: string; truncated: boolean }> {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let truncated = false;
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        resolve({ stdout, stderr: `${stderr}\n--- EXECUTION TIMED OUT ---`, truncated });
      }, timeoutMs);

      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();

      container.modem.demuxStream(stream, stdoutStream, stderrStream);

      stdoutStream.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf-8");
        if (stdout.length > this.maxOutputSize) {
          const result = truncateOutput(stdout, this.maxOutputSize);
          stdout = result.text;
          truncated = true;
        }
      });

      stderrStream.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
        if (stderr.length > this.maxOutputSize) {
          const result = truncateOutput(stderr, this.maxOutputSize);
          stderr = result.text;
          truncated = true;
        }
      });

      stream.on("end", () => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve({ stdout, stderr, truncated });
      });

      stream.on("error", (err: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(err);
      });
    });
  }

  private postProcessOutput(output: string, _truncated: boolean): string {
    let result = output;

    // Mask secrets
    if (Object.keys(this.secrets).length > 0) {
      result = maskSecrets(result, this.secrets);
    }

    // Trim trailing whitespace
    return result.trimEnd();
  }

  /**
   * Remove all isol8 containers (both running and stopped).
   *
   * This static utility method finds and removes all containers created by isol8,
   * identified by images starting with `isol8:` or `isol8-custom:`.
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
    const isol8Containers = containers.filter(
      (c) => c.Image.startsWith("isol8:") || c.Image.startsWith("isol8-custom:")
    );

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
}
