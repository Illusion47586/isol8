---
"@isol8/core": patch
"@isol8/server": patch
"@isol8/cli": minor
---

Add named persistent sessions via `--session-id` CLI flag and `isol8 session` subcommand. Named sessions survive CLI exit and can be resumed by passing the same ID. The server gains a `GET /sessions` endpoint for listing active sessions, and `RemoteIsol8` adds `listSessions()` and `deleteSession()` client methods.
