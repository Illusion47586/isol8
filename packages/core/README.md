# @isol8/core

TypeScript SDK for secure, isolated code execution.

**isol8** is a secure execution system for untrusted code (especially LLM/agent-generated code) using sandboxed Docker containers.

`@isol8/core` is the engine package behind the isol8 CLI and server.

## When To Use

Use this package if you want to:
- embed sandboxed code execution in your own application
- execute untrusted scripts with resource and network controls
- run local Docker-backed sandboxes (`DockerIsol8`)
- call remote isol8 servers (`RemoteIsol8`)

## Key Features

- Supports `python`, `node`, `bun`, `deno`, and `bash`
- Execution modes: ephemeral and persistent
- Streaming execution API (`executeStream`)
- File APIs (`putFile`, `getFile`) for sandbox sessions
- Network control with allow/deny filtering
- Limits for timeout, CPU, memory, PIDs, and output size
- Built-in secret masking/sanitization in execution paths
- Container pooling for faster repeat execution
- Runtime adapter architecture for extensibility
- Config loader + JSON schema export (`@isol8/core/schema`)

## Installation

```bash
npm install @isol8/core
# or
bun add @isol8/core
```

## Quick Start (Local Engine)

```ts
import { DockerIsol8 } from "@isol8/core";

const engine = new DockerIsol8({ network: "none" });
await engine.start();

const result = await engine.execute({
  code: "print('Hello from isol8')",
  runtime: "python",
  timeoutMs: 10_000,
});

console.log(result.stdout);
await engine.stop();
```

## Quick Start (Remote Engine)

```ts
import { RemoteIsol8 } from "@isol8/core";

const remote = new RemoteIsol8(
  { host: "http://localhost:3000", apiKey: "my-api-key" },
  { network: "none" }
);

await remote.start();
const result = await remote.execute({ code: "console.log(42)", runtime: "node" });
await remote.stop();
```

## Agent/Automation Integration Pattern

Use `@isol8/core` when you need programmatic sandbox execution in an agent service:
1. Start engine (`DockerIsol8` or `RemoteIsol8`).
2. Execute untrusted code with explicit runtime/limits.
3. Consume structured result (`stdout`, `stderr`, `exitCode`, `durationMs`).
4. Optionally stream output using `executeStream`.
5. Stop engine during shutdown.

This keeps agent control logic in your app while isol8 enforces sandbox boundaries.

## Main Exports

- `DockerIsol8` - local Docker-backed sandbox engine
- `RemoteIsol8` - HTTP client for remote isol8 server
- `loadConfig` - resolve and load `isol8.config.json`
- `VERSION`, `logger`, runtime and request/response types

## Related Packages

- `@isol8/cli`: command-line interface (`isol8`)
- `@isol8/server`: HTTP server implementation

Full docs: [isol8 documentation](https://isol8.dev)
Project README: [isol8/README.md](https://github.com/Illusion47586/isol8/blob/main/README.md)

## License

MIT - See [LICENSE](https://github.com/Illusion47586/isol8/blob/main/LICENSE)
