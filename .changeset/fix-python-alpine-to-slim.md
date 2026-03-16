---
"@isol8/core": patch
---

Switch the Python Docker image from Alpine Linux to `python:3.12-slim` (Debian). This fixes installation failures for data-science packages such as `numpy`, `scipy`, `matplotlib`, and `statsmodels` that require pre-built manylinux wheels not available on Alpine's musl libc.
