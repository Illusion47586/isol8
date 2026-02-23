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
| Monorepo | Turborepo |
| Container engine | Docker via `dockerode` |
| HTTP framework | Hono |
| CLI framework | Commander |
| Linter | Biome via ultracite |
| Test runner | `bun:test` |

## Project Structure

```
isol8/
├── packages/
│   └── core/                    # @isol8/core - Engine, runtime, client, config, types
│       ├── src/
│       │   ├── types.ts          # All type definitions
│       │   ├── config.ts         # Config file discovery + loading + defaults
│       │   ├── index.ts          # Public API exports
│       │   ├── runtime/
│       │   │   ├── adapter.ts    # RuntimeAdapter interface + RuntimeRegistry
│       │   │   ├── index.ts      # Barrel file, registers all built-in adapters
│       │   │   └── adapters/     # Python, Node, Bun, Deno, Bash adapters
│       │   ├── engine/
│       │   │   ├── docker.ts     # DockerIsol8 — main sandbox engine
│       │   │   ├── pool.ts       # Warm container pool
│       │   │   ├── utils.ts      # Helpers: memory parsing, tar, truncation, masking
│       │   │   ├── concurrency.ts # Async Semaphore
│       │   │   └── image-builder.ts # Docker image build logic
│       │   ├── client/
│       │   │   └── remote.ts     # RemoteIsol8 HTTP client
│       │   └── utils/
│       │       └── logger.ts     # Centralized logging
│       ├── docker/              # Docker assets (Dockerfile, proxy scripts)
│       ├── schema/              # JSON Schema for config
│       ├── tests/unit/           # Unit tests
│       └── benchmarks/           # Performance benchmarks
├── apps/
│   ├── cli/                    # @isol8/cli - Command-line interface
│   │   ├── src/cli.ts          # CLI entry point
│   │   └── tests/              # Integration and production tests
│   ├── server/                 # @isol8/server - HTTP server
│   │   ├── src/
│   │   │   ├── index.ts        # Hono REST server
│   │   │   ├── standalone.ts   # Entry point for compiled binary
│   │   │   └── auth.ts         # Bearer token auth middleware
│   │   ├── tests/              # Server integration tests
│   │   └── scripts/build.ts    # Server binary build script
│   └── docs/                   # @isol8/docs - Mintlify documentation
│       └── *.mdx               # Documentation pages
├── scripts/                    # CI helper scripts
│   ├── parse-coverage.ts       # LCOV coverage parser
│   └── parse-bench-summary.py  # Benchmark output parser
├── tests/                      # Root test preload
│   └── preload.ts              # Global test cleanup
├── turbo.json                  # Turborepo task configuration
├── biome.json                  # Linter/formatter config
└── package.json                # Workspace root
```

## Key Interfaces

### `Isol8Engine` (packages/core/src/types.ts)
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

### `RuntimeAdapter` (packages/core/src/runtime/adapter.ts)
Each runtime (Python, Node, Bun, Deno, Bash) implements this. Registered in `RuntimeRegistry`.
```typescript
interface RuntimeAdapter {
  readonly name: Runtime;
  readonly image: string;
  getCommand(code: string, filePath?: string): string[];
  getFileExtension(): string;
}
```

## Package Dependencies

| Package | Dependencies |
|---------|--------------|
| `@isol8/core` | dockerode, hono |
| `@isol8/cli` | @isol8/core, commander, ora |
| `@isol8/server` | @isol8/core, hono |
| `@isol8/docs` | mint (dev only) |

## Common Commands

```bash
# Development
bun run dev                  # Run CLI in dev mode
bun run --filter @isol8/cli dev  # Run specific package

# Testing
bun test                     # Run all tests (via turbo)
cd packages/core && bun test tests/unit/  # Run core unit tests
cd apps/cli && bun test tests/integration/  # Run CLI integration tests
cd apps/server && bun test tests/  # Run server tests

# Building
bun run build                # Build all packages (via turbo)
cd packages/core && bun run build  # Build core package
cd apps/cli && bun run build      # Build CLI package
cd apps/server && bun run build   # Build server package

# Linting
bun run lint:check           # Lint check all packages
bun run lint:fix             # Fix lint issues

# Schema
cd packages/core && bun run schema  # Regenerate JSON schema

# Docs
cd apps/docs && bun run dev   # Start docs dev server

# Changesets
bun run changeset            # Create a changeset file for releasable package changes
bun run version-packages     # Apply pending changesets (release workflow step)
```

## Changesets Release Workflow

Use Changesets for all releasable package changes (`@isol8/core`, `@isol8/cli`, `@isol8/server`, `@isol8/docs`).

When to run `bun run changeset`:
- any PR that changes runtime behavior, public API, CLI behavior, or package contents
- bug fixes, features, refactors, or docs changes that affect published package output
- release-trigger commits where a publish must be forced

When not required:
- non-package repo maintenance only (for example local tooling that does not ship in published packages)
- pure CI/infrastructure tweaks that do not change package artifacts

Operational rules:
- prefer `patch` unless introducing a backward-compatible feature (`minor`) or breaking change (`major`)
- keep changeset summary short and user-facing (what changed, not implementation detail)
- commit the generated `.changeset/*.md` file with the PR/branch changes
- do not hand-edit package versions directly; use `changeset version` in release flow
- do not commit temporary publish rewrites for workspace dependencies

## Guidelines for Changes

1. **Types first** — if adding a feature, update `packages/core/src/types.ts` first
2. **Config schema in sync** — if touching `Isol8Config`, run `bun run schema` in packages/core
3. **Tests location**:
   - Unit tests: `packages/core/tests/unit/`
   - Integration tests: `apps/cli/tests/integration/`
   - Server integration tests: `apps/server/tests/`
   - Production tests: `apps/cli/tests/production/`
4. **Runtime adapters** — to add a new runtime, create `packages/core/src/runtime/adapters/<name>.ts`, implement `RuntimeAdapter`, register in `packages/core/src/runtime/index.ts`, and add a Dockerfile stage in `packages/core/docker/Dockerfile`
5. **No external requests in unit tests** — Docker-dependent tests go in `apps/cli/tests/integration/`
6. **Secrets never in output** — use `maskSecrets()` from `packages/core/src/engine/utils.ts`
7. **Error handling** — throw descriptive `Error` objects; the CLI catches and prints with emoji prefixes
8. **Documentation always up-to-date** — before committing, verify and update `README.md`, `.agents/skills/isol8/SKILL.md`, and `apps/docs/` to reflect code changes.
9. **Package imports** — Use `@isol8/core` for core functionality, `@isol8/server` for server-specific code

## Imports Example

```typescript
// In apps/cli or apps/server
import { DockerIsol8, loadConfig, logger, VERSION } from "@isol8/core";
import type { ExecutionRequest, Isol8Options } from "@isol8/core";

// In apps/cli (serve command)
import { createServer } from "@isol8/server";
```

## Turborepo Tasks

Defined in `turbo.json`:
- `build` — bundles all packages, respects dependency order
- `test` — runs tests after build
- `test:prod` — runs production tests after build
- `lint:check` / `lint:fix` — linting
- `schema` — regenerates JSON schema
- `dev` — development mode (persistent, uncached)
