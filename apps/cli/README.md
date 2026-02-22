# @isol8/cli

CLI for isol8 secure code execution.

> **Note**: This package is published as `@isol8/cli` but installs the `isol8` command.

For full documentation, usage examples, and contribution guidelines, see the main [isol8 README](https://github.com/Illusion47586/isol8/blob/main/README.md).

## Installation

```bash
npm install -g @isol8/cli
```

## Quick Start

```bash
# Setup isol8 Docker images
isol8 setup

# Run code
isol8 run -e "print('Hello from isol8!')" -r python

# Start a remote server
isol8 serve --key your-api-key
```

## Commands

- `isol8 setup` - Setup Docker images
- `isol8 run` - Run code in a sandbox
- `isol8 serve` - Start remote execution server
- `isol8 config` - Show configuration

See [CLI Documentation](https://isol8.dev/docs/cli) for full command reference, and [isol8 README](https://github.com/Illusion47586/isol8/blob/main/README.md) for project-wide details.

## License

MIT - See [LICENSE](https://github.com/Illusion47586/isol8/blob/main/LICENSE)
