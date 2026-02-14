# isol8

Secure code execution engine for AI agents. Run untrusted Python, Node.js, Bun, Deno, and Bash code inside locked-down Docker containers with network filtering, resource limits, and output controls.

## Features

- **5 runtimes** — Python, Node.js, Bun, Deno, Bash
- **Ephemeral & persistent** — one-shot execution or stateful REPL-like sessions
- **Streaming** — real-time output via `executeStream()` / SSE
- **Fast** — warm container pool for sub-100ms execution latency
- **Security first** — read-only rootfs, `no-new-privileges`, PID/memory/CPU limits
- **Network control** — `none` (default), `host`, or `filtered` (HTTP/HTTPS proxy with regex whitelist/blacklist)
- **File I/O** — upload files into and download files from sandboxes
- **Runtime packages** — install pip/npm/bun packages on-the-fly via `installPackages`
- **Secret masking** — environment variables are scrubbed from output
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
| `--persistent` | Keep container alive between runs | `false` |
| `--timeout <ms>` | Execution timeout in milliseconds | `30000` |
| `--memory <limit>` | Memory limit (e.g. `512m`, `1g`) | `512m` |
| `--cpu <limit>` | CPU limit as fraction (e.g. `0.5`, `2.0`) | `1.0` |
| `--image <name>` | Override Docker image | — |
| `--pids-limit <n>` | Maximum number of processes | `64` |
| `--writable` | Disable read-only root filesystem | `false` |
| `--max-output <bytes>` | Maximum output size in bytes | `1048576` |
| `--secret <KEY=VALUE>` | Secret env var (repeatable, values masked) | — |
| `--sandbox-size <size>` | Sandbox tmpfs size (e.g. `128m`) | `64m` |
| `--stdin <data>` | Data to pipe to stdin | — |
| `--install <pkg>` | Install package for runtime (repeatable) | — |
| `--host <url>` | Remote server URL | — |
| `--key <key>` | API key for remote server | `$ISOL8_API_KEY` |

### `isol8 serve`

Start the isol8 remote HTTP server. **Requires Bun runtime.**

```bash
isol8 serve --port 3000 --key my-secret-key
```

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
console.log(result.durationMs); // ~55-95ms (warm pool)

await isol8.stop();
```

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
    "node": ["lodash"]
  }
}
```

Full schema: [`schema/isol8.config.schema.json`](./schema/isol8.config.schema.json)

## Benchmarks

Execution latency for a "hello world" script per runtime. Measured on Apple Silicon (Docker Desktop), averaged across multiple runs. Results will vary by machine.

### Cold Start (fresh engine per run)

Each run creates a new `DockerIsol8` instance, executes, and tears down.

| Runtime | Min | Median | Max | Avg |
|---------|-----|--------|-----|-----|
| Python | 148ms | 155ms | 414ms | 239ms |
| Node.js | 152ms | 155ms | 186ms | 165ms |
| Bun | 124ms | 145ms | 260ms | 176ms |
| Deno | 339ms | 372ms | 626ms | 446ms |
| Bash | 115ms | 123ms | 148ms | 128ms |

### Warm Pool (reused engine)

A single `DockerIsol8` instance reused across 5 runs. The first run is cold (pool empty); subsequent runs hit the warm container pool.

| Runtime | Cold | Warm Avg | Warm Min | Speedup |
|---------|------|----------|----------|---------|
| Python | 285ms | 95ms | 89ms | 3.2x |
| Node.js | 177ms | 91ms | 76ms | 2.3x |
| Bun | 157ms | 72ms | 66ms | 2.4x |
| Deno | 330ms | 264ms | 231ms | 1.4x |
| Bash | 222ms | 68ms | 55ms | 4.0x |

### Execution Phase Breakdown

Where time is spent in the container lifecycle (raw Docker API, no pool):

| Runtime | Create | Start | Write | Exec Setup | Run | Cleanup | Total |
|---------|--------|-------|-------|------------|-----|---------|-------|
| Python | 41ms | 49ms | 17ms | 1ms | 40ms | 43ms | 190ms |
| Node.js | 32ms | 63ms | 34ms | 1ms | 39ms | 43ms | 212ms |
| Bun | 32ms | 56ms | 26ms | 1ms | 27ms | 44ms | 186ms |
| Bash | 35ms | 69ms | 23ms | 1ms | 20ms | 48ms | 196ms |

Run benchmarks yourself:

```bash
bun run bench            # Cold start benchmark
bun run bench:pool       # Warm pool benchmark
bun run bench:detailed   # Phase breakdown
```

## Security Model

| Layer | Protection |
|-------|-----------|
| **Filesystem** | Read-only root, writable `/sandbox` (tmpfs, 64MB), writable `/tmp` (tmpfs, noexec, 64MB) |
| **Processes** | PID limit (default 64), `no-new-privileges` |
| **Resources** | CPU (1 core), memory (512MB), execution timeout (30s) |
| **Network** | Disabled by default; optional proxy-based filtering |
| **Output** | Truncated at 1MB; secrets masked from stdout/stderr |
| **Isolation** | Each execution in its own container (ephemeral) or exec (persistent) |

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

# Benchmarks
bun run bench            # Cold start
bun run bench:pool       # Warm pool
bun run bench:detailed   # Phase breakdown
```

## License

MIT
