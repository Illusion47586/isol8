/**
 * @module server/standalone
 *
 * Standalone entry point for the isol8 server binary.
 * Compiled with `bun build --compile` into a self-contained executable
 * that runs anywhere without requiring Bun or Node.js to be installed.
 *
 * IMPORTANT: This module must NOT eagerly import the server code or anything
 * that transitively imports `dockerode`. The import chain
 * dockerode → ssh2 → protobufjs → long crashes on Linux when compiled with
 * `bun build --compile --minify`. Server code is lazy-imported ONLY after
 * arg parsing (so --version and --help always work).
 *
 * Usage:
 *   isol8-server --port 3000 --key my-secret-key
 *   isol8-server --version
 *   isol8-server --help
 */

const VERSION = process.env.ISOL8_VERSION ?? "0.0.0";

// ─── Arg parsing ─────────────────────────────────────────────────────

function parsePort(raw: string, source: string): number {
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
    console.error(`[ERR] Invalid port from ${source}: ${raw}. Expected 1-65535.`);
    process.exit(1);
  }
  return parsed;
}

function parseArgs(argv: string[]): { port: number; apiKey: string; debug: boolean } {
  const args = argv.slice(2); // skip binary path + script path

  // Handle --version
  if (args.includes("--version") || args.includes("-V")) {
    console.log(VERSION);
    process.exit(0);
  }

  // Handle --help
  if (args.includes("--help") || args.includes("-h") || args.length === 0) {
    console.log(`isol8-server v${VERSION}`);
    console.log("");
    console.log("Standalone isol8 remote execution server.");
    console.log("");
    console.log("Usage:");
    console.log("  isol8-server --key <api-key> [options]");
    console.log("");
    console.log("Options:");
    console.log("  -p, --port <port>  Port to listen on (default: 3000, or ISOL8_PORT/PORT env)");
    console.log("  -k, --key <key>    API key for authentication (or ISOL8_API_KEY env)");
    console.log("      --debug        Enable debug logging");
    console.log("  -V, --version      Print version and exit");
    console.log("  -h, --help         Show this help message");
    process.exit(0);
  }

  // Parse flags
  let port = 3000;
  let apiKey: string | undefined;
  let debug = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if ((arg === "--port" || arg === "-p") && next) {
      port = parsePort(next, "--port");
      i++;
    } else if ((arg === "--key" || arg === "-k") && next) {
      apiKey = next;
      i++;
    } else if (arg === "--debug") {
      debug = true;
    } else {
      console.error(`[ERR] Unknown argument: ${arg}`);
      process.exit(1);
    }
  }

  // Resolve API key from flag or env
  apiKey = apiKey ?? process.env.ISOL8_API_KEY;
  if (!apiKey) {
    console.error("[ERR] API key required. Use --key or set ISOL8_API_KEY env var.");
    process.exit(1);
  }

  // Resolve port from env if not set via flag
  if (!args.some((a) => a === "--port" || a === "-p")) {
    const envPort = process.env.ISOL8_PORT ?? process.env.PORT;
    if (envPort !== undefined) {
      port = parsePort(envPort, process.env.ISOL8_PORT ? "ISOL8_PORT" : "PORT");
    }
  }

  return { port, apiKey, debug };
}

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

async function isPortAvailable(port: number): Promise<boolean> {
  const { createServer } = await import("node:net");
  return await new Promise<boolean>((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    server.listen(port);
  });
}

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

async function resolveAvailablePort(requestedPort: number): Promise<number> {
  if (await isPortAvailable(requestedPort)) {
    return requestedPort;
  }

  if (!(process.stdin.isTTY && process.stdout.isTTY)) {
    const autoPort = await findAvailablePort();
    console.warn(
      `[WARN] Port ${requestedPort} is in use. Falling back to available port ${autoPort}.`
    );
    return autoPort;
  }

  let candidate = requestedPort;
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
      return await findAvailablePort();
    }

    if (choice === "1") {
      const raw = (await promptText("Enter port (1-65535): ")).trim();
      if (!raw) {
        continue;
      }

      const parsed = Number(raw);
      if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65_535) {
        console.error(`[ERR] Invalid port: ${raw}. Expected 1-65535.`);
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

function isAddrInUseError(err: unknown): boolean {
  if (!err || typeof err !== "object") {
    return false;
  }
  return (err as { code?: string }).code === "EADDRINUSE";
}

// ─── Main ────────────────────────────────────────────────────────────

const { port: requestedPort, apiKey, debug } = parseArgs(process.argv);
let port = await resolveAvailablePort(requestedPort);

// Lazy-import server code AFTER arg parsing to avoid eagerly loading
// dockerode's transitive dependency chain which crashes on Linux.
const { createServer } = await import("./index");
const server = await createServer({ port, apiKey, debug });
let bunServer: ReturnType<typeof Bun.serve> | null = null;
let shuttingDown = false;

const gracefulShutdown = async () => {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  console.log("[INFO] Shutting down isol8 server...");
  try {
    if (bunServer) {
      bunServer.stop();
    }
    await server.shutdown();
    console.log("[INFO] Server cleanup complete");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ERROR] Server shutdown cleanup failed: ${message}`);
  } finally {
    process.exit(0);
  }
};

process.on("SIGINT", () => {
  gracefulShutdown().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ERROR] Shutdown handler failed: ${message}`);
  });
});
process.on("SIGTERM", () => {
  gracefulShutdown().catch((err) => {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[ERROR] Shutdown handler failed: ${message}`);
  });
});

while (true) {
  try {
    bunServer = Bun.serve({
      fetch: server.app.fetch,
      port,
    });
    console.log(`[INFO] isol8 server v${VERSION} listening on http://localhost:${port}`);
    console.log("       Auth: Bearer token required");
    break;
  } catch (err) {
    if (!isAddrInUseError(err)) {
      throw err;
    }

    port = await resolveAvailablePort(port);
    console.warn(`[WARN] Retrying server startup on port ${port}...`);
  }
}
