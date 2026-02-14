#!/usr/bin/env node

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
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

const program = new Command();

program.name("isol8").description("Secure code execution engine").version("0.1.0");

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
  .action(async (opts) => {
    // Check if running under Bun
    const isBun = typeof globalThis.Bun !== "undefined";
    if (!isBun) {
      console.error("[ERR] The serve command requires Bun runtime.");
      console.error("      Install Bun: https://bun.sh");
      console.error("      Then run: bun run src/cli.ts serve");
      process.exit(1);
    }

    const apiKey = opts.key ?? process.env.ISOL8_API_KEY;
    if (!apiKey) {
      console.error("[ERR] API key required. Use --key or ISOL8_API_KEY env var.");
      process.exit(1);
    }

    const port = Number.parseInt(opts.port, 10);

    const { createServer } = await import("./server/index");
    const server = createServer({ port, apiKey });

    console.log(`[INFO] isol8 server listening on http://localhost:${port}`);
    console.log("   Auth: Bearer token required");

    Bun.serve({
      fetch: server.app.fetch,
      port,
    });
  });
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
  };

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
