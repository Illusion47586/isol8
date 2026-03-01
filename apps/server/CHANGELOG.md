# @isol8/server

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

- Updated dependencies [[`2a9498c`](https://github.com/Illusion47586/isol8/commit/2a9498cba662df57b186800c76175eccab7e72e4)]:
  - @isol8/core@0.14.7

## 0.14.6

### Patch Changes

- Updated dependencies []:
  - @isol8/core@0.14.6

## 0.14.5

### Patch Changes

- Updated dependencies []:
  - @isol8/core@0.14.5

## 0.14.4

### Patch Changes

- Updated dependencies []:
  - @isol8/core@0.14.4

## 0.14.3

### Patch Changes

- Updated dependencies []:
  - @isol8/core@0.14.3

## 0.14.2

### Patch Changes

- Updated dependencies []:
  - @isol8/core@0.14.2

## 0.14.1

### Patch Changes

- Updated dependencies [[`e5725f7`](https://github.com/Illusion47586/isol8/commit/e5725f7ae1258699b706f429ffd71d927980c58e)]:
  - @isol8/core@0.14.1
