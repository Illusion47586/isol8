---
"@isol8/core": minor
"@isol8/cli": minor
---

Add `cmd` field to `ExecutionRequest` for running arbitrary bash commands in the sandbox.

`cmd` lets users execute bash commands directly inside the sandbox container via `bash -c "<cmd>"`, bypassing the runtime-specific code execution path. It is mutually exclusive with `code` and `codeUrl` — providing more than one is a validation error.

- `ExecutionRequest.cmd?: string` — runs via `bash -c` in all runtimes
- All four execute paths (`executeEphemeral`, `executePersistent`, `executeStreamEphemeral`, `executeStreamPersistent`) handle the `cmd` branch
- CLI gains a `--cmd <command>` flag; defaults runtime to `bash` if not specified
