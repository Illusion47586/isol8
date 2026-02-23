# @isol8/cli

Command-line interface for running untrusted code in isolated Docker sandboxes.

**isol8** is a secure execution system for AI agents and developer tooling. It runs untrusted code in disposable or persistent containers with strict runtime, filesystem, and network controls.

`@isol8/cli` installs the `isol8` command.

## When To Use

Use this package if you want to:
- run sandboxed scripts from terminal or CI
- execute LLM/agent-generated code without giving direct host access
- build and manage isol8 runtime images
- start a remote execution server with `isol8 serve`
- inspect resolved config and clean up containers/images

## Key Features

- Sandboxed execution for `python`, `node`, `bun`, `deno`, and `bash`
- Runtime package installs per execution (`--install`)
- Streaming output by default (better for agent feedback loops)
- Network policies (`none`, `host`, `filtered` + allow/deny rules)
- Persistent execution mode for stateful workflows
- Per-run resource controls (timeouts, memory, CPU, output limits via config)
- File input/output support for task-oriented execution
- Built-in server launcher (`isol8 serve`) for remote execution
- Config-first behavior via `isol8.config.json`

## Installation

```bash
npm install -g @isol8/cli
# or
bun install -g @isol8/cli
```

## Quick Start

```bash
# 1) Build required runtime images
isol8 setup

# 2) Run code in a sandbox
isol8 run -e "print('hello')" --runtime python

# 3) Install dependency for one run
isol8 run -e "import numpy; print(numpy.__version__)" --runtime python --install numpy

# 4) Start remote execution server
isol8 serve --port 3000 --key my-api-key
```

## Using isol8 From an AI Agent

`isol8` is designed for agent loops where code is generated, executed, inspected, and retried safely.

Typical pattern:
1. Agent prepares runtime/code/files.
2. Agent runs code in `isol8` sandbox.
3. Agent reads stdout/stderr and exit code.
4. Agent patches code and repeats.

Practical command examples:

```bash
# Fast one-off execution from inline code
isol8 run -e "console.log('agent test')" --runtime node

# Execute a file the agent generated
isol8 run path/to/script.py --runtime python

# Install dependency only for this run
isol8 run -e "import requests; print(requests.__version__)" --runtime python --install requests

# Enforce stricter network policy for untrusted tasks
isol8 run -e "print('offline task')" --runtime python --network none

# Keep a persistent session when agent needs state between runs
isol8 run path/to/stateful_task.py --runtime python --persistent
```

Recommended agent defaults:
- `isol8 setup` once at environment boot
- prefer `--network none` unless external access is required
- set conservative time/resource limits in `isol8.config.json`
- use persistent mode only when task requires shared state

## Common Commands

- `isol8 setup` - build/update runtime images
- `isol8 run` - execute code in isolated container
- `isol8 build` - build custom image with preinstalled packages
- `isol8 serve` - run HTTP server for remote execution
- `isol8 config` - print resolved configuration
- `isol8 cleanup` - remove isol8 containers/images

## Related Packages

- `@isol8/core`: TypeScript SDK for embedding isol8 in apps/services
- `@isol8/server`: server package used by `isol8 serve`

Full docs: [isol8 documentation](https://isol8.dev)
Project README: [isol8/README.md](https://github.com/Illusion47586/isol8/blob/main/README.md)

## License

MIT - See [LICENSE](https://github.com/Illusion47586/isol8/blob/main/LICENSE)
