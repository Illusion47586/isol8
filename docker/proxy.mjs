#!/usr/bin/env node

/**
 * isol8 network proxy — lightweight HTTP/HTTPS filtering proxy.
 *
 * Reads whitelist/blacklist regex patterns from env vars and blocks
 * non-matching outbound requests with 403.
 *
 * Env vars:
 *   ISOL8_WHITELIST - JSON array of regex strings (allow these)
 *   ISOL8_BLACKLIST - JSON array of regex strings (block these)
 *   ISOL8_PROXY_PORT - Port to listen on (default: 8118)
 *
 * Logic:
 *   1. If blacklist matches → BLOCK
 *   2. If whitelist is non-empty and hostname doesn't match → BLOCK
 *   3. Otherwise → ALLOW
 */

import http from "node:http";
import net from "node:net";

const port = Number.parseInt(process.env.ISOL8_PROXY_PORT || "8118", 10);

const whitelist = parsePatterns(process.env.ISOL8_WHITELIST);
const blacklist = parsePatterns(process.env.ISOL8_BLACKLIST);

function parsePatterns(envVar) {
  if (!envVar) {
    return [];
  }
  try {
    const arr = JSON.parse(envVar);
    return arr.map((p) => new RegExp(p));
  } catch {
    return [];
  }
}

function isAllowed(hostname) {
  // Check blacklist first
  for (const re of blacklist) {
    if (re.test(hostname)) {
      return false;
    }
  }

  // If whitelist is empty, allow all (only blacklist applies)
  if (whitelist.length === 0) {
    return true;
  }

  // Otherwise, must match at least one whitelist pattern
  for (const re of whitelist) {
    if (re.test(hostname)) {
      return true;
    }
  }

  return false;
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const hostname = url.hostname;

  if (!isAllowed(hostname)) {
    res.writeHead(403, { "Content-Type": "text/plain" });
    res.end(`isol8: request to ${hostname} blocked by network filter`);
    return;
  }

  // Forward HTTP request
  const proxyReq = http.request(
    {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: req.method,
      headers: req.headers,
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode, proxyRes.headers);
      proxyRes.pipe(res);
    }
  );

  proxyReq.on("error", (err) => {
    res.writeHead(502, { "Content-Type": "text/plain" });
    res.end(`isol8: proxy error: ${err.message}`);
  });

  req.pipe(proxyReq);
});

// Handle HTTPS CONNECT tunneling
server.on("connect", (req, clientSocket, head) => {
  const [hostname, port] = req.url.split(":");

  if (!isAllowed(hostname)) {
    clientSocket.write(
      "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\n\r\n" +
        `isol8: CONNECT to ${hostname} blocked by network filter`
    );
    clientSocket.end();
    return;
  }

  const serverSocket = net.connect(Number.parseInt(port || "443", 10), hostname, () => {
    clientSocket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
    serverSocket.write(head);
    serverSocket.pipe(clientSocket);
    clientSocket.pipe(serverSocket);
  });

  serverSocket.on("error", (err) => {
    clientSocket.write(
      "HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\n\r\n" +
        `isol8: tunnel error: ${err.message}`
    );
    clientSocket.end();
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`isol8 proxy listening on 127.0.0.1:${port}`);
});
