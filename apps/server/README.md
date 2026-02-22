# @isol8/server

HTTP server for remote `isol8` code execution.

> **Note**: This package is used by the `isol8 serve` command and standalone server builds. It is not intended for direct end-user installation from npm.

For full documentation, architecture, and contribution guidelines, see the main [isol8 README](https://github.com/Illusion47586/isol8/blob/main/README.md).

## What It Provides

- Hono-based HTTP API for remote execution
- Bearer token authentication for all endpoints except `/health`
- Ephemeral and persistent execution sessions
- Streaming execution via SSE
- Graceful shutdown with session/container cleanup

## Local Development

```bash
# From repository root
bun run --filter @isol8/server build
bun run --filter @isol8/server test
```

## Running the Server

```bash
# Via CLI (recommended for most users)
isol8 serve --port 3000 --key my-api-key

# Standalone server binary (built output)
isol8-server --port 3000 --key my-api-key
```

## Related Docs

- [Remote Execution Docs](https://isol8.dev/docs/remote)
- [CLI Reference (`isol8 serve`)](https://isol8.dev/docs/cli)
- [Main Project README](https://github.com/Illusion47586/isol8/blob/main/README.md)

## License

MIT - See [LICENSE](https://github.com/Illusion47586/isol8/blob/main/LICENSE)
