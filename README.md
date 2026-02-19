# isol8

[![CI](https://github.com/Illusion47586/isol8/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/Illusion47586/isol8/actions/workflows/ci.yml)
[![Coverage](https://raw.githubusercontent.com/Illusion47586/isol8/main/coverage/coverage-badge.svg)](https://github.com/Illusion47586/isol8/actions)
[![npm](https://img.shields.io/npm/v/isol8)](https://www.npmjs.com/package/isol8)
[![license](https://img.shields.io/npm/l/isol8)](./LICENSE)

Secure code execution engine for AI agents. Run untrusted Python, Node.js, Bun, Deno, and Bash code inside locked-down Docker containers with network filtering, resource limits, and output controls.

## Features

- **5 runtimes** — Python, Node.js, Bun, Deno, Bash
- **Ephemeral & persistent** — one-shot execution or stateful REPL-like sessions
- **Streaming** — real-time output via `executeStream()` / SSE
- **Fast** — warm container pool for sub-100ms execution latency
- **Security first** — read-only rootfs, `no-new-privileges`, PID/memory/CPU limits
- **Network control** — `none` (default), `host`, or `filtered` (HTTP/HTTPS proxy with regex whitelist/blacklist)
- **Secure File I/O** — streaming file content avoids process argument leaks
- **File I/O** — upload files into and download files from sandboxes
-   **Runtime packages** — install pip/npm/bun packages on-the-fly (`--install`)
-   **Modern Node.js** — defaults to ESM (`.mjs`), supports CommonJS (`.cjs`)
-   **Secret masking** — environment variables are scrubbed from output
- **Output truncation** — prevents runaway stdout (default 1MB cap)
- **Remote mode** — run an HTTP server and execute from anywhere
- **Embeddable** — use as a TypeScript library in your own project

## Quick Start

```bash
# Install
bun add isol8

# Build sandbox images (requires Docker)
bunx isol8 setup

# Run code
bunx isol8 run -e "print('hello isol8')" --runtime python
bunx isol8 run script.py
echo "console.log(42)" | bunx isol8 run --runtime node
```

## Installation

```bash
bun add isol8
# or
npm install isol8
```

**Prerequisites:**
- [Docker](https://docs.docker.com/get-docker/) running locally
- [Bun](https://bun.sh) (recommended) or Node.js 20+

### Agent Skill

AI agents can install isol8 as a skill for automatic discovery and usage:

```bash
npx skills add Illusion47586/isol8/skill/isol8
```

## CLI

### `isol8 setup`

Checks Docker connectivity and builds base isol8 images.

```bash
isol8 setup
isol8 setup --python numpy,pandas,scipy
isol8 setup --node lodash,axios
```

| Flag | Description |
|------|-------------|
| `--python <pkgs>` | Comma-separated pip packages to bake in |
| `--node <pkgs>` | Comma-separated npm packages to install globally |
| `--bun <pkgs>` | Comma-separated bun packages |
| `--deno <pkgs>` | Comma-separated Deno module URLs to cache |
| `--bash <pkgs>` | Comma-separated Alpine apk packages |
| `--force` | Force rebuild even if images are up to date |

### `isol8 run`

Execute code in isol8. Accepts a file, `--eval`, or stdin.

```bash
# File
isol8 run script.py

# Inline
isol8 run -e "print(1+1)" --runtime python

# Stdin
echo "Bun.version" | isol8 run --runtime bun

# With packages
isol8 run -e "import numpy; print(numpy.__version__)" --install numpy --runtime python

# Remote execution
isol8 run script.py --host http://server:3000 --key my-api-key
```

| Flag | Description | Default |
|------|-------------|---------|
| `-e, --eval <code>` | Execute inline code | — |
| `-r, --runtime <rt>` | Force runtime: `python`, `node`, `bun`, `deno`, `bash` | auto-detect |
| `--net <mode>` | Network mode: `none`, `host`, `filtered` | `none` |
| `--allow <regex>` | Whitelist regex (repeatable, for `filtered`) | — |
| `--deny <regex>` | Blacklist regex (repeatable, for `filtered`) | — |
| `--out <file>` | Write stdout to file | — |
| `--no-stream` | Disable real-time output streaming | `false` |
| `--persistent` | Keep container alive between runs | `false` |
| `--persist` | Keep container after execution for inspection/debugging | `false` |
| `--debug` | Enable debug logging for internal engine operations | `false` |
| `--timeout <ms>` | Execution timeout in milliseconds | `30000` |
| `--memory <limit>` | Memory limit (e.g. `512m`, `1g`) | `512m` |
| `--cpu <limit>` | CPU limit as fraction (e.g. `0.5`, `2.0`) | `1.0` |
| `--image <name>` | Override Docker image | — |
| `--pids-limit <n>` | Maximum number of processes | `64` |
| `--writable` | Disable read-only root filesystem | `false` |
| `--max-output <bytes>` | Maximum output size in bytes | `1048576` |
| `--secret <KEY=VALUE>` | Secret env var (repeatable, values masked) | — |
| `--sandbox-size <size>` | Sandbox tmpfs size (e.g. `512m`, `1g`) | `512m` |
| `--tmp-size <size>` | Tmp tmpfs size (e.g. `256m`, `512m`) | `256m` |
| `--stdin <data>` | Data to pipe to stdin | — |
| `--install <pkg>` | Install package for runtime (repeatable) | — |
| `--url <url>` | Fetch code from URL (requires `remoteCode.enabled=true`) | — |
| `--github <owner/repo/ref/path>` | GitHub shorthand for raw source | — |
| `--gist <gistId/file.ext>` | Gist shorthand for raw source | — |
| `--hash <sha256>` | Verify SHA-256 hash for fetched code | — |
| `--allow-insecure-code-url` | Allow insecure `http://` code URLs for this request | `false` |
| `--host <url>` | Remote server URL | — |
| `--key <key>` | API key for remote server | `$ISOL8_API_KEY` |

### Remote Code URLs

```bash
# URL source
isol8 run --url https://raw.githubusercontent.com/user/repo/main/script.py --runtime python

# GitHub shorthand with hash verification
isol8 run --github user/repo/main/script.py --hash <sha256> --runtime python
```

### `isol8 cleanup`

Remove orphaned isol8 containers, and optionally isol8 images.

```bash
# Interactive (prompts for confirmation)
isol8 cleanup

# Force (skip confirmation)
isol8 cleanup --force

# Also remove isol8 images
isol8 cleanup --images --force
```

### `isol8 serve`

Start the isol8 remote HTTP server. Downloads a pre-compiled standalone binary the first time you run this command (no Bun runtime required).

```bash
isol8 serve --port 3000 --key my-secret-key
isol8 serve --update  # Force re-download the server binary
```

| Flag | Description | Default |
|------|-------------|---------|
| `-p, --port <port>` | Port to listen on | `--port` > `$ISOL8_PORT` > `$PORT` > `3000` |
| `-k, --key <key>` | API key for Bearer token auth | `$ISOL8_API_KEY` |
| `--update` | Force re-download the server binary | `false` |
| `--debug` | Enable debug logging for server operations | `false` |

If the selected port is already in use, `isol8 serve` now prompts to enter another port or auto-select an available one. In non-interactive environments, it auto-falls back to a free port.

### `isol8 config`

Display the resolved configuration (merged defaults + config file). Shows the source file, defaults, network rules, cleanup policy, and dependencies.

```bash
# Formatted output
isol8 config

# Raw JSON (useful for piping)
isol8 config --json
```

## Library Usage

```typescript
import { DockerIsol8, loadConfig } from "isol8";

const isol8 = new DockerIsol8({ network: "none" });
await isol8.start();

const result = await isol8.execute({
  code: 'print("Hello from isol8!")',
  runtime: "python",
  timeoutMs: 10000,
});

console.log(result.stdout);  // "Hello from isol8!"
console.log(result.exitCode); // 0
console.log(result.durationMs); // ~120-140ms (warm pool)

await isol8.stop();

// Optional manual cleanup helpers
await DockerIsol8.cleanup(); // remove isol8 containers
await DockerIsol8.cleanupImages(); // remove isol8 images
```

### Pool Strategy

isol8 supports two pool strategies for container reuse:

```typescript
// Fast mode (default) - best performance
// Uses dual-pool system: clean pool + dirty pool
// Instant acquire from clean pool, immediate cleanup on acquire if needed
// Background cleanup runs every 5 seconds
const fastEngine = new DockerIsol8({
  network: "none",
  poolStrategy: "fast",
  poolSize: { clean: 2, dirty: 2 },  // 2 ready, 2 being cleaned
});

// Secure mode - cleanup in acquire
// Slower but ensures container is always clean before use
const secureEngine = new DockerIsol8({
  network: "none",
  poolStrategy: "secure",
  poolSize: 2,  // 2 warm containers
});
```

**Fast mode details:**
- Maintains two pools: `clean` (ready to use) and `dirty` (need cleanup)
- `acquire()` returns instantly from clean pool if available
- Every clean-pool acquire triggers async replenishment to restore warm capacity
- Simple no-artifact executions use inline runtime commands, skipping code-file injection overhead
- If clean pool is empty but dirty has containers, tries immediate cleanup
- Background cleanup runs every 5 seconds to process dirty containers
- Best performance with minimal memory overhead

### Persistent Sessions

```typescript
const isol8 = new DockerIsol8({ mode: "persistent" });
await isol8.start();

await isol8.execute({ code: "x = 42", runtime: "python" });
const result = await isol8.execute({ code: "print(x)", runtime: "python" });
console.log(result.stdout); // "42"

await isol8.stop();
```

### File I/O

```typescript
await isol8.putFile("/sandbox/data.csv", "name,age\nAlice,30\nBob,25\n");

const result = await isol8.execute({
  code: `
import csv
with open('/sandbox/data.csv') as f:
    for row in csv.reader(f):
        print(row)
  `,
  runtime: "python",
});

const output = await isol8.getFile("/sandbox/output.txt");
```

### Remote Client

```typescript
import { RemoteIsol8 } from "isol8";

const isol8 = new RemoteIsol8(
  { host: "http://localhost:3000", apiKey: "my-key" },
  { network: "none" }
);

await isol8.start();
const result = await isol8.execute({ code: "print('remote!')", runtime: "python" });
await isol8.stop();
```

### Streaming Output

```typescript
import { DockerIsol8 } from "isol8";

const isol8 = new DockerIsol8({ network: "none" });
await isol8.start();

for await (const event of isol8.executeStream({
  code: 'for i in range(5): print(i)',
  runtime: "python",
})) {
  if (event.type === "stdout") process.stdout.write(event.data);
  if (event.type === "stderr") process.stderr.write(event.data);
  if (event.type === "exit") console.log(`\nExit: ${event.data}`);
}

await isol8.stop();
```

### Runtime Package Installation

```typescript
const result = await isol8.execute({
  code: 'import numpy; print(numpy.__version__)',
  runtime: "python",
  installPackages: ["numpy"],
});
```

### Network Filtering

```typescript
const isol8 = new DockerIsol8({
  network: "filtered",
  networkFilter: {
    whitelist: ["^api\\.openai\\.com$", "pypi\\.org"],
    blacklist: [".*\\.ru$"],
  },
});
```

In `filtered` mode, iptables rules are applied at the kernel level to ensure the `sandbox` user can **only** reach the internal filtering proxy (`127.0.0.1:8118`). All other outbound traffic from the sandbox user is dropped, preventing bypass via raw sockets or non-HTTP protocols.

## Configuration

Create `isol8.config.json` in your project root or `~/.isol8/config.json`.

### Editor Setup

Add the `$schema` property to get autocompletion, validation, and inline documentation in VS Code, JetBrains, and any JSON Schema-aware editor:

```json
{
  "$schema": "node_modules/isol8/schema/isol8.config.schema.json"
}
```

### Full Example

```json
{
  "$schema": "node_modules/isol8/schema/isol8.config.schema.json",
  "maxConcurrent": 10,
  "defaults": {
    "timeoutMs": 30000,
    "memoryLimit": "512m",
    "cpuLimit": 1.0,
    "network": "none"
  },
  "network": {
    "whitelist": ["^api\\.openai\\.com$"],
    "blacklist": []
  },
  "cleanup": {
    "autoPrune": true,
    "maxContainerAgeMs": 3600000
  },
  "dependencies": {
    "python": ["numpy", "pandas"],
  "dependencies": {
    "python": ["numpy", "pandas"],
    "node": ["lodash"]
  },
  "security": {
    "seccomp": "strict"
  }
}
```

Full schema: [`schema/isol8.config.schema.json`](./schema/isol8.config.schema.json)

## Benchmarks

Execution latency for a "hello world" script per runtime. Measured on Apple Silicon (OrbStack), averaged across multiple runs. Results will vary by machine.

### Cold Start (fresh engine per run)

Each run creates a new `DockerIsol8` instance, executes, and tears down.

| Runtime | Min | Median | Max | Avg |
|---------|-----|--------|-----|-----|
| Python | 220ms | 280ms | 350ms | 280ms |
| Node.js | 200ms | 250ms | 320ms | 260ms |
| Bun | 180ms | 230ms | 300ms | 230ms |
| Deno | 210ms | 270ms | 340ms | 270ms |
| Bash | 180ms | 220ms | 280ms | 220ms |

### Warm Pool (reused engine)

A single `DockerIsol8` instance reused across 5 runs. The first run is cold (pool empty); subsequent runs hit the warm container pool.

| Runtime | Cold | Warm Avg | Warm Min | Speedup |
|---------|------|----------|----------|---------|
| Python | 300ms | 160ms | 130ms | 2.3x |
| Node.js | 280ms | 170ms | 140ms | 2.0x |
| Bun | 250ms | 155ms | 130ms | 1.9x |
| Deno | 270ms | 160ms | 140ms | 1.9x |
| Bash | 230ms | 145ms | 125ms | 1.8x |

### Execution Phase Breakdown

Where time is spent in the container lifecycle (raw Docker API, no pool):

| Runtime | Create | Start | Write | Exec Setup | Run | Cleanup | Total |
|---------|--------|-------|-------|------------|-----|---------|-------|
| Python | 69ms | 52ms | 19ms | 1ms | 22ms | 51ms | 213ms |
| Node.js | 47ms | 41ms | 15ms | 1ms | 30ms | 36ms | 169ms |
| Bun | 55ms | 42ms | 15ms | 1ms | 18ms | 37ms | 166ms |
| Bash | 50ms | 50ms | 14ms | 1ms | 13ms | 43ms | 172ms |

Run benchmarks yourself:

```bash
bun run bench            # Cold start benchmark
bun run bench:pool       # Warm pool benchmark
bun run bench:detailed   # Phase breakdown
```

## Security Model

| Layer | Protection |
|-------|-----------|
| **Filesystem** | Read-only root, writable `/sandbox` (tmpfs, 512MB, exec allowed), writable `/tmp` (tmpfs, 256MB, noexec) |
| **Processes** | PID limit (default 64), `no-new-privileges`, non-root `sandbox` user, all user processes killed between pool reuses |
| **Resources** | CPU (1 core), memory (512MB), execution timeout (30s) |
| **Network** | Disabled by default; optional proxy-based filtering |
| **Output** | Truncated at 1MB; secrets masked from stdout/stderr |
| **Isolation** | Each execution in its own container (ephemeral) or exec (persistent) |
| **Seccomp** | Default `strict` mode applies the built-in profile that blocks dangerous syscalls (mount, swap, ptrace). In standalone server binaries, an embedded copy is used when profile files are not present. If strict/custom profile loading fails, execution fails. |

### Container Filesystem

Containers use two tmpfs mounts:

1. **`/sandbox`** (default: 512MB, configurable via `--sandbox-size` or config)
   - Working directory for code execution
   - Package installations stored here (`.local`, `.npm-global`, etc.)
   - Allows execution (`exec` flag) for shared libraries like numpy's `.so` files
   - User files and outputs

2. **`/tmp`** (default: 256MB, configurable via `--tmp-size` or config)
   - Temporary files and caches
   - No execution allowed (`noexec` flag) for security
   - Used during package installation

## REST API

When running `isol8 serve`, these endpoints are available:

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/health` | Health check (no auth) |
| `POST` | `/execute` | Execute code |
| `POST` | `/execute/stream` | Execute code with SSE streaming |
| `POST` | `/file` | Upload file (base64) |
| `GET` | `/file?sessionId=&path=` | Download file (base64) |
| `DELETE` | `/session/:id` | Destroy persistent session |

All endpoints (except `/health`) require `Authorization: Bearer <key>`.

## Development

```bash
# Run CLI in dev mode
bun run dev <command>

# Run tests
bun test

# Type check
bunx tsc --noEmit

# Lint
bun run lint

# Build
bun run build              # Bundle CLI for Node.js distribution
bun run build:server       # Compile standalone server binary

# Benchmarks
bun run bench            # Cold start
bun run bench:pool       # Warm pool
bun run bench:detailed   # Phase breakdown
```

## License

MIT
