# @isol8/cli

Command-line interface for running untrusted code in isolated Docker sandboxes.

`@isol8/cli` installs the `isol8` command.

## When To Use

Use this package if you want to:
- run sandboxed scripts from terminal or CI
- build and manage isol8 runtime images
- start a remote execution server with `isol8 serve`
- inspect resolved config and clean up containers/images

## Key Features

- Sandboxed execution for `python`, `node`, `bun`, `deno`, and `bash`
- Runtime package installs per execution (`--install`)
- Streaming output by default
- Network policies (`none`, `host`, `filtered` + allow/deny rules)
- Persistent execution mode for stateful workflows
- Built-in server launcher (`isol8 serve`) for remote execution

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
