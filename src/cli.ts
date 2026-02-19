#!/usr/bin/env node

import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { arch, homedir, platform } from "node:os";
import { join, resolve } from "node:path";
import { Command } from "commander";
import Docker from "dockerode";
import ora from "ora";
import { RemoteIsol8 } from "./client/remote";
import { loadConfig } from "./config";
import { DockerIsol8 } from "./engine/docker";
import { buildBaseImages, buildCustomImages } from "./engine/image-builder";
// Register all built-in runtime adapters
import { RuntimeRegistry } from "./runtime";
import type { ExecutionRequest, Isol8Engine, Isol8Options, NetworkMode, Runtime } from "./types";
import { logger } from "./utils/logger";
import { VERSION } from "./version";

const program = new Command();

program
  .name("isol8")
  .description("Secure code execution engine")
  .version(VERSION)
  .option("--debug", "Enable debug logging")
  .hook("preAction", (thisCommand) => {
    const opts = thisCommand.optsWithGlobals();
    if (opts.debug) {
      logger.setDebug(true);
    }
    logger.debug(`[CLI] Command: ${thisCommand.args?.[0] ?? thisCommand.name()}`);
    logger.debug(`[CLI] Version: ${VERSION}`);
    logger.debug(`[CLI] Platform: ${platform()} ${arch()}`);
  });

// ─── setup ────────────────────────────────────────────────────────────

program
  .command("setup")
  .description("Check Docker and build isol8 images")
  .option("--python <packages>", "Additional Python packages (comma-separated)")
  .option("--node <packages>", "Additional Node.js packages (comma-separated)")
  .option("--bun <packages>", "Additional Bun packages (comma-separated)")
  .option("--deno <packages>", "Additional Deno packages (comma-separated)")
  .option("--bash <packages>", "Additional Bash packages (comma-separated)")
  .option("--force", "Force rebuild even if images are up to date")
  .action(async (opts) => {
    const docker = new Docker();
    logger.debug("[Setup] Connecting to Docker daemon");

    // Check Docker connection
    const spinner = ora("Checking Docker...").start();
    try {
      await docker.ping();
      spinner.stopAndPersist({ symbol: "[OK]", text: "Docker is running" });
      logger.debug("[Setup] Docker ping successful");
    } catch {
      spinner.stopAndPersist({ symbol: "[ERR]", text: "Docker is not running or not installed." });
      console.error("      Install Docker: https://docs.docker.com/get-docker/");
      console.error("      On macOS: open -a Docker");
      process.exit(1);
    }

    // Build base images
    spinner.start("Building isol8 images...");
    logger.debug(`[Setup] Building base images (force=${opts.force ?? false})`);
    await buildBaseImages(
      docker,
      (progress) => {
        const status =
          progress.status === "error" ? "[ERR]" : progress.status === "done" ? "[OK]" : "[..]";
        if (progress.status === "building") {
          spinner.text = `Building ${progress.runtime}...`;
          logger.debug(`[Setup] Building base image for ${progress.runtime}`);
        } else if (progress.status === "done" || progress.status === "error") {
          logger.debug(
            `[Setup] Base image ${progress.runtime}: ${progress.status}${progress.message ? ` (${progress.message})` : ""}`
          );
          spinner.stopAndPersist({
            symbol: status,
            text: `${progress.runtime}${progress.message ? `: ${progress.message}` : ""}`,
          });
          if (progress.status !== "error") {
            spinner.start();
          }
        }
      },
      opts.force ?? false
    );
    if (spinner.isSpinning) {
      spinner.stop();
    }

    // Build custom images from config or CLI flags
    const config = loadConfig();
    logger.debug("[Setup] Config loaded");

    // Merge CLI flags into config dependencies
    if (opts.python) {
      logger.debug(`[Setup] Adding Python packages from CLI: ${opts.python}`);
      config.dependencies.python = [
        ...(config.dependencies.python ?? []),
        ...opts.python.split(","),
      ];
    }
    if (opts.node) {
      logger.debug(`[Setup] Adding Node.js packages from CLI: ${opts.node}`);
      config.dependencies.node = [...(config.dependencies.node ?? []), ...opts.node.split(",")];
    }
    if (opts.bun) {
      logger.debug(`[Setup] Adding Bun packages from CLI: ${opts.bun}`);
      config.dependencies.bun = [...(config.dependencies.bun ?? []), ...opts.bun.split(",")];
    }
    if (opts.deno) {
      logger.debug(`[Setup] Adding Deno packages from CLI: ${opts.deno}`);
      config.dependencies.deno = [...(config.dependencies.deno ?? []), ...opts.deno.split(",")];
    }
    if (opts.bash) {
      logger.debug(`[Setup] Adding Bash packages from CLI: ${opts.bash}`);
      config.dependencies.bash = [...(config.dependencies.bash ?? []), ...opts.bash.split(",")];
    }

    const hasDeps = Object.values(config.dependencies).some((pkgs) => pkgs && pkgs.length > 0);
    if (hasDeps) {
      logger.debug(
        "[Setup] Building custom images with dependencies:",
        JSON.stringify(config.dependencies)
      );
      spinner.start("Building custom images with dependencies...");
      await buildCustomImages(
        docker,
        config,
        (progress) => {
          const status =
            progress.status === "error" ? "[ERR]" : progress.status === "done" ? "[OK]" : "[..]";
          if (progress.status === "building") {
            spinner.text = `Building custom ${progress.runtime}...`;
            logger.debug(`[Setup] Building custom image for ${progress.runtime}`);
          } else if (progress.status === "done" || progress.status === "error") {
            logger.debug(
              `[Setup] Custom image ${progress.runtime}: ${progress.status}${progress.message ? ` (${progress.message})` : ""}`
            );
            spinner.stopAndPersist({
              symbol: status,
              text: `${progress.runtime}${progress.message ? ` (${progress.message})` : ""}`,
            });
            if (progress.status !== "error") {
              spinner.start();
            }
          }
        },
        opts.force ?? false
      );
      if (spinner.isSpinning) {
        spinner.stop();
      }
    }

    console.log("\n[DONE] Setup complete!");
  });

// ─── run ──────────────────────────────────────────────────────────────

program
  .command("run")
  .description("Execute code in isol8")
  .argument("[file]", "Script file to execute")
  .option("-e, --eval <code>", "Execute inline code string")
  .option("-r, --runtime <name>", "Force runtime (python, node, bun, deno, bash)")
  .option("--net <mode>", "Network mode: none, host, filtered", "none")
  .option("--allow <regex>", "Whitelist regex for filtered mode (repeatable)", collect, [])
  .option("--deny <regex>", "Blacklist regex for filtered mode (repeatable)", collect, [])
  .option("--out <file>", "Write output to file")
  .option("--persistent", "Use persistent container")
  .option("--timeout <ms>", "Execution timeout in milliseconds")
  .option("--memory <limit>", "Memory limit (e.g. 512m, 1g)")
  .option("--cpu <limit>", "CPU limit as fraction (e.g. 0.5, 2.0)")
  .option("--image <name>", "Override Docker image")
  .option("--pids-limit <n>", "Maximum number of processes")
  .option("--writable", "Disable read-only root filesystem")
  .option("--max-output <bytes>", "Maximum output size in bytes")
  .option("--secret <KEY=VALUE>", "Secret env var (repeatable, values masked)", collect, [])
  .option("--sandbox-size <size>", "Sandbox tmpfs size (e.g. 128m, 512m)")
  .option("--tmp-size <size>", "Tmp tmpfs size (e.g. 256m, 512m)")
  .option("--stdin <data>", "Data to pipe to stdin")
  .option("--install <package>", "Install package for runtime (repeatable)", collect, [])
  .option("--url <url>", "Fetch code from URL")
  .option("--github <path>", "GitHub shorthand: owner/repo/ref/path/to/file")
  .option("--gist <path>", "Gist shorthand: gistId/file.ext")
  .option("--hash <sha256>", "Expected SHA-256 hash of fetched code")
  .option("--allow-insecure-code-url", "Allow insecure HTTP code URLs")
  .option("--host <url>", "Execute on remote server")
  .option("--key <key>", "API key for remote server")
  .option("--no-stream", "Disable real-time output streaming") // Default is now streaming
  .option("--debug", "Enable debug logging")
  .option("--persist", "Keep container running after execution for inspection")
  .option("--log-network", "Log all network requests (requires --net filtered)")
  .action(async (file: string | undefined, opts) => {
    const {
      code,
      codeUrl,
      codeHash,
      allowInsecureCodeUrl,
      runtime,
      engineOptions,
      engine,
      stdinData,
      fileExtension,
    } = await resolveRunInput(file, opts);

    logger.debug(`[Run] Runtime: ${runtime}, mode: ${engineOptions.mode}`);
    logger.debug(`[Run] Network: ${engineOptions.network}, timeout: ${engineOptions.timeoutMs}ms`);
    logger.debug(`[Run] Memory: ${engineOptions.memoryLimit}, CPU: ${engineOptions.cpuLimit}`);
    logger.debug(`[Run] Code source: ${codeUrl ? `url=${codeUrl}` : "inline/file/stdin"}`);
    if (code) {
      logger.debug(`[Run] Code length: ${code.length} chars`);
    }
    if (stdinData) {
      logger.debug(`[Run] Stdin data provided (${stdinData.length} chars)`);
    }
    if (opts.install?.length > 0) {
      logger.debug(`[Run] Packages to install: ${opts.install.join(", ")}`);
    }
    if (opts.host) {
      logger.debug(`[Run] Remote execution on ${opts.host}`);
    }
    if (engineOptions.persist) {
      logger.debug("[Run] Persist mode enabled");
    }

    // cleanup on exit
    const cleanup = async () => {
      await engine.stop();
      process.exit(0);
    };
    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    const spinner = ora("Starting execution...").start();
    let exitCode = 0;
    try {
      await engine.start();
      logger.debug("[Run] Engine started");
      spinner.text = "Running code...";

      const req: ExecutionRequest = {
        runtime,
        timeoutMs: engineOptions.timeoutMs,
        ...(code ? { code } : {}),
        ...(codeUrl ? { codeUrl } : {}),
        ...(codeHash ? { codeHash } : {}),
        ...(allowInsecureCodeUrl ? { allowInsecureCodeUrl } : {}),
        ...(stdinData ? { stdin: stdinData } : {}),
        ...(opts.install.length > 0 ? { installPackages: opts.install } : {}),
        fileExtension,
      };

      // Stream by default unless --no-stream is passed
      if (opts.stream !== false) {
        logger.debug("[Run] Using streaming mode");
        spinner.stop(); // Stop spinner for streaming output
        const stream = engine.executeStream(req);
        for await (const event of stream) {
          if (event.type === "stdout") {
            process.stdout.write(event.data);
          } else if (event.type === "stderr") {
            process.stderr.write(event.data);
          } else if (event.type === "exit") {
            if (event.data !== "0") {
              exitCode = Number.parseInt(event.data, 10);
            }
          } else if (event.type === "error") {
            console.error(`[ERR] ${event.data}`);
            exitCode = 1;
          }
        }
      } else {
        logger.debug("[Run] Using non-streaming mode");
        const result = await engine.execute(req);
        logger.debug(
          `[Run] Execution completed: exitCode=${result.exitCode}, duration=${result.durationMs}ms, truncated=${result.truncated}`
        );
        spinner.stop(); // Stop spinner before printing output

        if (result.stdout) {
          console.log(result.stdout);
        }
        if (result.stderr) {
          console.error(result.stderr);
        }
        if (result.truncated) {
          console.error("[WARN] Output was truncated");
        }

        // Print network logs if available
        if (result.networkLogs && result.networkLogs.length > 0) {
          console.error("\n--- Network Logs ---");
          for (const log of result.networkLogs) {
            console.error(JSON.stringify(log));
          }
        }

        // Write output to file if requested
        if (opts.out && result.stdout) {
          writeFileSync(opts.out, result.stdout, "utf-8");
          console.error(`[INFO] Output written to ${opts.out}`);
        }

        if (result.exitCode !== 0) {
          exitCode = result.exitCode;
        }
      }
    } catch (err) {
      spinner.stop();
      throw err;
    } finally {
      // Ensure cleanup happens, but don't hang forever
      logger.debug("[Run] Stopping engine");
      const cleanupPromise = engine.stop();
      const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 5000));

      await Promise.race([cleanupPromise, timeoutPromise]);

      process.off("SIGINT", cleanup);
      process.off("SIGTERM", cleanup);
      process.exit(exitCode);
    }
  });

// ─── serve ────────────────────────────────────────────────────────────

program
  .command("serve")
  .description("Start the isol8 remote server")
  .option("-p, --port <port>", "Port to listen on")
  .option("-k, --key <key>", "API key for authentication")
  .option("--update", "Force re-download the server binary")
  .option("--debug", "Enable debug logging")
  .action(async (opts) => {
    const apiKey = opts.key ?? process.env.ISOL8_API_KEY;
    if (!apiKey) {
      console.error("[ERR] API key required. Use --key or ISOL8_API_KEY env var.");
      process.exit(1);
    }

    const requestedPort = resolveServePort(opts.port);
    const port = await resolveAvailableServePort(requestedPort);
    logger.debug(`[Serve] Requested port: ${requestedPort}`);
    logger.debug(`[Serve] Using port: ${port}`);
    logger.debug(`[Serve] API key: ${"*".repeat(apiKey.length)}`);

    // When running under Bun (e.g. `bun run dev -- serve`), start the server
    // directly in-process. When running under Node.js (the built CLI), download
    // and launch the compiled standalone binary.
    if (typeof globalThis.Bun !== "undefined") {
      logger.debug("[Serve] Running under Bun, starting server in-process");
      const { createServer } = await import("./server/index");
      const server = await createServer({ port, apiKey, debug: opts.debug ?? false });
      let shuttingDown = false;
      const bunServer = Bun.serve({ fetch: server.app.fetch, port });

      const shutdown = async () => {
        if (shuttingDown) {
          return;
        }
        shuttingDown = true;
        logger.info("[Serve] Shutting down server and cleaning up resources...");
        bunServer.stop();
        try {
          await server.shutdown();
          logger.info("[Serve] Cleanup complete");
          process.exit(0);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`[Serve] Cleanup failed: ${message}`);
          process.exit(1);
        }
      };

      process.on("SIGINT", () => {
        shutdown().catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`[Serve] Shutdown handler failed: ${message}`);
        });
      });
      process.on("SIGTERM", () => {
        shutdown().catch((err) => {
          const message = err instanceof Error ? err.message : String(err);
          logger.error(`[Serve] Shutdown handler failed: ${message}`);
        });
      });

      console.log(`[INFO] isol8 server v${VERSION} listening on http://localhost:${port}`);
      console.log("       Auth: Bearer token required");
      return;
    }

    logger.debug("[Serve] Running under Node.js, launching standalone binary");
    const binaryPath = await ensureServerBinary(opts.update ?? false);
    logger.debug(`[Serve] Binary path: ${binaryPath}`);

    // Spawn the server binary
    const { spawn: spawnChild } = await import("node:child_process");
    const binaryArgs = ["--port", String(port), "--key", apiKey];
    if (opts.debug) {
      binaryArgs.push("--debug");
    }
    const child = spawnChild(binaryPath, binaryArgs, {
      stdio: "inherit",
    });

    // Forward signals to child
    const forwardSignal = (signal: NodeJS.Signals) => {
      child.kill(signal);
    };
    process.on("SIGINT", () => forwardSignal("SIGINT"));
    process.on("SIGTERM", () => forwardSignal("SIGTERM"));

    child.on("exit", (code) => {
      process.exit(code ?? 0);
    });
  });

/** Resolve the platform/arch identifier for the server binary download. */
function getServerBinaryName(): string {
  const os = platform();
  const cpu = arch();
  logger.debug(`[Serve] Resolving binary name for ${os}-${cpu}`);

  const osMap: Record<string, string> = {
    darwin: "darwin",
    linux: "linux",
    win32: "windows",
  };

  const archMap: Record<string, string> = {
    arm64: "arm64",
    aarch64: "arm64",
    x64: "x64",
    x86_64: "x64",
  };

  const resolvedOs = osMap[os];
  const resolvedArch = archMap[cpu];

  if (!(resolvedOs && resolvedArch)) {
    console.error(`[ERR] Unsupported platform: ${os}-${cpu}`);
    process.exit(1);
  }

  return `isol8-server-${resolvedOs}-${resolvedArch}`;
}

/** Get the version of an existing server binary, or null if it doesn't exist or fails. */
async function getServerBinaryVersion(binaryPath: string): Promise<string | null> {
  if (!existsSync(binaryPath)) {
    logger.debug(`[Serve] No binary found at ${binaryPath}`);
    return null;
  }
  try {
    const { execFileSync } = await import("node:child_process");
    const output = execFileSync(binaryPath, ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    logger.debug(`[Serve] Existing binary version: ${output.trim()}`);
    return output.trim();
  } catch {
    logger.debug("[Serve] Failed to get binary version");
    return null;
  }
}

/** Download the server binary from GitHub Releases. */
async function downloadServerBinary(binaryPath: string): Promise<void> {
  const binaryName = getServerBinaryName();
  const url = `https://github.com/Illusion47586/isol8/releases/download/v${VERSION}/${binaryName}`;
  logger.debug(`[Serve] Download URL: ${url}`);

  const spinner = ora(`Downloading isol8 server v${VERSION}...`).start();
  try {
    const response = await fetch(url, { redirect: "follow" });

    if (!response.ok) {
      spinner.fail(`Failed to download server binary (HTTP ${response.status})`);
      if (response.status === 404) {
        console.error(`[ERR] No server binary found for v${VERSION} (${binaryName}).`);
        console.error("      Server binaries may not be available for this version yet.");
        console.error(`      URL: ${url}`);
      }
      process.exit(1);
    }

    // Ensure directory exists
    const binDir = join(homedir(), ".isol8", "bin");
    mkdirSync(binDir, { recursive: true });

    // Write to a temp file first, then rename (atomic)
    const tmpPath = `${binaryPath}.tmp`;
    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(tmpPath, buffer);
    chmodSync(tmpPath, 0o755);

    // Rename into place
    renameSync(tmpPath, binaryPath);
    logger.debug(`[Serve] Binary saved to ${binaryPath} (${buffer.length} bytes)`);

    spinner.succeed(`Downloaded isol8 server v${VERSION}`);
  } catch (err) {
    spinner.fail("Failed to download server binary");
    // Clean up temp file if it exists
    const tmpPath = `${binaryPath}.tmp`;
    if (existsSync(tmpPath)) {
      unlinkSync(tmpPath);
    }
    throw err;
  }
}

/** Prompt the user with a Y/n question. Returns true if they answer yes. */
async function promptYesNo(question: string): Promise<boolean> {
  const answer = await promptText(question);
  const normalized = answer.trim().toLowerCase();
  return normalized === "" || normalized === "y" || normalized === "yes";
}

/** Prompt for a single line of input. */
async function promptText(question: string): Promise<string> {
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) => {
    rl.question(question, resolve);
  });
  rl.close();
  return answer;
}

/** Parse and validate a port from any source. */
function parsePort(raw: string, source: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    console.error(`[ERR] Invalid port from ${source}: ${raw}. Expected 1-65535.`);
    process.exit(1);
  }
  return parsed;
}

/** Resolve serve port with precedence: flag > ISOL8_PORT > PORT > 3000. */
function resolveServePort(portFlag?: string): number {
  if (typeof portFlag === "string") {
    return parsePort(portFlag, "--port");
  }
  if (process.env.ISOL8_PORT) {
    return parsePort(process.env.ISOL8_PORT, "ISOL8_PORT");
  }
  if (process.env.PORT) {
    return parsePort(process.env.PORT, "PORT");
  }
  return 3000;
}

/** Check whether a TCP port can be bound. */
async function isPortAvailable(port: number): Promise<boolean> {
  const { createServer } = await import("node:net");
  return await new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => {
      resolve(false);
    });
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

/** Ask the OS for an available ephemeral port. */
async function findAvailablePort(): Promise<number> {
  const { createServer } = await import("node:net");
  return await new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.once("listening", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close(() => reject(new Error("Failed to determine available port")));
        return;
      }
      server.close((closeErr) => {
        if (closeErr) {
          reject(closeErr);
          return;
        }
        resolve(address.port);
      });
    });
    server.listen(0);
  });
}

/** Resolve port conflicts with interactive prompt (TTY) or auto-fallback. */
async function resolveAvailableServePort(port: number): Promise<number> {
  if (await isPortAvailable(port)) {
    return port;
  }

  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    const autoPort = await findAvailablePort();
    console.warn(`[WARN] Port ${port} is in use. Falling back to available port ${autoPort}.`);
    return autoPort;
  }

  let candidate = port;
  while (true) {
    console.warn(`[WARN] Port ${candidate} is already in use.`);
    const choice = (
      await promptText(
        "Choose: [1] Enter another port  [2] Find an available port  [3] Exit (default: 2): "
      )
    )
      .trim()
      .toLowerCase();

    if (choice === "" || choice === "2") {
      const autoPort = await findAvailablePort();
      console.log(`[INFO] Using available port ${autoPort}`);
      return autoPort;
    }

    if (choice === "1") {
      const rawPort = (await promptText("Enter port (1-65535): ")).trim();
      if (!rawPort) {
        continue;
      }

      const parsed = Number(rawPort);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
        console.error(`[ERR] Invalid port: ${rawPort}. Expected 1-65535.`);
        continue;
      }

      candidate = parsed;
      if (await isPortAvailable(candidate)) {
        return candidate;
      }
      continue;
    }

    if (choice === "3") {
      console.error("[ERR] Server startup cancelled.");
      process.exit(1);
    }

    console.error("[ERR] Invalid selection. Enter 1, 2, or 3.");
  }
}

/**
 * Ensure the server binary exists at ~/.isol8/bin/isol8-server with
 * a version matching the CLI. Downloads or updates as needed.
 */
async function ensureServerBinary(forceUpdate: boolean): Promise<string> {
  const binDir = join(homedir(), ".isol8", "bin");
  const binaryPath = join(binDir, "isol8-server");
  logger.debug(`[Serve] Binary path: ${binaryPath}, forceUpdate: ${forceUpdate}`);

  // Force re-download
  if (forceUpdate) {
    logger.debug("[Serve] Force update requested");
    await downloadServerBinary(binaryPath);
    return binaryPath;
  }

  // Check existing binary
  const existingVersion = await getServerBinaryVersion(binaryPath);

  if (existingVersion === null) {
    // No binary found — download
    logger.debug("[Serve] No existing binary, downloading");
    await downloadServerBinary(binaryPath);
    return binaryPath;
  }

  if (existingVersion === VERSION) {
    // Version matches — use as-is
    logger.debug(`[Serve] Binary version ${existingVersion} matches CLI`);
    return binaryPath;
  }

  // Version mismatch — prompt user
  logger.debug(`[Serve] Version mismatch: binary=${existingVersion}, CLI=${VERSION}`);
  console.log(`Server binary v${existingVersion} found, but CLI is v${VERSION}.`);
  const shouldUpdate = await promptYesNo("Download updated binary? [Y/n] ");

  if (shouldUpdate) {
    await downloadServerBinary(binaryPath);
  } else {
    console.warn(`[WARN] Running server v${existingVersion} (CLI is v${VERSION})`);
  }

  return binaryPath;
}

// ─── config ───────────────────────────────────────────────────────────

program
  .command("config")
  .description("Show the resolved isol8 configuration")
  .option("--json", "Output as raw JSON")
  .action((opts) => {
    const config = loadConfig();

    // Determine which config file was loaded
    const searchPaths = [
      join(resolve(process.cwd()), "isol8.config.json"),
      join(homedir(), ".isol8", "config.json"),
    ];
    const loadedFrom = searchPaths.find((p) => existsSync(p));
    logger.debug(`[Config] Config source: ${loadedFrom ?? "defaults"}`);
    logger.debug(`[Config] Resolved config: ${JSON.stringify(config)}`);

    if (opts.json) {
      console.log(JSON.stringify(config, null, 2));
      return;
    }

    console.log("\nIsol8 Configuration\n");

    // Source
    if (loadedFrom) {
      console.log(`  Source: ${loadedFrom}`);
    } else {
      console.log("  Source: defaults (no config file found)");
    }

    // General
    console.log("");
    console.log("  ── General ──");
    console.log(`  Max concurrent:  ${config.maxConcurrent}`);

    // Defaults
    console.log("");
    console.log("  ── Defaults ──");
    console.log(`  Timeout:         ${config.defaults.timeoutMs}ms`);
    console.log(`  Memory limit:    ${config.defaults.memoryLimit}`);
    console.log(`  CPU limit:       ${config.defaults.cpuLimit}`);
    console.log(`  Network:         ${config.defaults.network}`);
    console.log(`  Sandbox size:    ${config.defaults.sandboxSize}`);
    console.log(`  Tmp size:        ${config.defaults.tmpSize}`);

    // Network
    console.log("");
    console.log("  ── Network Filter ──");
    if (config.network.whitelist.length > 0) {
      console.log(`  Whitelist:       ${config.network.whitelist.join(", ")}`);
    } else {
      console.log("  Whitelist:       (none)");
    }

    // Remote code
    console.log("");
    console.log("  ── Remote Code ──");
    console.log(`  Enabled:         ${config.remoteCode.enabled ? "yes" : "no"}`);
    console.log(`  Schemes:         ${config.remoteCode.allowedSchemes.join(", ")}`);
    console.log(`  Max code size:   ${config.remoteCode.maxCodeSize} bytes`);
    console.log(`  Fetch timeout:   ${config.remoteCode.fetchTimeoutMs}ms`);
    console.log(`  Require hash:    ${config.remoteCode.requireHash ? "yes" : "no"}`);
    if (config.network.blacklist.length > 0) {
      console.log(`  Blacklist:       ${config.network.blacklist.join(", ")}`);
    } else {
      console.log("  Blacklist:       (none)");
    }

    // Cleanup
    console.log("");
    console.log("  ── Cleanup ──");
    console.log(`  Auto-prune:      ${config.cleanup.autoPrune ? "yes" : "no"}`);
    console.log(
      `  Max idle time:   ${config.cleanup.maxContainerAgeMs}ms (${Math.round(config.cleanup.maxContainerAgeMs / 60_000)}min)`
    );

    // Pool defaults (used by serve)
    console.log("");
    console.log("  ── Pool Defaults (Serve) ──");
    console.log(`  Pool strategy:   ${config.poolStrategy}`);
    const poolSize =
      typeof config.poolSize === "number"
        ? String(config.poolSize)
        : `${config.poolSize.clean},${config.poolSize.dirty}`;
    console.log(`  Pool size:       ${poolSize}`);

    // Dependencies
    const deps = config.dependencies;
    const hasDeps = Object.values(deps).some((pkgs) => pkgs && pkgs.length > 0);
    console.log("");
    console.log("  ── Dependencies ──");
    if (hasDeps) {
      if (deps.python?.length) {
        console.log(`  Python:          ${deps.python.join(", ")}`);
      }
      if (deps.node?.length) {
        console.log(`  Node:            ${deps.node.join(", ")}`);
      }
      if (deps.bun?.length) {
        console.log(`  Bun:             ${deps.bun.join(", ")}`);
      }
      if (deps.deno?.length) {
        console.log(`  Deno:            ${deps.deno.join(", ")}`);
      }
    } else {
      console.log("  (none configured)");
    }

    console.log("");
  });

// ─── cleanup ──────────────────────────────────────────────────────────

program
  .command("cleanup")
  .description("Remove orphaned isol8 containers (and optionally images)")
  .option("--force", "Skip confirmation prompt")
  .option("--images", "Also remove isol8 Docker images")
  .action(async (opts) => {
    const docker = new Docker();
    logger.debug("[Cleanup] Connecting to Docker daemon");

    // Check Docker connection
    const spinner = ora("Checking Docker...").start();
    try {
      await docker.ping();
      spinner.succeed("Docker is running");
      logger.debug("[Cleanup] Docker ping successful");
    } catch {
      spinner.fail("Docker is not running or not installed.");
      process.exit(1);
    }

    // Find all isol8 containers
    spinner.start("Finding isol8 containers...");
    const containers = await docker.listContainers({ all: true });
    const isol8Containers = containers.filter(
      (c) => c.Image.startsWith("isol8:") || c.Image.startsWith("isol8-custom:")
    );
    logger.debug(
      `[Cleanup] Found ${containers.length} total containers, ${isol8Containers.length} isol8 containers`
    );

    let isol8Images: { id: string; tags: string[] }[] = [];
    if (opts.images) {
      spinner.start("Finding isol8 images...");
      const images = await docker.listImages({ all: true });
      isol8Images = images
        .filter((img) => img.RepoTags?.some((tag) => tag.startsWith("isol8:")))
        .map((img) => ({ id: img.Id, tags: img.RepoTags ?? [] }));
      logger.debug(
        `[Cleanup] Found ${images.length} total images, ${isol8Images.length} isol8 images`
      );
    }

    if (isol8Containers.length === 0 && (!opts.images || isol8Images.length === 0)) {
      spinner.info(
        opts.images ? "No isol8 containers or images found" : "No isol8 containers found"
      );
      return;
    }

    spinner.succeed(
      `Found ${isol8Containers.length} isol8 container(s)` +
        (opts.images ? ` and ${isol8Images.length} image(s)` : "")
    );

    // Show container details
    console.log("");
    for (const c of isol8Containers) {
      const status = c.State === "running" ? "🟢 running" : "⚪ stopped";
      const created = new Date(c.Created * 1000).toLocaleString();
      console.log(`  ${status} ${c.Id.slice(0, 12)} | ${c.Image} | created ${created}`);
    }
    if (opts.images && isol8Images.length > 0) {
      if (isol8Containers.length > 0) {
        console.log("");
      }
      for (const image of isol8Images) {
        const tagText = image.tags.length > 0 ? image.tags.join(", ") : "<untagged>";
        console.log(`  🖼️ image ${image.id.slice(0, 12)} | ${tagText}`);
      }
    }
    console.log("");

    // Confirm deletion
    if (!opts.force) {
      const readline = await import("node:readline");
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      const answer = await new Promise<string>((resolve) => {
        const targetLabel = opts.images ? "containers and images" : "containers";
        rl.question(`Remove all these ${targetLabel}? [y/N] `, resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
        console.log("Cleanup cancelled");
        return;
      }
    }

    // Remove containers using the static cleanup method
    let containerResult = { removed: 0, failed: 0, errors: [] as string[] };
    if (isol8Containers.length > 0) {
      spinner.start("Removing containers...");
      logger.debug("[Cleanup] Removing containers");
      containerResult = await DockerIsol8.cleanup(docker);
      logger.debug(
        `[Cleanup] Containers removed: ${containerResult.removed}, failed: ${containerResult.failed}`
      );
    }

    // Print errors if any
    if (containerResult.errors.length > 0) {
      console.log("");
      for (const err of containerResult.errors) {
        console.error(`  Failed to remove ${err}`);
      }
    }

    if (containerResult.failed === 0) {
      spinner.succeed(`Removed ${containerResult.removed} container(s)`);
    } else {
      spinner.warn(
        `Removed ${containerResult.removed} container(s), ${containerResult.failed} failed`
      );
    }

    if (opts.images && isol8Images.length > 0) {
      spinner.start("Removing images...");
      logger.debug("[Cleanup] Removing images");
      const imageResult = await DockerIsol8.cleanupImages(docker);
      logger.debug(
        `[Cleanup] Images removed: ${imageResult.removed}, failed: ${imageResult.failed}`
      );

      if (imageResult.errors.length > 0) {
        console.log("");
        for (const err of imageResult.errors) {
          console.error(`  Failed to remove image ${err}`);
        }
      }

      if (imageResult.failed === 0) {
        spinner.succeed(`Removed ${imageResult.removed} image(s)`);
      } else {
        spinner.warn(`Removed ${imageResult.removed} image(s), ${imageResult.failed} failed`);
      }
    }
  });

// ─── Helpers ──────────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: commander opts are untyped
async function resolveRunInput(file: string | undefined, opts: any) {
  const config = loadConfig();
  logger.debug("[Run] Config loaded");

  let code: string | undefined;
  let codeUrl: string | undefined;
  let codeHash: string | undefined;
  let allowInsecureCodeUrl = false;
  let runtime: Runtime;

  if (opts.url || opts.github || opts.gist) {
    if (file || opts.eval) {
      console.error("[ERR] --url/--github/--gist cannot be used with file input or --eval.");
      process.exit(1);
    }
    codeUrl = resolveCodeUrl(opts);
    codeHash = opts.hash ?? undefined;
    allowInsecureCodeUrl = opts.allowInsecureCodeUrl ?? false;
    runtime = (opts.runtime ?? detectRuntimeFromPath(new URL(codeUrl).pathname)) as Runtime;
    if (!runtime) {
      console.error("[ERR] Cannot detect runtime from URL path. Use --runtime to specify.");
      process.exit(1);
    }
    logger.debug(`[Run] Remote code URL: ${codeUrl}`);
  } else if (opts.eval) {
    code = opts.eval;
    runtime = (opts.runtime ?? "python") as Runtime;
    logger.debug(`[Run] Inline eval, runtime: ${runtime}`);
  } else if (file) {
    const filePath = resolve(file);
    logger.debug(`[Run] Reading file: ${filePath}`);
    if (!existsSync(filePath)) {
      console.error(`[ERR] File not found: ${file}`);
      process.exit(1);
    }
    code = readFileSync(filePath, "utf-8");
    if (opts.runtime) {
      runtime = opts.runtime as Runtime;
      logger.debug(`[Run] Runtime specified: ${runtime}`);
    } else {
      try {
        runtime = RuntimeRegistry.detect(file).name;
        logger.debug(`[Run] Auto-detected runtime: ${runtime}`);
      } catch {
        console.error(`[ERR] Cannot detect runtime for ${file}. Use --runtime to specify.`);
        process.exit(1);
      }
    }
  } else {
    logger.debug("[Run] Reading code from stdin");
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    code = Buffer.concat(chunks).toString("utf-8");
    runtime = (opts.runtime ?? "python") as Runtime;
  }

  const engineOptions: Isol8Options = {
    mode: opts.persistent ? "persistent" : "ephemeral",
    network: (opts.net ?? config.defaults.network) as NetworkMode,
    networkFilter: {
      whitelist: opts.allow.length > 0 ? opts.allow : config.network.whitelist,
      blacklist: opts.deny.length > 0 ? opts.deny : config.network.blacklist,
    },
    memoryLimit: opts.memory ?? config.defaults.memoryLimit,
    cpuLimit: opts.cpu ? Number.parseFloat(opts.cpu) : config.defaults.cpuLimit,
    timeoutMs: opts.timeout ? Number.parseInt(opts.timeout, 10) : config.defaults.timeoutMs,
    ...(opts.image ? { image: opts.image } : {}),
    ...(opts.pidsLimit ? { pidsLimit: Number.parseInt(opts.pidsLimit, 10) } : {}),
    ...(opts.writable ? { readonlyRootFs: false } : {}),
    ...(opts.maxOutput ? { maxOutputSize: Number.parseInt(opts.maxOutput, 10) } : {}),
    ...(opts.tmpSize ? { tmpSize: opts.tmpSize } : {}),
    debug: opts.debug ?? config.debug,
    persist: opts.persist ?? false,
    ...(opts.logNetwork ? { logNetwork: true } : {}),
    dependencies: config.dependencies,
    remoteCode: config.remoteCode,
  };

  logger.debug(
    `[Run] Engine options: mode=${engineOptions.mode}, network=${engineOptions.network}`
  );

  // Determine file extension from file argument if present
  let fileExtension: string | undefined;
  if (file) {
    const ext = file.substring(file.lastIndexOf("."));
    if (ext) {
      fileExtension = ext;
    }
  }

  // Parse --secret flags into secrets map
  const secrets: Record<string, string> = {};
  for (const s of opts.secret ?? []) {
    const idx = s.indexOf("=");
    if (idx > 0) {
      secrets[s.slice(0, idx)] = s.slice(idx + 1);
    }
  }
  if (Object.keys(secrets).length > 0) {
    engineOptions.secrets = secrets;
  }

  // Resolve stdin data
  const stdinData = opts.stdin ?? undefined;

  let engine: Isol8Engine;
  if (opts.host) {
    logger.debug(`[Run] Using remote engine: ${opts.host}`);
    const apiKey = opts.key ?? process.env.ISOL8_API_KEY;
    if (!apiKey) {
      console.error("[ERR] API key required. Use --key or ISOL8_API_KEY env var.");
      process.exit(1);
    }
    engine = new RemoteIsol8(
      { host: opts.host, apiKey, sessionId: opts.persistent ? `cli-${Date.now()}` : undefined },
      engineOptions
    );
  } else {
    logger.debug("[Run] Using local Docker engine");
    engine = new DockerIsol8(engineOptions, config.maxConcurrent);
  }

  return {
    code,
    codeUrl,
    codeHash,
    allowInsecureCodeUrl,
    runtime,
    engineOptions,
    engine,
    stdinData,
    fileExtension,
  };
}

function resolveCodeUrl(opts: Record<string, unknown>): string {
  if (typeof opts.url === "string") {
    return opts.url;
  }
  if (typeof opts.github === "string") {
    const parts = opts.github.split("/");
    if (parts.length < 4) {
      console.error("[ERR] --github format must be owner/repo/ref/path/to/file");
      process.exit(1);
    }
    const [owner, repo, ref, ...pathParts] = parts;
    return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${pathParts.join("/")}`;
  }
  if (typeof opts.gist === "string") {
    const [gistId, ...fileParts] = opts.gist.split("/");
    if (!gistId || fileParts.length === 0) {
      console.error("[ERR] --gist format must be gistId/file.ext");
      process.exit(1);
    }
    return `https://gist.githubusercontent.com/${gistId}/raw/${fileParts.join("/")}`;
  }
  console.error("[ERR] Missing code URL source.");
  process.exit(1);
}

function detectRuntimeFromPath(pathValue: string): Runtime | undefined {
  try {
    return RuntimeRegistry.detect(pathValue).name;
  } catch {
    return undefined;
  }
}

function collect(value: string, previous: string[]): string[] {
  return previous.concat([value]);
}

// Parse and run
if (!process.argv.slice(2).length) {
  program.outputHelp();
  process.exit(0);
}
program.parse();
