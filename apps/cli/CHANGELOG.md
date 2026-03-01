# @isol8/cli

## 0.17.0

### Minor Changes

- [#95](https://github.com/Illusion47586/isol8/pull/95) [`ce0e751`](https://github.com/Illusion47586/isol8/commit/ce0e7510724fc0a8e263c433e1a148af86195a12) Thanks [@Illusion47586](https://github.com/Illusion47586)! - Add named persistent sessions via `--session-id` CLI flag and `isol8 session` subcommand. Named sessions survive CLI exit and can be resumed by passing the same ID. The server gains a `GET /sessions` endpoint for listing active sessions, and `RemoteIsol8` adds `listSessions()` and `deleteSession()` client methods.

### Patch Changes

- Updated dependencies [[`ce0e751`](https://github.com/Illusion47586/isol8/commit/ce0e7510724fc0a8e263c433e1a148af86195a12)]:
  - @isol8/core@0.17.0

## 0.16.0

### Minor Changes

- [#93](https://github.com/Illusion47586/isol8/pull/93) [`3651c4c`](https://github.com/Illusion47586/isol8/commit/3651c4ce8a4e6e53522aee37dc419b46bb769362) Thanks [@Illusion47586](https://github.com/Illusion47586)! - Add database-backed API keys with expiring tokens and CLI login flow. The server now supports dual-mode auth: static `--key` (backward compatible) and SQLite-backed API keys via `--auth-db`. New endpoints `POST /auth/keys`, `GET /auth/keys`, `DELETE /auth/keys/:id`, and `POST /auth/login` enable key management behind master key auth. The CLI gains `isol8 login` and `isol8 logout` commands that store short-lived tokens in `~/.isol8/credentials.json` for seamless authentication.

### Patch Changes

- Updated dependencies [[`3651c4c`](https://github.com/Illusion47586/isol8/commit/3651c4ce8a4e6e53522aee37dc419b46bb769362)]:
  - @isol8/core@0.16.0

## 0.15.0

### Minor Changes

- [#91](https://github.com/Illusion47586/isol8/pull/91) [`5108f80`](https://github.com/Illusion47586/isol8/commit/5108f8057b0178fc5b4ee2a08bbe5cd2ce4403a8) Thanks [@Illusion47586](https://github.com/Illusion47586)! - Add WebSocket endpoint for execution streaming alongside existing SSE

  Introduces a new `GET /execute/ws` WebSocket endpoint as the preferred method for streaming execution output. The client (`RemoteIsol8`) automatically tries WebSocket first and falls back to SSE for backward compatibility. New `WsClientMessage` and `WsServerMessage` types define the WebSocket protocol.

### Patch Changes

- Updated dependencies [[`5108f80`](https://github.com/Illusion47586/isol8/commit/5108f8057b0178fc5b4ee2a08bbe5cd2ce4403a8)]:
  - @isol8/core@0.15.0

## 0.14.7

### Patch Changes

- [`2a9498c`](https://github.com/Illusion47586/isol8/commit/2a9498cba662df57b186800c76175eccab7e72e4) Thanks [@Illusion47586](https://github.com/Illusion47586)! - improve CLI and core package docs/metadata for AI agent usage and feature discoverability

- Updated dependencies [[`2a9498c`](https://github.com/Illusion47586/isol8/commit/2a9498cba662df57b186800c76175eccab7e72e4)]:
  - @isol8/core@0.14.7

## 0.14.6

### Patch Changes

- [`feea82b`](https://github.com/Illusion47586/isol8/commit/feea82b729c7be7930311c79410849794875a326) Thanks [@Illusion47586](https://github.com/Illusion47586)! - fix release packaging to publish CLI with the correct @isol8/core dependency version

- Updated dependencies []:
  - @isol8/core@0.14.6

## 0.14.5

### Patch Changes

- [`56d5424`](https://github.com/Illusion47586/isol8/commit/56d542427b3e96faa3c9f268150639db4079c1cf) Thanks [@Illusion47586](https://github.com/Illusion47586)! - Trigger a patch release for the CLI package.

- Updated dependencies []:
  - @isol8/core@0.14.5

## 0.14.4

### Patch Changes

- [`bb04705`](https://github.com/Illusion47586/isol8/commit/bb04705d7659766cd99fd91b3f4970d17f2a4ad7) Thanks [@Illusion47586](https://github.com/Illusion47586)! - Trigger patch release for CLI package.

- Updated dependencies []:
  - @isol8/core@0.14.4

## 0.14.3

### Patch Changes

- [`6fb1955`](https://github.com/Illusion47586/isol8/commit/6fb1955d7a3eefd96e508ed9b572c21c1c4286dd) Thanks [@Illusion47586](https://github.com/Illusion47586)! - Trigger a patch release from main.

- Updated dependencies []:
  - @isol8/core@0.14.3

## 0.14.2

### Patch Changes

- [`d0247d7`](https://github.com/Illusion47586/isol8/commit/d0247d760461a463ccdd1709ab5def78bd0b79a0) Thanks [@Illusion47586](https://github.com/Illusion47586)! - Publish `@isol8/cli` with a semver dependency on `@isol8/core` instead of `workspace:*` so global installs from npm resolve correctly.

- Updated dependencies []:
  - @isol8/core@0.14.2

## 0.14.1

### Patch Changes

- [#88](https://github.com/Illusion47586/isol8/pull/88) [`e5725f7`](https://github.com/Illusion47586/isol8/commit/e5725f7ae1258699b706f429ffd71d927980c58e) Thanks [@Illusion47586](https://github.com/Illusion47586)! - Migrate release automation to Changesets with direct `isol8-ci` version commits, and add a dedicated PR changeset check workflow.

- Updated dependencies [[`e5725f7`](https://github.com/Illusion47586/isol8/commit/e5725f7ae1258699b706f429ffd71d927980c58e)]:
  - @isol8/core@0.14.1
