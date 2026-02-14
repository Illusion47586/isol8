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
import { VERSION } from "./version";

const program = new Command();

program.name("isol8").description("Secure code execution engine").version(VERSION);

// ─── setup ────────────────────────────────────────────────────────────

program
  .command("setup")
  .description("Check Docker and build isol8 images")
  .option("--python <packages>", "Additional Python packages (comma-separated)")
  .option("--node <packages>", "Additional Node.js packages (comma-separated)")
  .option("--bun <packages>", "Additional Bun packages (comma-separated)")
  .option("--deno <packages>", "Additional Deno packages (comma-separated)")
  .option("--bash <packages>", "Additional Bash packages (comma-separated)")
  .action(async (opts) => {
    const docker = new Docker();

    // Check Docker connection
    const spinner = ora("Checking Docker...").start();
    try {
      await docker.ping();
      spinner.stopAndPersist({ symbol: "[OK]", text: "Docker is running" });
    } catch {
      spinner.stopAndPersist({ symbol: "[ERR]", text: "Docker is not running or not installed." });
      console.error("      Install Docker: https://docs.docker.com/get-docker/");
      console.error("      On macOS: open -a Docker");
      process.exit(1);
    }

    // Build base images
    spinner.start("Building isol8 images...");
    await buildBaseImages(docker, (progress) => {
      const status =
        progress.status === "error" ? "[ERR]" : progress.status === "done" ? "[OK]" : "[..]";
      if (progress.status === "building") {
        spinner.text = `Building ${progress.runtime}...`;
      } else if (progress.status === "done" || progress.status === "error") {
        spinner.stopAndPersist({
          symbol: status,
          text: `${progress.runtime}${progress.message ? `: ${progress.message}` : ""}`,
        });
        if (progress.status !== "error") {
          spinner.start();
        }
      }
    });
    if (spinner.isSpinning) {
      spinner.stop();
    }

    // Build custom images from config or CLI flags
    const config = loadConfig();

    // Merge CLI flags into config dependencies
    if (opts.python) {
      config.dependencies.python = [
        ...(config.dependencies.python ?? []),
        ...opts.python.split(","),
      ];
    }
    if (opts.node) {
      config.dependencies.node = [...(config.dependencies.node ?? []), ...opts.node.split(",")];
    }
    if (opts.bun) {
      config.dependencies.bun = [...(config.dependencies.bun ?? []), ...opts.bun.split(",")];
    }
    if (opts.deno) {
      config.dependencies.deno = [...(config.dependencies.deno ?? []), ...opts.deno.split(",")];
    }
    if (opts.bash) {
      config.dependencies.bash = [...(config.dependencies.bash ?? []), ...opts.bash.split(",")];
    }

    const hasDeps = Object.values(config.dependencies).some((pkgs) => pkgs && pkgs.length > 0);
    if (hasDeps) {
      spinner.start("Building custom images with dependencies...");
      await buildCustomImages(docker, config, (progress) => {
        const status =
          progress.status === "error" ? "[ERR]" : progress.status === "done" ? "[OK]" : "[..]";
        if (progress.status === "building") {
          spinner.text = `Building custom ${progress.runtime}...`;
        } else if (progress.status === "done" || progress.status === "error") {
          spinner.stopAndPersist({
            symbol: status,
            text: `${progress.runtime}${progress.message ? ` (${progress.message})` : ""}`,
          });
          if (progress.status !== "error") {
            spinner.start();
          }
        }
      });
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
  .option("--sandbox-size <size>", "Sandbox tmpfs size (e.g. 128m)")
  .option("--tmp-size <size>", "Tmp tmpfs size (e.g. 256m, 512m)")
  .option("--stdin <data>", "Data to pipe to stdin")
  .option("--install <package>", "Install package for runtime (repeatable)", collect, [])
  .option("--host <url>", "Execute on remote server")
  .option("--key <key>", "API key for remote server")
  .option("--no-stream", "Disable real-time output streaming") // Default is now streaming
  .option("--debug", "Enable debug logging")
  .option("--persist", "Keep container running after execution for inspection")
  .action(async (file: string | undefined, opts) => {
    const { code, runtime, engineOptions, engine, stdinData, fileExtension } =
      await resolveRunInput(file, opts);

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
      spinner.text = "Running code...";

      const req: ExecutionRequest = {
        code,
        runtime,
        timeoutMs: engineOptions.timeoutMs,
        ...(stdinData ? { stdin: stdinData } : {}),
        ...(opts.install.length > 0 ? { installPackages: opts.install } : {}),
        fileExtension,
      };

      // Stream by default unless --no-stream is passed
      if (opts.stream !== false) {
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
        const result = await engine.execute(req);
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
  .option("-p, --port <port>", "Port to listen on", "3000")
  .option("-k, --key <key>", "API key for authentication")
  .option("--update", "Force re-download the server binary")
  .action(async (opts) => {
    const apiKey = opts.key ?? process.env.ISOL8_API_KEY;
    if (!apiKey) {
      console.error("[ERR] API key required. Use --key or ISOL8_API_KEY env var.");
      process.exit(1);
    }

    const port = Number.parseInt(opts.port, 10);

    // When running under Bun (e.g. `bun run dev -- serve`), start the server
    // directly in-process. When running under Node.js (the built CLI), download
    // and launch the compiled standalone binary.
    if (typeof globalThis.Bun !== "undefined") {
      const { createServer } = await import("./server/index");
      const server = await createServer({ port, apiKey });
      console.log(`[INFO] isol8 server v${VERSION} listening on http://localhost:${port}`);
      console.log("       Auth: Bearer token required");
      Bun.serve({ fetch: server.app.fetch, port });
      return;
    }

    const binaryPath = await ensureServerBinary(opts.update ?? false);

    // Spawn the server binary
    const { spawn: spawnChild } = await import("node:child_process");
    const child = spawnChild(binaryPath, ["--port", String(port), "--key", apiKey], {
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
    return null;
  }
  try {
    const { execFileSync } = await import("node:child_process");
    const output = execFileSync(binaryPath, ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
    });
    return output.trim();
  } catch {
    return null;
  }
}

/** Download the server binary from GitHub Releases. */
async function downloadServerBinary(binaryPath: string): Promise<void> {
  const binaryName = getServerBinaryName();
  const url = `https://github.com/Illusion47586/isol8/releases/download/v${VERSION}/${binaryName}`;

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
  const readline = await import("node:readline");
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await new Promise<string>((resolve) => {
    rl.question(question, resolve);
  });
  rl.close();
  const normalized = answer.trim().toLowerCase();
  return normalized === "" || normalized === "y" || normalized === "yes";
}

/**
 * Ensure the server binary exists at ~/.isol8/bin/isol8-server with
 * a version matching the CLI. Downloads or updates as needed.
 */
async function ensureServerBinary(forceUpdate: boolean): Promise<string> {
  const binDir = join(homedir(), ".isol8", "bin");
  const binaryPath = join(binDir, "isol8-server");

  // Force re-download
  if (forceUpdate) {
    await downloadServerBinary(binaryPath);
    return binaryPath;
  }

  // Check existing binary
  const existingVersion = await getServerBinaryVersion(binaryPath);

  if (existingVersion === null) {
    // No binary found — download
    await downloadServerBinary(binaryPath);
    return binaryPath;
  }

  if (existingVersion === VERSION) {
    // Version matches — use as-is
    return binaryPath;
  }

  // Version mismatch — prompt user
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
  .description("Remove orphaned isol8 containers")
  .option("--force", "Skip confirmation prompt")
  .action(async (opts) => {
    const docker = new Docker();

    // Check Docker connection
    const spinner = ora("Checking Docker...").start();
    try {
      await docker.ping();
      spinner.succeed("Docker is running");
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

    if (isol8Containers.length === 0) {
      spinner.info("No isol8 containers found");
      return;
    }

    spinner.succeed(`Found ${isol8Containers.length} isol8 container(s)`);

    // Show container details
    console.log("");
    for (const c of isol8Containers) {
      const status = c.State === "running" ? "🟢 running" : "⚪ stopped";
      const created = new Date(c.Created * 1000).toLocaleString();
      console.log(`  ${status} ${c.Id.slice(0, 12)} | ${c.Image} | created ${created}`);
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
        rl.question("Remove all these containers? [y/N] ", resolve);
      });
      rl.close();

      if (answer.toLowerCase() !== "y" && answer.toLowerCase() !== "yes") {
        console.log("Cleanup cancelled");
        return;
      }
    }

    // Remove containers using the static cleanup method
    spinner.start("Removing containers...");
    const result = await DockerIsol8.cleanup(docker);

    // Print errors if any
    if (result.errors.length > 0) {
      console.log("");
      for (const err of result.errors) {
        console.error(`  Failed to remove ${err}`);
      }
    }

    if (result.failed === 0) {
      spinner.succeed(`Removed ${result.removed} container(s)`);
    } else {
      spinner.warn(`Removed ${result.removed} container(s), ${result.failed} failed`);
    }
  });

// ─── Helpers ──────────────────────────────────────────────────────────

// biome-ignore lint/suspicious/noExplicitAny: commander opts are untyped
async function resolveRunInput(file: string | undefined, opts: any) {
  const config = loadConfig();

  let code: string;
  let runtime: Runtime;

  if (opts.eval) {
    code = opts.eval;
    runtime = (opts.runtime ?? "python") as Runtime;
  } else if (file) {
    const filePath = resolve(file);
    if (!existsSync(filePath)) {
      console.error(`[ERR] File not found: ${file}`);
      process.exit(1);
    }
    code = readFileSync(filePath, "utf-8");
    if (opts.runtime) {
      runtime = opts.runtime as Runtime;
    } else {
      try {
        runtime = RuntimeRegistry.detect(file).name;
      } catch {
        console.error(`[ERR] Cannot detect runtime for ${file}. Use --runtime to specify.`);
        process.exit(1);
      }
    }
  } else {
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
  };

  // Configure global logger if debug enabled
  if (engineOptions.debug) {
    const { logger } = await import("./utils/logger");
    logger.setDebug(true);
  }

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
    engine = new DockerIsol8(engineOptions, config.maxConcurrent);
  }

  return { code, runtime, engineOptions, engine, stdinData, fileExtension };
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
