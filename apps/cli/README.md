# @isol8/cli

CLI for isol8 secure code execution.

> **Note**: The `isol8` CLI is deprecated. Use `@isol8/cli` instead.

For full documentation, usage examples, and contribution guidelines, see the main [isol8 README](../README.md).

## Installation

```bash
npm install -g @isol8/cli
```

## Quick Start

```bash
# Setup isol8 Docker images
@isol8/cli setup

# Run code
@isol8/cli run -e "print('Hello from isol8!')" -r python

# Start a remote server
@isol8/cli serve --key your-api-key
```

## Commands

- `@isol8/cli setup` - Setup Docker images
- `@isol8/cli run` - Run code in a sandbox
- `@isol8/cli serve` - Start remote execution server
- `@isol8/cli config` - Show configuration

See [CLI Documentation](https://isol8.dev/docs/cli) for full command reference.

## License

MIT - See [../LICENSE](../LICENSE)
