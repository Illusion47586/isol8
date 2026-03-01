---
"@isol8/core": minor
"@isol8/server": minor
---

Add connection queueing system with configurable queue size limits and timeouts. When all execution slots are busy, requests now queue instead of failing immediately. Returns 429 when the queue is full and 408 when a queued request times out. Adds a `/queue/status` endpoint for monitoring.
