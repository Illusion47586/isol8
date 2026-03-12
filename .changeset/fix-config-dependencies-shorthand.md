---
"@isol8/core": minor
---

Add `dependencies` shorthand field to `isol8.config.json`. Specifying `{ "dependencies": { "python": ["numpy", "pandas"] } }` is now equivalent to a `prebuiltImages` entry, making per-runtime package declarations more concise. Entries from `dependencies` are appended after any explicit `prebuiltImages`.
