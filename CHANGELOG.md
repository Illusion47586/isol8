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
