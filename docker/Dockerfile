# ── Base ──────────────────────────────────────────────────────────────
FROM alpine:3.21 AS base
RUN apk add --no-cache tini curl ca-certificates
COPY proxy.mjs /usr/local/bin/proxy.mjs
RUN chmod +x /usr/local/bin/proxy.mjs
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
RUN curl -fsSL https://bun.sh/install | bash \
    && mv /root/.bun/bin/bun /usr/local/bin/bun \
    && ln -s /usr/local/bin/bun /usr/local/bin/bunx
CMD ["bun"]

# ── Deno ──────────────────────────────────────────────────────────────
FROM base AS deno
RUN curl -fsSL https://deno.land/install.sh | DENO_INSTALL=/usr/local sh \
    && chmod +x /usr/local/bin/deno
CMD ["deno"]

# ── Bash ──────────────────────────────────────────────────────────────
FROM base AS bash
RUN apk add --no-cache bash
CMD ["bash"]
