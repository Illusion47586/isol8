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
│   ├── cli.ts                # CLI entry point (setup, run, serve, config commands)
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
│   │   ├── utils.ts          # Helpers: memory parsing, tar, truncation, masking
│   │   ├── concurrency.ts    # Async Semaphore for limiting concurrent containers
│   │   └── image-builder.ts  # Docker image build logic (base + custom)
│   ├── server/
│   │   ├── index.ts          # Hono REST server (execute, file I/O, sessions)
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
│   └── build.ts              # Build script (bundles CLI for Node.js)
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

1. CLI parses args → builds `SandboxOptions` + `ExecutionRequest`
2. Creates `DockerIsol8` (local) or `RemoteIsol8` (remote)
3. Calls `sandbox.start()` → no-op for ephemeral, lazy for persistent
4. Calls `sandbox.execute(request)`:
   - **Ephemeral**: creates container → injects code via tar → starts → collects output → removes container
   - **Persistent**: reuses container → `docker exec` → collects output
5. Output pipeline: collect → truncate → mask secrets → trim
6. Calls `sandbox.stop()` → kills/removes container

## Important Patterns

### Concurrency
`Semaphore` in `engine/concurrency.ts` limits concurrent container executions. The limit is set by `maxConcurrent` in config (default: 10).

### Network Filtering
When `network: "filtered"`, containers get bridge networking with `HTTP_PROXY`/`HTTPS_PROXY` env vars pointing to `docker/proxy.mjs`. The proxy checks hostnames against whitelist/blacklist regex patterns.

### File I/O
Files are transferred as tar archives using the Docker API (`putArchive`/`getArchive`). The tar create/extract logic is in `engine/utils.ts`.

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
```

## Guidelines for Changes

1. **Types first** — if adding a feature, update `src/types.ts` first
2. **Config schema in sync** — if touching `Isol8Config`, update `schema/isol8.config.schema.json` too
3. **Tests are in `tests/unit/`** — use `bun:test` (`describe`, `test`, `expect`)
4. **Runtime adapters** — to add a new runtime, create `src/runtime/adapters/<name>.ts`, implement `RuntimeAdapter`, register in `src/runtime/index.ts`, and add a Dockerfile stage in `docker/Dockerfile`
5. **No external requests in unit tests** — Docker-dependent tests go in `tests/integration/`
6. **Secrets never in output** — use `maskSecrets()` from `engine/utils.ts`
7. **Error handling** — throw descriptive `Error` objects; the CLI catches and prints with emoji prefixes
