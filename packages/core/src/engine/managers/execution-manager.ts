import { PassThrough, type Readable } from "node:stream";
import type Docker from "dockerode";
import type { NetworkFilterConfig, Runtime, StreamEvent } from "../../types";
import { logger } from "../../utils/logger";
import { maskSecrets, truncateOutput } from "../utils";
import type { VolumeManager } from "./volume-manager";

export interface ExecutionManagerOptions {
  secrets: Record<string, string>;
  maxOutputSize: number;
}

export class ExecutionManager {
  private readonly secrets: Record<string, string>;
  private readonly maxOutputSize: number;

  constructor(options: ExecutionManagerOptions) {
    this.secrets = options.secrets;
    this.maxOutputSize = options.maxOutputSize;
  }

  wrapWithTimeout(cmd: string[], timeoutSec: number): string[] {
    return ["timeout", "-s", "KILL", String(timeoutSec), ...cmd];
  }

  getInstallCommand(runtime: Runtime, packages: string[]): string[] {
    switch (runtime) {
      case "python":
        return [
          "pip",
          "install",
          "--user",
          "--no-cache-dir",
          "--break-system-packages",
          "--disable-pip-version-check",
          "--retries",
          "0",
          "--timeout",
          "15",
          ...packages,
        ];
      case "node":
        return ["npm", "install", "--prefix", "/sandbox", ...packages];
      case "bun":
        return ["bun", "install", "-g", "--global-dir=/sandbox/.bun-global", ...packages];
      case "agent":
        return ["bun", "install", "-g", "--global-dir=/sandbox/.bun-global", ...packages];
      case "deno":
        return ["sh", "-c", packages.map((p) => `deno cache ${p}`).join(" && ")];
      case "bash":
        return ["apk", "add", "--no-cache", ...packages];
      default:
        throw new Error(`Unknown runtime for package install: ${runtime}`);
    }
  }

  async installPackages(
    container: Docker.Container,
    runtime: Runtime,
    packages: string[],
    timeoutMs: number
  ): Promise<void> {
    const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
    const cmd = this.wrapWithTimeout(this.getInstallCommand(runtime, packages), timeoutSec);
    logger.debug(`Installing packages: ${JSON.stringify(cmd)}`);

    const env: string[] = [
      "PATH=/sandbox/.local/bin:/sandbox/.npm-global/bin:/sandbox/.bun-global/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin",
    ];

    if (runtime === "python") {
      env.push("PYTHONUSERBASE=/sandbox/.local");
    } else if (runtime === "node") {
      env.push("NPM_CONFIG_PREFIX=/sandbox/.npm-global");
      env.push("NPM_CONFIG_CACHE=/sandbox/.npm-cache");
      env.push("npm_config_cache=/sandbox/.npm-cache");
      env.push("NPM_CONFIG_FETCH_RETRIES=0");
      env.push("npm_config_fetch_retries=0");
      env.push("NPM_CONFIG_FETCH_RETRY_MINTIMEOUT=1000");
      env.push("npm_config_fetch_retry_mintimeout=1000");
      env.push("NPM_CONFIG_FETCH_RETRY_MAXTIMEOUT=2000");
      env.push("npm_config_fetch_retry_maxtimeout=2000");
    } else if (runtime === "bun" || runtime === "agent") {
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
      User: runtime === "bash" ? "root" : "sandbox",
    });

    const stream = await exec.start({ Detach: false, Tty: false });

    return new Promise<void>((resolve, reject) => {
      let stderr = "";
      const stdoutStream = new PassThrough();
      const stderrStream = new PassThrough();

      container.modem.demuxStream(stream, stdoutStream, stderrStream);

      stderrStream.on("data", (chunk) => {
        const text = chunk.toString();
        stderr += text;
        logger.debug(`[install:${runtime}:stderr] ${text.trimEnd()}`);
      });

      stdoutStream.on("data", (chunk) => {
        const text = chunk.toString();
        logger.debug(`[install:${runtime}:stdout] ${text.trimEnd()}`);
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

  async *runSetupScript(
    container: Docker.Container,
    script: string,
    timeoutMs: number,
    volumeManager: VolumeManager
  ): AsyncGenerator<StreamEvent> {
    const scriptPath = "/sandbox/.isol8-setup.sh";
    await volumeManager.writeFileViaExec(container, scriptPath, script);

    // chmod +x via exec
    const chmodExec = await container.exec({
      Cmd: ["chmod", "+x", scriptPath],
      User: "sandbox",
    });
    await chmodExec.start({ Detach: true });
    let chmodInfo = await chmodExec.inspect();
    while (chmodInfo.Running) {
      await new Promise((r) => setTimeout(r, 5));
      chmodInfo = await chmodExec.inspect();
    }

    const timeoutSec = Math.max(1, Math.ceil(timeoutMs / 1000));
    const cmd = this.wrapWithTimeout(["bash", scriptPath], timeoutSec);
    logger.debug(`Running setup script: ${JSON.stringify(cmd)}`);

    const env: string[] = [
      "PATH=/sandbox/.local/bin:/sandbox/.npm-global/bin:/sandbox/.bun-global/bin:/usr/local/bin:/usr/bin:/bin:/usr/local/sbin:/usr/sbin:/sbin",
    ];

    const exec = await container.exec({
      Cmd: cmd,
      AttachStdout: true,
      AttachStderr: true,
      Env: env,
      WorkingDir: "/sandbox",
      User: "sandbox",
    });

    const stream = await exec.start({ Detach: false, Tty: false });

    const queue: StreamEvent[] = [];
    let notify: (() => void) | null = null;
    let done = false;

    const push = (event: StreamEvent) => {
      queue.push(event);
      if (notify) {
        notify();
        notify = null;
      }
    };

    const timer = setTimeout(() => {
      push({ type: "error", data: "SETUP SCRIPT TIMED OUT", phase: "setup" });
      push({ type: "exit", data: "137", phase: "setup" });
      done = true;
    }, timeoutMs);

    const stdoutStream = new PassThrough();
    const stderrStream = new PassThrough();

    container.modem.demuxStream(stream, stdoutStream, stderrStream);

    stdoutStream.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      logger.debug(`[setup:stdout] ${text.trimEnd()}`);
      push({ type: "stdout", data: text, phase: "setup" });
    });

    stderrStream.on("data", (chunk: Buffer) => {
      const text = chunk.toString("utf-8");
      logger.debug(`[setup:stderr] ${text.trimEnd()}`);
      push({ type: "stderr", data: text, phase: "setup" });
    });

    stream.on("end", async () => {
      clearTimeout(timer);
      try {
        const info = await exec.inspect();
        const exitCode = info.ExitCode ?? 0;
        if (exitCode !== 0) {
          push({
            type: "error",
            data: `Setup script failed (exit code ${exitCode})`,
            phase: "setup",
          });
        }
        push({ type: "exit", data: exitCode.toString(), phase: "setup" });
      } catch {
        push({ type: "exit", data: "1", phase: "setup" });
      }
      done = true;
    });

    stream.on("error", (err: Error) => {
      clearTimeout(timer);
      push({ type: "error", data: err.message, phase: "setup" });
      push({ type: "exit", data: "1", phase: "setup" });
      done = true;
    });

    while (!done || queue.length > 0) {
      if (queue.length > 0) {
        yield queue.shift()!;
      } else {
        await new Promise<void>((r) => {
          notify = r;
        });
      }
    }
  }

  async *streamExecOutput(
    stream: NodeJS.ReadableStream,
    exec: Docker.Exec,
    container: Docker.Container,
    timeoutMs: number
  ): AsyncGenerator<StreamEvent> {
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
      push({ type: "error", data: "EXECUTION TIMED OUT", phase: "code" });
      push({ type: "exit", data: "137", phase: "code" });
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
      push({ type: "stdout", data: text, phase: "code" });
    });

    stderrStream.on("data", (chunk: Buffer) => {
      let text = chunk.toString("utf-8");
      if (Object.keys(this.secrets).length > 0) {
        text = maskSecrets(text, this.secrets);
      }
      push({ type: "stderr", data: text, phase: "code" });
    });

    stream.on("end", async () => {
      clearTimeout(timer);
      try {
        const info = await exec.inspect();
        push({ type: "exit", data: (info.ExitCode ?? 0).toString(), phase: "code" });
      } catch {
        push({ type: "exit", data: "1", phase: "code" });
      }
      done = true;
    });

    stream.on("error", (err: Error) => {
      clearTimeout(timer);
      push({ type: "error", data: err.message, phase: "code" });
      push({ type: "exit", data: "1", phase: "code" });
      done = true;
    });

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

  async collectExecOutput(
    stream: NodeJS.ReadableStream,
    container: Docker.Container,
    timeoutMs: number
  ): Promise<{ stdout: string; stderr: string; truncated: boolean }> {
    return new Promise((resolve, reject) => {
      let stdout = "";
      let stderr = "";
      let truncated = false;
      let settled = false;
      let stdoutEnded = false;
      let stderrEnded = false;

      const timer = setTimeout(() => {
        if (settled) {
          return;
        }
        settled = true;
        if ((stream as Readable).destroy) {
          (stream as Readable).destroy();
        }
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

      const checkDone = () => {
        if (settled) {
          return;
        }
        if (stdoutEnded && stderrEnded) {
          settled = true;
          clearTimeout(timer);
          resolve({ stdout, stderr, truncated });
        }
      };

      stdoutStream.on("end", () => {
        stdoutEnded = true;
        checkDone();
      });

      stderrStream.on("end", () => {
        stderrEnded = true;
        checkDone();
      });

      stream.on("error", (err: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);
        reject(err);
      });

      stream.on("end", () => {
        if (settled) {
          return;
        }
        setTimeout(() => {
          if (!settled) {
            stdoutEnded = true;
            stderrEnded = true;
            checkDone();
          }
        }, 100);
      });
    });
  }

  postProcessOutput(output: string, _truncated: boolean): string {
    let result = output;
    if (Object.keys(this.secrets).length > 0) {
      result = maskSecrets(result, this.secrets);
    }
    return result.trimEnd();
  }

  buildEnv(
    extra?: Record<string, string>,
    proxyPort?: number,
    networkMode?: string,
    networkFilter?: NetworkFilterConfig
  ): string[] {
    const env: string[] = [
      "PYTHONUNBUFFERED=1",
      "PYTHONUSERBASE=/sandbox/.local",
      "NPM_CONFIG_PREFIX=/sandbox/.npm-global",
      "DENO_DIR=/sandbox/.deno",
      "PATH=/sandbox/.local/bin:/sandbox/.npm-global/bin:/sandbox/.bun-global/bin:/usr/local/bin:/usr/bin:/bin",
      "NODE_PATH=/usr/local/lib/node_modules:/sandbox/.npm-global/lib/node_modules:/sandbox/node_modules",
    ];

    for (const [key, value] of Object.entries(this.secrets)) {
      env.push(`${key}=${value}`);
    }

    if (extra) {
      for (const [key, value] of Object.entries(extra)) {
        env.push(`${key}=${value}`);
      }
    }

    if (networkMode === "filtered") {
      if (networkFilter) {
        env.push(`ISOL8_WHITELIST=${JSON.stringify(networkFilter.whitelist)}`);
        env.push(`ISOL8_BLACKLIST=${JSON.stringify(networkFilter.blacklist)}`);
      }
      if (proxyPort) {
        env.push(`HTTP_PROXY=http://127.0.0.1:${proxyPort}`);
        env.push(`HTTPS_PROXY=http://127.0.0.1:${proxyPort}`);
        env.push(`http_proxy=http://127.0.0.1:${proxyPort}`);
        env.push(`https_proxy=http://127.0.0.1:${proxyPort}`);
      }
    }

    return env;
  }
}
