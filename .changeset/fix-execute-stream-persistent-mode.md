---
"@isol8/core": patch
"@isol8/server": patch
---

Fix `executeStream` to properly support persistent mode and warm container pool.

`executeStream` was always spinning up a brand-new ephemeral container, ignoring both the `mode: "persistent"` setting (so filesystem state was never preserved across streaming calls) and the pre-warmed container pool (so every streaming call paid full cold-start overhead). The server's `/execute/stream` (SSE) and `/execute/ws` (WebSocket) endpoints were also hardcoding `mode: "ephemeral"` and ignoring `sessionId`.

- `executeStream` now dispatches to `executeStreamPersistent` (reuses `this.container`, preserving state) or `executeStreamEphemeral` (acquires from and returns to the warm pool) based on `this.mode`, matching the behaviour of `execute`
- `WsClientMessage` execute variant gains an optional `sessionId` field
- Server `/execute/stream` and `/execute/ws` now support `sessionId` for persistent streaming sessions, consistent with `/execute`
