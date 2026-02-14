---
name: isol8
description: Securely execute untrusted Python, Node.js, Bun, Deno, and Bash code in sandboxed Docker containers.
---

# Isol8 Skill

Isol8 is a secure execution engine for running untrusted code inside Docker containers with strict resource limits, network controls, and output sanitization. Use this skill when you need to execute code, scripts, or system commands in a safe, isolated environment.

## Key Capabilities

- **Runtimes**: Python 3.x, Node.js LTS, Bun, Deno, Bash
- **Isolation**: Docker containers with no network access by default, read-only root filesystem, PID limits, memory/CPU limits, `no-new-privileges` security option
- **Modes**: Ephemeral (one-off, default) or Persistent (session-based with preserved state)
- **Streaming**: Real-time stdout/stderr via `executeStream()` and SSE endpoint
- **Packages**: Install runtime packages on-the-fly via `installPackages` (pip, npm, bun, deno cache, apk)
- **File I/O**: Inject files before execution and retrieve generated files after execution
- **Stdin**: Pipe data to the running process
- **Secrets**: Pass secret env vars that are automatically masked (`***`) in output
- **Performance**: Warm container pool delivers sub-100ms execution latency

## CLI Commands

### `isol8 run [file]`

Execute code in an isolated container. Code can come from a file argument, `--eval`, or stdin (piped input).

**Input resolution order:**
1. `--eval` flag (inline code, defaults to `python` runtime)
2. File argument (runtime auto-detected from extension, or forced with `--runtime`)
3. Stdin (defaults to `python` runtime)

**Extension to runtime mapping:** `.py` → python, `.js` → node, `.ts` → bun, `.mts` → deno, `.sh` → bash

| Option | Description | Default |
|:---|:---|:---|
| `-e, --eval <code>` | Execute inline code string | — |
| `-r, --runtime <name>` | Force runtime: `python`, `node`, `bun`, `deno`, `bash` | auto-detect |
| `--persistent` | Use a persistent container (preserves state between runs) | `false` |
| `--net <mode>` | Network mode: `none`, `host`, `filtered` | `none` |
| `--allow <regex>` | Whitelist regex for `filtered` network mode (repeatable) | `[]` |
| `--deny <regex>` | Blacklist regex for `filtered` network mode (repeatable) | `[]` |
| `--timeout <ms>` | Execution timeout in milliseconds | `30000` |
| `--memory <limit>` | Memory limit (e.g. `256m`, `512m`, `1g`) | `512m` |
| `--cpu <limit>` | CPU limit as fraction of one core (e.g. `0.5`, `2.0`) | `1.0` |
| `--pids-limit <n>` | Maximum number of processes in the container | `64` |
| `--sandbox-size <size>` | Size of `/sandbox` tmpfs mount (e.g. `128m`, `256m`) | `64m` |
| `--max-output <bytes>` | Maximum output size in bytes before truncation | `1048576` (1MB) |
| `--image <name>` | Override Docker image (ignores runtime adapter image) | — |
| `--writable` | Disable read-only root filesystem | `false` |
| `--secret <KEY=VALUE>` | Secret env var injected into container, value masked in output (repeatable) | — |
| `--stdin <data>` | Data to pipe to the process via stdin | — |
| `--install <package>` | Install a package before execution via the runtime's package manager (repeatable) | — |
| `--out <file>` | Write stdout to a local file | — |
| `--host <url>` | Execute on a remote isol8 server instead of local Docker | — |
| `--key <key>` | API key for remote server (or `$ISOL8_API_KEY` env var) | — |

### `isol8 setup`

Check Docker connectivity and build all base `isol8:<runtime>` images. Optionally build custom images with baked-in dependencies.

| Option | Description | Example |
|:---|:---|:---|
| `--python <packages>` | Comma-separated Python packages (pip install) | `--python numpy,pandas` |
| `--node <packages>` | Comma-separated Node.js packages (npm install -g) | `--node lodash,express` |
| `--bun <packages>` | Comma-separated Bun packages (bun install -g) | `--bun zod,hono` |
| `--deno <packages>` | Comma-separated Deno module URLs (deno cache) | `--deno https://deno.land/std/path/mod.ts` |
| `--bash <packages>` | Comma-separated Alpine apk packages | `--bash curl,git,jq` |

Custom images are tagged `isol8:<runtime>-custom` and are automatically preferred over base images when they exist.

### `isol8 serve`

Start the HTTP server for remote code execution. **Requires Bun runtime.**

| Option | Description | Default |
|:---|:---|:---|
| `-p, --port <port>` | Port to listen on | `3000` |
| `-k, --key <key>` | API key for authentication (or `$ISOL8_API_KEY` env var) | Required |

### `isol8 config`

Display the resolved configuration (defaults merged with config file).

| Option | Description |
|:---|:---|
| `--json` | Output raw JSON instead of formatted display |

## CLI Examples

### Python
```bash
# Inline execution
isol8 run -e "print('Hello, world!')" --runtime python

# Run a file (runtime auto-detected from .py extension)
isol8 run script.py

# With package installation
isol8 run -e "import numpy; print(numpy.__version__)" --runtime python --install numpy

# With increased memory
isol8 run script.py --memory 1g
```

### Node.js / Bun / Deno
```bash
# Node.js
isol8 run -e "console.log(process.version)" --runtime node

# Bun (.ts files default to bun; use --runtime deno to force Deno)
isol8 run app.ts

# Deno (.mts files default to deno)
isol8 run handler.mts

# Force Deno for .ts files
isol8 run app.ts --runtime deno
```

### Bash
```bash
# Run a shell command
isol8 run -e "ls -la /sandbox" --runtime bash

# Install system packages
isol8 run -e "jq '.name' package.json" --runtime bash --install jq
```

### Persistent Sessions
```bash
# Run 1: Create a file
isol8 run --persistent -e "echo 'data' > /sandbox/state.txt" --runtime bash

# Run 2: Read it back (same container)
isol8 run --persistent -e "cat /sandbox/state.txt" --runtime bash
```

### Piping and File I/O
```bash
# Pipe code via stdin
echo "print('from stdin')" | isol8 run --runtime python

# Pipe data via --stdin
isol8 run -e "import sys; print(sys.stdin.read().upper())" --runtime python --stdin "hello world"

# Write output to file
isol8 run script.py --out results.json
```

### Network Filtering
```bash
# Allow only specific hosts
isol8 run --net filtered --allow "^api\.openai\.com$" script.py

# Block specific hosts
isol8 run --net filtered --deny ".*\.ru$" script.py

# Full network access (use with caution)
isol8 run --net host script.py
```

### Secrets
```bash
# Secret values are masked as *** in output
isol8 run -e "import os; print(os.environ['API_KEY'])" --runtime python --secret API_KEY=sk-1234
# Output: ***
```

### Remote Execution
```bash
# Execute on a remote isol8 server
isol8 run -e "print('remote')" --runtime python --host http://server:3000 --key my-api-key
```

## Library API

### `DockerIsol8` (Local Engine)

```typescript
import { DockerIsol8 } from "isol8";

const isol8 = new DockerIsol8({
  // All options are optional with sensible defaults
  mode: "ephemeral",        // "ephemeral" | "persistent"
  network: "none",          // "none" | "host" | "filtered"
  networkFilter: {          // Only used when network is "filtered"
    whitelist: [],           // Regex patterns for allowed hostnames
    blacklist: [],           // Regex patterns for blocked hostnames
  },
  memoryLimit: "512m",      // Memory limit string
  cpuLimit: 1.0,            // CPU cores (fraction)
  pidsLimit: 64,            // Max processes
  readonlyRootFs: true,     // Read-only root filesystem
  maxOutputSize: 1048576,   // Max output bytes (1MB)
  secrets: {},              // Secret env vars (values masked in output)
  timeoutMs: 30000,         // Default timeout
  image: undefined,         // Override Docker image
  sandboxSize: "64m",       // /sandbox tmpfs size
  tmpSize: "64m",           // /tmp tmpfs size
});

await isol8.start(); // No-op (containers created lazily)
```

### `ExecutionRequest`

```typescript
const result = await isol8.execute({
  code: 'print("hello")',           // Source code (required)
  runtime: "python",                // "python" | "node" | "bun" | "deno" | "bash" (required)
  timeoutMs: 5000,                  // Override default timeout
  env: { MY_VAR: "value" },        // Additional env vars
  stdin: "input data",             // Data piped to process stdin
  files: {                          // Files injected before execution
    "/sandbox/data.csv": "a,b\n1,2",
    "/sandbox/config.json": Buffer.from('{"key":"val"}'),
  },
  outputPaths: ["/sandbox/out.txt"], // Files to retrieve after execution
  installPackages: ["numpy"],        // Packages to install before execution
});
```

### `ExecutionResult`

```typescript
interface ExecutionResult {
  stdout: string;           // Captured stdout (may be truncated)
  stderr: string;           // Captured stderr
  exitCode: number;         // 0 = success
  durationMs: number;       // Wall-clock execution time
  truncated: boolean;       // Whether stdout was truncated
  executionId: string;      // UUID for this execution
  runtime: Runtime;         // Runtime that was used
  timestamp: string;        // ISO 8601 timestamp
  containerId?: string;     // Docker container ID
  files?: Record<string, string>; // Retrieved files (base64-encoded)
}
```

### Streaming Output

```typescript
for await (const event of isol8.executeStream({
  code: 'for i in range(5): print(i)',
  runtime: "python",
})) {
  // event.type: "stdout" | "stderr" | "exit" | "error"
  // event.data: text content, exit code string, or error message
  if (event.type === "stdout") process.stdout.write(event.data);
  if (event.type === "exit") console.log("Exit code:", event.data);
}
```

### File I/O (Persistent Mode)

```typescript
const isol8 = new DockerIsol8({ mode: "persistent" });
await isol8.start();

// Execute first to create the container
await isol8.execute({ code: "print('init')", runtime: "python" });

// Upload a file
await isol8.putFile("/sandbox/data.csv", "col1,col2\n1,2\n3,4");

// Execute code that reads the file
const result = await isol8.execute({
  code: "with open('/sandbox/data.csv') as f: print(f.read())",
  runtime: "python",
});

// Download a file
const content = await isol8.getFile("/sandbox/data.csv"); // Buffer

await isol8.stop();
```

### `RemoteIsol8` (HTTP Client)

```typescript
import { RemoteIsol8 } from "isol8";

const isol8 = new RemoteIsol8(
  {
    host: "http://localhost:3000",
    apiKey: "secret",
    sessionId: "my-session",  // Optional: enables persistent mode
  },
  { network: "none", memoryLimit: "256m" } // Isol8Options sent to server
);

await isol8.start();  // Hits GET /health
const result = await isol8.execute({ code: "print(1)", runtime: "python" });
await isol8.stop();   // Sends DELETE /session/my-session (if sessionId set)
```

## HTTP Server API

All endpoints except `GET /health` require `Authorization: Bearer <apiKey>`.

### `GET /health`

No authentication required.

**Response:** `{ "status": "ok", "version": "0.1.0" }`

### `POST /execute`

Execute code and return the full result.

**Request body:**
```json
{
  "request": {
    "code": "print('hello')",
    "runtime": "python",
    "timeoutMs": 5000,
    "env": { "MY_VAR": "value" },
    "stdin": "input data",
    "files": { "/sandbox/data.csv": "a,b\n1,2" },
    "outputPaths": ["/sandbox/out.txt"],
    "installPackages": ["numpy"]
  },
  "options": {
    "network": "none",
    "memoryLimit": "512m",
    "cpuLimit": 1.0,
    "timeoutMs": 30000,
    "sandboxSize": "64m",
    "tmpSize": "64m"
  },
  "sessionId": "optional-session-id"
}
```

**Response (success):** `ExecutionResult` JSON

**Response (error):** `{ "error": "message" }` with status 500

### `POST /execute/stream`

Execute code and stream output via Server-Sent Events. Always uses ephemeral mode.

**Request body:** Same as `POST /execute`.

**Response:** SSE stream with `Content-Type: text/event-stream`. Each event:
```
data: {"type":"stdout","data":"Hello\n"}

data: {"type":"stderr","data":"Warning: ..."}

data: {"type":"exit","data":"0"}
```

### `POST /file` (Upload)

Upload a file to a persistent session container.

**Request body:**
```json
{
  "sessionId": "session-id",
  "path": "/sandbox/data.csv",
  "content": "base64-encoded-content"
}
```

**Response:** `{ "ok": true }` or `{ "error": "Session not found" }` (404)

### `GET /file` (Download)

Download a file from a persistent session container.

**Query parameters:** `sessionId`, `path`

**Response:** `{ "content": "base64-encoded-content" }` or error 400/404

### `DELETE /session/:id`

Stop and remove a persistent session. Returns `{ "ok": true }` even if the session didn't exist.

## Configuration

Config is loaded from (first found wins):
1. `./isol8.config.json` (current working directory)
2. `~/.isol8/config.json`

Partial configs are deep-merged with defaults.

```json
{
  "$schema": "./schema/isol8.config.schema.json",
  "maxConcurrent": 10,
  "defaults": {
    "timeoutMs": 30000,
    "memoryLimit": "512m",
    "cpuLimit": 1.0,
    "network": "none",
    "sandboxSize": "64m",
    "tmpSize": "64m"
  },
  "network": {
    "whitelist": [],
    "blacklist": []
  },
  "cleanup": {
    "autoPrune": true,
    "maxContainerAgeMs": 3600000
  },
  "dependencies": {
    "python": ["numpy", "pandas"],
    "node": ["lodash"],
    "bun": [],
    "deno": [],
    "bash": ["jq", "curl"]
  }
}
```

## Troubleshooting

- **"Docker not running"**: Run `isol8 setup` to check status.
- **Timeouts**: Increase `--timeout`. The process is killed on timeout.
- **OOM Killed**: Increase `--memory`.
- **"No space left on device"**: Increase `--sandbox-size` (default 64MB tmpfs).
- **Slow first run**: Expected — container pool warms up on first execution. Subsequent runs are ~80ms.
- **`.ts` files running with Bun instead of Deno**: `.ts` defaults to Bun. Use `--runtime deno` to force Deno, or use `.mts` extension for Deno files.
- **Custom packages not available**: Run `isol8 setup --python numpy,pandas` to bake packages into images. Custom images (`isol8:<runtime>-custom`) are automatically preferred when they exist.
- **Serve command failing**: The `isol8 serve` command requires Bun runtime. Run with `bun run src/cli.ts serve`.
