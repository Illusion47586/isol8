# ── Base ──────────────────────────────────────────────────────────────
FROM alpine:3.21 AS base
RUN apk add --no-cache tini curl ca-certificates iptables bash git github-cli \
    && addgroup -S sandbox && adduser -S sandbox -G sandbox -h /sandbox
COPY proxy.sh /usr/local/bin/proxy.sh
COPY proxy-handler.sh /usr/local/bin/proxy-handler.sh
RUN chmod +x /usr/local/bin/proxy.sh /usr/local/bin/proxy-handler.sh
WORKDIR /sandbox
ENTRYPOINT ["/sbin/tini", "--"]

# ── Python ────────────────────────────────────────────────────────────
# Uses python:3.12-slim (Debian) instead of Alpine so that pre-built
# manylinux/musllinux wheels are available for data-science packages
# (numpy, scipy, matplotlib, statsmodels, etc.).
FROM python:3.12-slim AS python
RUN apt-get update && apt-get install -y --no-install-recommends \
        tini curl ca-certificates iptables bash git \
    && rm -rf /var/lib/apt/lists/* \
    && groupadd -r sandbox && useradd -r -g sandbox -d /sandbox -s /bin/bash sandbox \
    && mkdir -p /sandbox && chown sandbox:sandbox /sandbox
COPY proxy.sh /usr/local/bin/proxy.sh
COPY proxy-handler.sh /usr/local/bin/proxy-handler.sh
RUN chmod +x /usr/local/bin/proxy.sh /usr/local/bin/proxy-handler.sh
WORKDIR /sandbox
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python3"]

# ── Node ──────────────────────────────────────────────────────────────
FROM base AS node
RUN apk add --no-cache nodejs npm
CMD ["node"]

# ── Bun ───────────────────────────────────────────────────────────────
FROM base AS bun
RUN apk add --no-cache unzip libstdc++ libgcc \
    && curl -fsSL https://bun.sh/install | bash \
    && mv /root/.bun/bin/bun /usr/local/bin/bun \
    && ln -s /usr/local/bin/bun /usr/local/bin/bunx
CMD ["bun"]

# ── Deno ──────────────────────────────────────────────────────────────
FROM denoland/deno:alpine AS deno
RUN apk add --no-cache tini curl ca-certificates iptables bash git \
    && addgroup -S sandbox && adduser -S sandbox -G sandbox -h /sandbox
COPY proxy.sh /usr/local/bin/proxy.sh
COPY proxy-handler.sh /usr/local/bin/proxy-handler.sh
RUN chmod +x /usr/local/bin/proxy.sh /usr/local/bin/proxy-handler.sh
WORKDIR /sandbox
ENTRYPOINT ["/sbin/tini", "--"]
CMD ["deno"]

# ── Bash ──────────────────────────────────────────────────────────────
FROM base AS bash
CMD ["bash"]

# ── Agent ─────────────────────────────────────────────────────────────
FROM base AS agent
RUN apk add --no-cache unzip libstdc++ libgcc \
    && curl -fsSL https://bun.sh/install | bash \
    && mv /root/.bun/bin/bun /usr/local/bin/bun \
    && ln -s /usr/local/bin/bun /usr/local/bin/bunx \
    && bun install -g @mariozechner/pi-coding-agent \
    && cp -r /root/.bun/install /usr/local/share/bun-global \
    && printf '#!/bin/sh\nexec bun /usr/local/share/bun-global/global/node_modules/@mariozechner/pi-coding-agent/dist/cli.js "$@"\n' > /usr/local/bin/pi \
    && chmod +x /usr/local/bin/pi
CMD ["bash"]
