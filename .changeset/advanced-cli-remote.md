---
"@isol8/cli": minor
"@isol8/core": minor
"@isol8/server": minor
---

Add advanced CLI remote features: connection profiles, live logs, process signals, file sync

- `isol8 remote add/remove/list/use` — manage saved remote server profiles stored at `~/.isol8/remotes.json`
- `isol8 logs [--follow] [--lines N]` — stream server logs via SSE
- `isol8 signal <session-id> [--signal SIGTERM]` — send POSIX signals to running containers
- `isol8 sync push/pull` — file sync with persistent remote containers (with `--watch` support)
- `isol8 forward` — port forwarding placeholder (coming soon)
- `isol8 run` now checks for a default remote profile when `--host` is not provided
- Server: new `GET /logs` (SSE) and `POST /session/:id/signal` endpoints
- Client: new `signal()` and `getLogs()` methods on `RemoteIsol8`
