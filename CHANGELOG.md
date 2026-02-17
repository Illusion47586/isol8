# [0.9.0](https://github.com/Illusion47586/isol8/compare/v0.8.3...v0.9.0) (2026-02-17)


### Features

* Add execution audit logs and provenance tracking ([#41](https://github.com/Illusion47586/isol8/issues/41)) ([527061b](https://github.com/Illusion47586/isol8/commit/527061b837b41bb4aaca0ee7808017b938627a4c)), closes [#9](https://github.com/Illusion47586/isol8/issues/9) [#9](https://github.com/Illusion47586/isol8/issues/9) [#9](https://github.com/Illusion47586/isol8/issues/9) [#9](https://github.com/Illusion47586/isol8/issues/9)

## [0.8.3](https://github.com/Illusion47586/isol8/compare/v0.8.2...v0.8.3) (2026-02-17)


### Bug Fixes

* **engine:** validate package names to prevent command injection ([#39](https://github.com/Illusion47586/isol8/issues/39)) ([094619f](https://github.com/Illusion47586/isol8/commit/094619f9378284375f1d897bb2ae0593eadd8a51)), closes [#5](https://github.com/Illusion47586/isol8/issues/5)

## [0.8.2](https://github.com/Illusion47586/isol8/compare/v0.8.1...v0.8.2) (2026-02-17)


### Bug Fixes

* resolve race condition in network isolation and memory limit timeout regression ([#38](https://github.com/Illusion47586/isol8/issues/38)) ([c12245e](https://github.com/Illusion47586/isol8/commit/c12245ecb27356e04e2d9cbf9636667770c384f4))
* **security:** prevent file content leak in writeFileViaExec ([#37](https://github.com/Illusion47586/isol8/issues/37)) ([5fe3c59](https://github.com/Illusion47586/isol8/commit/5fe3c591be9a29e529902e96867cd8d94d5d6c23))

## [0.8.1](https://github.com/Illusion47586/isol8/compare/v0.8.0...v0.8.1) (2026-02-17)


### Bug Fixes

* enforce network filtering with iptables to prevent raw socket bypass ([#22](https://github.com/Illusion47586/isol8/issues/22)) ([d4f65c1](https://github.com/Illusion47586/isol8/commit/d4f65c18ef4208844844d77cdae5366208664462))

# [0.8.0](https://github.com/Illusion47586/isol8/compare/v0.7.0...v0.8.0) (2026-02-16)


### Features

* **ci:** add test coverage reporting and status badges ([#31](https://github.com/Illusion47586/isol8/issues/31)) ([77244d1](https://github.com/Illusion47586/isol8/commit/77244d1dd7557bb3a5ca78f862594a136762eb4c))

# [0.7.0](https://github.com/Illusion47586/isol8/compare/v0.6.2...v0.7.0) (2026-02-16)


### Bug Fixes

* kill user processes on container pool reuse to prevent cross-execution persistence ([#21](https://github.com/Illusion47586/isol8/issues/21)) ([cca0f48](https://github.com/Illusion47586/isol8/commit/cca0f480bd80b9a87f15c92d083ffbd423273647)), closes [#3](https://github.com/Illusion47586/isol8/issues/3)


### Features

* **ci:** switch release workflow to GitHub App for bypass ([#29](https://github.com/Illusion47586/isol8/issues/29)) ([5539164](https://github.com/Illusion47586/isol8/commit/553916431961ffb45a3489fa5d4328df8bfd1509))
* implement seccomp profile for container security ([#20](https://github.com/Illusion47586/isol8/issues/20)) ([b14206b](https://github.com/Illusion47586/isol8/commit/b14206b6787e8c8eacf195e78383ee3d3f40afd7)), closes [#15](https://github.com/Illusion47586/isol8/issues/15)

## [0.6.2](https://github.com/Illusion47586/isol8/compare/v0.6.1...v0.6.2) (2026-02-14)


### Bug Fixes

* add --debug flag to run/serve subcommands and server debug logging ([63d3283](https://github.com/Illusion47586/isol8/commit/63d32833ff54545b9f2eff2e03e639351e49bbca))
* add debug logging to all CLI commands and fix server binary version mismatch ([99b776b](https://github.com/Illusion47586/isol8/commit/99b776b86fe350c3a685a3e562d0cfe34e7ceb4f))

## [0.6.1](https://github.com/Illusion47586/isol8/compare/v0.6.0...v0.6.1) (2026-02-14)


### Bug Fixes

* reduce npm package size from 442MB to 2.2MB ([240aae3](https://github.com/Illusion47586/isol8/commit/240aae3af1e4f2b808f766920cef32e05f40b334))

# [0.6.0](https://github.com/Illusion47586/isol8/compare/v0.5.1...v0.6.0) (2026-02-14)


### Features

* standalone compiled server binary with auto-download CLI launcher ([#2](https://github.com/Illusion47586/isol8/issues/2)) ([4a3f0ac](https://github.com/Illusion47586/isol8/commit/4a3f0acf4431fc5768dd7773fd45ca36824a5d20))

## [0.5.1](https://github.com/Illusion47586/isol8/compare/v0.5.0...v0.5.1) (2026-02-14)


### Bug Fixes

* resolve docker directory path correctly in bundled CLI ([c80f475](https://github.com/Illusion47586/isol8/commit/c80f475a6ef2b8e81b7e569ca37c65929f27339c))

# [0.5.0](https://github.com/Illusion47586/isol8/compare/v0.4.3...v0.5.0) (2026-02-14)


### Features

* add --persist and --debug engine flags ([0d1a220](https://github.com/Illusion47586/isol8/commit/0d1a22021aa5ad169a7049a276379c6ad2e16e70))

## [0.4.3](https://github.com/Illusion47586/isol8/compare/v0.4.2...v0.4.3) (2026-02-14)


### Bug Fixes

* **runtime:** default node to .mjs to suppress warnings, support .cjs extension ([c5657ba](https://github.com/Illusion47586/isol8/commit/c5657ba7960158baead08f4cdc09a28d92b10e09))

## [0.4.2](https://github.com/Illusion47586/isol8/compare/v0.4.1...v0.4.2) (2026-02-14)


### Bug Fixes

* **cli:** prevent indefinite hang by enforcing cleanup timeout and proper exit handling ([201f706](https://github.com/Illusion47586/isol8/commit/201f70668287b07a109f53b253047967d5ce1a98))

## [0.4.1](https://github.com/Illusion47586/isol8/compare/v0.4.0...v0.4.1) (2026-02-14)


### Bug Fixes

* **engine:** configure bun install paths to writable locations ([159d3fb](https://github.com/Illusion47586/isol8/commit/159d3fb725d032e6165daa9c006834095f1cfb9c))
* **engine:** install npm packages locally for correct resolution ([8fda0fc](https://github.com/Illusion47586/isol8/commit/8fda0fc663e30fb09b93c312a0355659dbb132af))

# [0.4.0](https://github.com/Illusion47586/isol8/compare/v0.3.1...v0.4.0) (2026-02-14)


### Features

* default to streaming, add --no-stream, improve cleanup and tests ([5583947](https://github.com/Illusion47586/isol8/commit/558394729babb93d70a87f136e73ddaf96cfa269))

## [0.3.1](https://github.com/Illusion47586/isol8/compare/v0.3.0...v0.3.1) (2026-02-14)


### Bug Fixes

* **engine:** ensure pool replenishment promises settle for clean exit ([a859e82](https://github.com/Illusion47586/isol8/commit/a859e82410d631541052539a6a147cac6e31a25e))

# [0.3.0](https://github.com/Illusion47586/isol8/compare/v0.2.0...v0.3.0) (2026-02-14)


### Features

* add streaming support to CLI ([7d5a327](https://github.com/Illusion47586/isol8/commit/7d5a3279fa9a4e460f2768e5657a6eee913a59cb))

# [0.2.0](https://github.com/Illusion47586/isol8/compare/v0.1.0...v0.2.0) (2026-02-14)


### Features

* export VERSION constant for programmatic version checking ([5e5f696](https://github.com/Illusion47586/isol8/commit/5e5f696b22db5693ab7bcf71b1c4347841545f51))
