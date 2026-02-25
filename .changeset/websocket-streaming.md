---
"@isol8/core": minor
"@isol8/server": minor
"@isol8/cli": minor
---

Add WebSocket endpoint for execution streaming alongside existing SSE

Introduces a new `GET /execute/ws` WebSocket endpoint as the preferred method for streaming execution output. The client (`RemoteIsol8`) automatically tries WebSocket first and falls back to SSE for backward compatibility. New `WsClientMessage` and `WsServerMessage` types define the WebSocket protocol.
