---
"@isol8/core": patch
---

Docker build stream output is now accumulated and included in error messages when `buildBaseImages` or `buildCustomImage` fails. Previously only the final error event was surfaced; the full build log (including pip tracebacks and layer output) is now appended to the thrown error.
