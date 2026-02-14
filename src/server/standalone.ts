/**
 * @module server/standalone
 *
 * Standalone entry point for the isol8 server binary.
 * Compiled with `bun build --compile` into a self-contained executable
 * that runs anywhere without requiring Bun or Node.js to be installed.
 *
 * Usage:
 *   isol8-server --port 3000 --key my-secret-key
 *   isol8-server --version
 *   isol8-server --help
 */

import { createServer } from "./index";

const VERSION = process.env.ISOL8_VERSION ?? "0.0.0";

// ─── Arg parsing ─────────────────────────────────────────────────────

function parseArgs(argv: string[]): { port: number; apiKey: string } {
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
    console.log("  -p, --port <port>  Port to listen on (default: 3000, or PORT env)");
    console.log("  -k, --key <key>    API key for authentication (or ISOL8_API_KEY env)");
    console.log("  -V, --version      Print version and exit");
    console.log("  -h, --help         Show this help message");
    process.exit(0);
  }

  // Parse flags
  let port = 3000;
  let apiKey: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const next = args[i + 1];

    if ((arg === "--port" || arg === "-p") && next) {
      port = Number.parseInt(next, 10);
      if (Number.isNaN(port)) {
        console.error(`[ERR] Invalid port: ${next}`);
        process.exit(1);
      }
      i++;
    } else if ((arg === "--key" || arg === "-k") && next) {
      apiKey = next;
      i++;
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
    const envPort = process.env.PORT;
    if (envPort) {
      port = Number.parseInt(envPort, 10);
    }
  }

  return { port, apiKey };
}

// ─── Main ────────────────────────────────────────────────────────────

const { port, apiKey } = parseArgs(process.argv);
const server = createServer({ port, apiKey });

console.log(`[INFO] isol8 server v${VERSION} listening on http://localhost:${port}`);
console.log("       Auth: Bearer token required");

Bun.serve({
  fetch: server.app.fetch,
  port,
});
