# @isol8/core

## 0.15.0

### Minor Changes

- [#91](https://github.com/Illusion47586/isol8/pull/91) [`5108f80`](https://github.com/Illusion47586/isol8/commit/5108f8057b0178fc5b4ee2a08bbe5cd2ce4403a8) Thanks [@Illusion47586](https://github.com/Illusion47586)! - Add WebSocket endpoint for execution streaming alongside existing SSE

  Introduces a new `GET /execute/ws` WebSocket endpoint as the preferred method for streaming execution output. The client (`RemoteIsol8`) automatically tries WebSocket first and falls back to SSE for backward compatibility. New `WsClientMessage` and `WsServerMessage` types define the WebSocket protocol.

## 0.14.7

### Patch Changes

- [`2a9498c`](https://github.com/Illusion47586/isol8/commit/2a9498cba662df57b186800c76175eccab7e72e4) Thanks [@Illusion47586](https://github.com/Illusion47586)! - improve CLI and core package docs/metadata for AI agent usage and feature discoverability

## 0.14.6

## 0.14.5

## 0.14.4

## 0.14.3

## 0.14.2

## 0.14.1

### Patch Changes

- [#88](https://github.com/Illusion47586/isol8/pull/88) [`e5725f7`](https://github.com/Illusion47586/isol8/commit/e5725f7ae1258699b706f429ffd71d927980c58e) Thanks [@Illusion47586](https://github.com/Illusion47586)! - Migrate release automation to Changesets with direct `isol8-ci` version commits, and add a dedicated PR changeset check workflow.
