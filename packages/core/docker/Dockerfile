# ── Base ──────────────────────────────────────────────────────────────
FROM alpine:3.21 AS base
RUN apk add --no-cache tini curl ca-certificates iptables bash \
    && addgroup -S sandbox && adduser -S sandbox -G sandbox -h /sandbox
COPY proxy.sh /usr/local/bin/proxy.sh
COPY proxy-handler.sh /usr/local/bin/proxy-handler.sh
RUN chmod +x /usr/local/bin/proxy.sh /usr/local/bin/proxy-handler.sh
WORKDIR /sandbox
ENTRYPOINT ["/sbin/tini", "--"]

# ── Python ────────────────────────────────────────────────────────────
FROM base AS python
RUN apk add --no-cache python3 py3-pip
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
RUN apk add --no-cache tini curl ca-certificates iptables bash \
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
