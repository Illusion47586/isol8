# AGENTS.md — isol8

> Guide for AI agents/LLMs working on the isol8 codebase.

## Project Overview

**isol8** is a secure code execution engine. It runs untrusted code inside Docker containers with strict resource limits, network controls, and output sanitization. It ships as a TypeScript library, a CLI tool, and a remote HTTP server.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Language | TypeScript (strict mode) |
| Runtime | Bun (primary), Node.js (build target) |
| Package manager | bun |
| Container engine | Docker via `dockerode` |
| HTTP framework | Hono |
| CLI framework | Commander |
| Linter | Biome via ultracite |
| Test runner | `bun:test` |

## Project Structure

```
isol8/
├── src/
│   ├── types.ts              # All type definitions (Sandbox, ExecutionRequest/Result, Config)
│   ├── config.ts             # Config file discovery + loading + defaults
│   ├── index.ts              # Public library API (re-exports)
│   ├── cli.ts                # CLI entry point (setup, run, serve, config, cleanup commands; serve downloads + launches compiled binary)
│   ├── runtime/
│   │   ├── adapter.ts        # RuntimeAdapter interface + RuntimeRegistry
│   │   ├── index.ts          # Barrel file, registers all built-in adapters
│   │   └── adapters/
│   │       ├── python.ts     # Python runtime adapter
│   │       ├── node.ts       # Node.js runtime adapter
│   │       ├── bun.ts        # Bun runtime adapter
│   │       ├── deno.ts       # Deno runtime adapter
│   │       └── bash.ts       # Bash shell adapter
│   ├── engine/
│   │   ├── docker.ts         # DockerIsol8 — main sandbox engine
│   │   ├── pool.ts           # Warm container pool for fast ephemeral execution
│   │   ├── utils.ts          # Helpers: memory parsing, tar, truncation, masking
│   │   ├── concurrency.ts    # Async Semaphore for limiting concurrent containers
│   │   └── image-builder.ts  # Docker image build logic (base + custom)
│   ├── server/
│   │   ├── index.ts          # Hono REST server (execute, file I/O, sessions); exports async createServer()
│   │   ├── standalone.ts     # Entry point for compiled server binary (bun build --compile)
│   │   └── auth.ts           # Bearer token auth middleware
│   └── client/
│       └── remote.ts         # RemoteIsol8 HTTP client
├── docker/
│   ├── Dockerfile            # Multi-stage: base → python/node/bun/deno targets
│   └── proxy.mjs             # HTTP/HTTPS filtering proxy for 'filtered' network mode
├── schema/
│   └── isol8.config.schema.json  # JSON Schema for isol8.config.json
├── tests/
│   ├── unit/                 # Unit tests (bun:test)
│   └── integration/          # Integration tests (require Docker)
├── scripts/
│   ├── build.ts              # Build script (bundles CLI for Node.js)
│   └── build-server.ts       # Build script for standalone server binary (bun build --compile)
├── biome.json                # Linter/formatter config
├── tsconfig.json             # TypeScript config
└── package.json
```

## Key Interfaces

### `Isol8Engine` (src/types.ts)
The core abstraction. Both `DockerIsol8` and `RemoteIsol8` implement it.
```typescript
interface Isol8Engine {
  start(): Promise<void>;
  stop(): Promise<void>;
  execute(req: ExecutionRequest): Promise<ExecutionResult>;
  executeStream(req: ExecutionRequest): AsyncIterable<StreamEvent>;
  putFile(path: string, content: Buffer | string): Promise<void>;
  getFile(path: string): Promise<Buffer>;
}
```

### `ExecutionRequest` / `ExecutionResult`
```typescript
interface ExecutionRequest {
  code: string;
  runtime: "python" | "node" | "bun" | "deno" | "bash";
  timeoutMs?: number;
  env?: Record<string, string>;
  stdin?: string;
  files?: Record<string, string | Buffer>;
  outputPaths?: string[];
  installPackages?: string[];
}

interface ExecutionResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  durationMs: number;
  truncated: boolean;
  executionId: string;
  runtime: Runtime;
  timestamp: string;
  containerId?: string;
  files?: Record<string, string>;
}
```

### `RuntimeAdapter` (src/runtime/adapter.ts)
Each runtime (Python, Node, Bun, Deno, Bash) implements this. Registered in `RuntimeRegistry`.
```typescript
interface RuntimeAdapter {
  readonly name: Runtime;
  readonly image: string;
  getCommand(code: string, filePath?: string): string[];
  getFileExtension(): string;
}
```

## Execution Flow

1. CLI parses args → builds `Isol8Options` + `ExecutionRequest`
2. Creates `DockerIsol8` (local) or `RemoteIsol8` (remote)
3. Calls `engine.start()` → no-op (pool created lazily on first execute)
4. Calls `engine.execute(request)`:
   - **Ephemeral**: acquires warm container from pool → injects code via exec → runs → collects output → returns container to pool (unless `persist: true`)
   - **Persistent**: reuses container → `docker exec` → collects output
5. Output pipeline: collect → truncate → mask secrets → trim
6. Calls `engine.stop()` → kills container (persistent) or drains pool (ephemeral). If `persist: true`, ephemeral containers are **not** cleaned up after execution — they remain running for inspection/debugging.

## Important Patterns

### Concurrency
`Semaphore` in `engine/concurrency.ts` limits concurrent container executions. The limit is set by `maxConcurrent` in config (default: 10).

### Container Pool
`ContainerPool` in `engine/pool.ts` keeps pre-started containers warm for fast ephemeral execution. After use, containers have their `/sandbox` wiped and are returned to the pool. The pool auto-replenishes in the background. This reduces execution latency from ~300ms to ~80ms.

### Streaming
`executeStream()` returns an `AsyncIterable<StreamEvent>` that yields stdout/stderr chunks as they arrive. The server exposes this via `POST /execute/stream` as SSE (Server-Sent Events). Each event is `data: {"type":"stdout"|"stderr"|"exit"|"error", "data":"..."}\n\n`.

### Standalone Server Binary

The `isol8 serve` command has two modes:

1. **Dev mode** (running under Bun): starts the server directly in-process via `Bun.serve()`. Detected by checking `globalThis.Bun`.
2. **Built CLI mode** (running under Node.js): downloads a pre-compiled standalone binary from GitHub Releases to `~/.isol8/bin/isol8-server` and spawns it as a child process. The binary embeds the Bun runtime, so no Bun installation is required.

The binary is compiled with `bun build --compile` (without `--bytecode` — see below) from `src/server/standalone.ts`.

Binaries are named `isol8-server-{os}-{arch}` (e.g. `isol8-server-darwin-arm64`, `isol8-server-linux-x64`). The CLI checks for version updates on every invocation and prompts the user before updating. Use `isol8 serve --update` to force re-download.

### Lazy Imports (Server)

`createServer()` in `src/server/index.ts` is **async** and lazy-imports `DockerIsol8` and runtime adapters via dynamic `await import()`:

```typescript
export async function createServer(options: ServerOptions) {
  const { DockerIsol8 } = await import("../engine/docker");
  await import("../runtime");
  // ...
}
```

Similarly, `src/server/standalone.ts` lazy-imports `createServer` after arg parsing:

```typescript
const { createServer } = await import("./index");
const server = await createServer({ port, apiKey });
```

This avoids eagerly loading `dockerode` and its transitive dependency chain (`ssh2` → `protobufjs` → `long`) at module initialization time. The `long` polyfill crashes on Linux x64 when compiled with `bun build --compile --bytecode`. By deferring imports, `--version` and `--help` always work even if Docker is unavailable.

**Important:** Do NOT add `--bytecode` back to the `bun build --compile` flags in `scripts/build.ts` or `scripts/build-server.ts`. It causes the `Long.fromNumber` crash on Linux.

### Network Filtering
When `network: "filtered"`, containers get bridge networking with `HTTP_PROXY`/`HTTPS_PROXY` env vars pointing to `docker/proxy.mjs`. The proxy checks hostnames against whitelist/blacklist regex patterns.

### Package Installation
When `installPackages` is provided in the execution request, packages are installed to `/sandbox/.local` (Python), `/sandbox/.npm-global` (Node.js), or `/sandbox/.bun-global` (Bun). These directories allow execution of shared libraries (`.so` files) which is required for packages like numpy.

**Important:** Packages install to `/sandbox` (not `/tmp`) because:
- `/tmp` has `noexec` flag preventing `.so` files from loading
- `/sandbox` has `exec` flag allowing native extensions to work
- Default `sandboxSize` is 512MB to accommodate packages like numpy

Environment variables set during execution:
- `PYTHONUSERBASE=/sandbox/.local`
- `NPM_CONFIG_PREFIX=/sandbox/.npm-global`
- `PATH` includes `/sandbox/.local/bin`, `/sandbox/.npm-global/bin`, etc.

### File I/O
Files are transferred as tar archives using the Docker API (`putArchive`/`getArchive`). The tar create/extract logic is in `engine/utils.ts`.

### Container Filesystem
Containers use two tmpfs mounts for security and performance:

1. **`/sandbox`** (default: 512MB, configurable via `sandboxSize`)
   - Working directory for code execution
   - Package installations stored here (`.local`, `.npm-global`, etc.)
   - Allows execution (`exec` flag) for shared libraries
   - User files and outputs

2. **`/tmp`** (default: 256MB, configurable via `tmpSize`)
   - Temporary files and caches
   - No execution allowed (`noexec` flag) for security
   - Used for pip/npm caches during installation

Both sizes can be configured via CLI flags (`--sandbox-size`, `--tmp-size`) or in `isol8.config.json`.

### Logging

All internal/debug logging uses the centralized `Logger` singleton in `src/utils/logger.ts`. The logger has four levels:

- `logger.debug(...)` — Only prints when debug mode is enabled (gated by `logger.setDebug(true)`)
- `logger.info(...)` — Always prints (informational messages)
- `logger.warn(...)` — Always prints with `[WARN]` prefix
- `logger.error(...)` — Always prints with `[ERROR]` prefix

Debug mode is activated by passing `debug: true` in `Isol8Options` (or `--debug` on the CLI). The `DockerIsol8` constructor calls `logger.setDebug(true)` when this option is set. All internal engine logs (pool operations, container lifecycle, persist decisions) use `logger.debug()` so they are silent by default and only visible when debugging.

### Persist vs Cleanup

There are two distinct auto-cleanup mechanisms — do not confuse them:

1. **`Isol8Options.persist`** (engine-level, default `false`): Controls whether containers are cleaned up after each execution. When `false` (default), ephemeral containers are returned to the pool and persistent containers are stopped normally. When `true`, containers are left running after execution for inspection/debugging.

2. **`Isol8Config.cleanup.autoPrune`** (config-level, default `true`): Controls whether the **server** (`isol8 serve`) periodically prunes idle sessions. This is a server-side concern and has no effect on local CLI usage.

### Config Resolution
Config is loaded from (first found wins):
1. `./isol8.config.json` (CWD)
2. `~/.isol8/config.json`
3. Built-in defaults

Partial configs are deep-merged with defaults.

## Common Commands

```bash
# Development
bun run dev <command>       # Run CLI in dev mode
bun test                    # Run all tests
bun test tests/unit/        # Run unit tests only
bunx tsc --noEmit           # Type check
bun run lint                # Lint check

# Building
bun run build               # Bundle CLI for distribution
bun run build:server        # Compile standalone server binary (bun build --compile)
bun run schema              # Regenerate JSON schema from types
```

## Guidelines for Changes

1. **Types first** — if adding a feature, update `src/types.ts` first
2. **Config schema in sync** — if touching `Isol8Config`, run `bun run schema` to update `schema/isol8.config.schema.json`
3. **Tests are in `tests/unit/`** — use `bun:test` (`describe`, `test`, `expect`)
4. **Runtime adapters** — to add a new runtime, create `src/runtime/adapters/<name>.ts`, implement `RuntimeAdapter`, register in `src/runtime/index.ts`, and add a Dockerfile stage in `docker/Dockerfile`
5. **No external requests in unit tests** — Docker-dependent tests go in `tests/integration/`
6. **Secrets never in output** — use `maskSecrets()` from `engine/utils.ts`
7. **Error handling** — throw descriptive `Error` objects; the CLI catches and prints with emoji prefixes
8. **Documentation always up-to-date** — before committing, verify and update `README.md`, `skill/isol8/SKILL.md`, and `docs/` to reflect code changes.
