/**
 * @module engine/docker
 *
 * The Docker-backed isol8 engine. Creates and manages Docker containers
 * for executing untrusted code with resource limits, network controls, and
 * output sanitization.
 */

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
} from "../types";
import { Semaphore } from "./concurrency";
import {
  createTarBuffer,
  extractFromTar,
  maskSecrets,
  parseMemoryLimit,
  truncateOutput,
} from "./utils";

const SANDBOX_WORKDIR = "/sandbox";
const MAX_OUTPUT_BYTES = 1024 * 1024; // 1MB default
const PROXY_PORT = 8118;

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

  private container: Docker.Container | null = null;
  private persistentRuntime: RuntimeAdapter | null = null;

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
    const tar = createTarBuffer(path, content);
    await this.container.putArchive(tar, { path: "/" });
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

  // ─── Private methods ───

  private async executeEphemeral(req: ExecutionRequest): Promise<ExecutionResult> {
    const adapter = this.getAdapter(req.runtime);
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;

    // Create a container similar to persistent mode logic to support ReadonlyRootfs + Tmpfs
    // We must start the container (activating tmpfs) before writing code to /sandbox
    const container = await this.docker.createContainer({
      Image: this.overrideImage ?? adapter.image,
      Cmd: ["sleep", "infinity"], // Keep alive while we exec
      WorkingDir: SANDBOX_WORKDIR,
      Env: this.buildEnv(), // Base env, user env added at exec time
      NetworkDisabled: this.network === "none",
      HostConfig: this.buildHostConfig(),
      StopTimeout: 2,
    });

    try {
      await container.start();

      // Write code to the active tmpfs
      const filePath = `${SANDBOX_WORKDIR}/main${adapter.getFileExtension()}`;
      const tar = createTarBuffer(filePath, req.code);
      await container.putArchive(tar, { path: "/" });

      // Execute the actual command
      const cmd = adapter.getCommand(req.code, filePath);
      // Re-build env to include user-provided env vars for this execution
      const execEnv = this.buildEnv(req.env);

      const exec = await container.exec({
        Cmd: cmd,
        Env: execEnv,
        AttachStdout: true,
        AttachStderr: true,
        WorkingDir: SANDBOX_WORKDIR,
      });

      const start = performance.now();
      const execStream = await exec.start({ hijack: true, stdin: false });

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
      };
    } finally {
      try {
        await container.remove({ force: true });
      } catch {
        // Best effort cleanup
      }
    }
  }

  private async executePersistent(req: ExecutionRequest): Promise<ExecutionResult> {
    const adapter = this.getAdapter(req.runtime);
    const timeoutMs = req.timeoutMs ?? this.defaultTimeoutMs;

    // Lazily create the persistent container
    if (!this.container || this.persistentRuntime?.name !== adapter.name) {
      await this.stop();
      await this.startPersistentContainer(adapter);
    }

    const filePath = `${SANDBOX_WORKDIR}/exec_${Date.now()}${adapter.getFileExtension()}`;

    // Write code to the container
    const tar = createTarBuffer(filePath, req.code);
    await this.container!.putArchive(tar, { path: "/" });

    const cmd = adapter.getCommand(req.code, filePath);
    const execEnv = this.buildEnv(req.env);

    const exec = await this.container!.exec({
      Cmd: cmd,
      Env: execEnv,
      AttachStdout: true,
      AttachStderr: true,
      WorkingDir: SANDBOX_WORKDIR,
    });

    const start = performance.now();
    const execStream = await exec.start({ hijack: true, stdin: false });

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
    };
  }

  private async startPersistentContainer(adapter: RuntimeAdapter): Promise<void> {
    this.container = await this.docker.createContainer({
      Image: this.overrideImage ?? adapter.image,
      Cmd: ["sleep", "infinity"],
      WorkingDir: SANDBOX_WORKDIR,
      Env: this.buildEnv(),
      NetworkDisabled: this.network === "none",
      HostConfig: this.buildHostConfig(),
      StopTimeout: 2,
    });

    await this.container.start();
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
        "/tmp": "rw,noexec,nosuid,size=64m",
        [SANDBOX_WORKDIR]: "rw,size=64m",
      },
      SecurityOpt: ["no-new-privileges"],
    };

    if (this.network === "filtered") {
      config.NetworkMode = "bridge";
    } else if (this.network === "host") {
      config.NetworkMode = "host";
    }

    return config;
  }

  private buildEnv(extra?: Record<string, string>): string[] {
    const env: string[] = [];

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

    // Add proxy config for filtered mode
    if (this.network === "filtered" && this.networkFilter) {
      env.push(`ISOL8_WHITELIST=${JSON.stringify(this.networkFilter.whitelist)}`);
      env.push(`ISOL8_BLACKLIST=${JSON.stringify(this.networkFilter.blacklist)}`);
      env.push(`HTTP_PROXY=http://127.0.0.1:${PROXY_PORT}`);
      env.push(`HTTPS_PROXY=http://127.0.0.1:${PROXY_PORT}`);
      env.push(`http_proxy=http://127.0.0.1:${PROXY_PORT}`);
      env.push(`https_proxy=http://127.0.0.1:${PROXY_PORT}`);
    }

    return env;
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
}
