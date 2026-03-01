---
"@isol8/core": minor
"@isol8/server": minor
"@isol8/cli": minor
---

Add database-backed API keys with expiring tokens and CLI login flow. The server now supports dual-mode auth: static `--key` (backward compatible) and SQLite-backed API keys via `--auth-db`. New endpoints `POST /auth/keys`, `GET /auth/keys`, `DELETE /auth/keys/:id`, and `POST /auth/login` enable key management behind master key auth. The CLI gains `isol8 login` and `isol8 logout` commands that store short-lived tokens in `~/.isol8/credentials.json` for seamless authentication.
