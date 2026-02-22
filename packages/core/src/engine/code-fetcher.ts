import { createHash } from "node:crypto";
import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { RemoteCodePolicy } from "../types";

export interface FetchCodeRequest {
  codeUrl: string;
  codeHash?: string;
  allowInsecureCodeUrl?: boolean;
}

export interface FetchCodeResult {
  code: string;
  url: string;
  hash: string;
}

interface CodeFetcherDeps {
  fetchFn?: (input: string, init?: RequestInit) => Promise<Response>;
  lookupFn?: (hostname: string) => Promise<Array<{ address: string; family: number }>>;
}

const IPV4_SEPARATOR = ".";
const IPV6_LOOPBACK = "::1";

function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf-8").digest("hex");
}

function normalizeScheme(url: URL): string {
  return url.protocol.replace(/:$/, "").toLowerCase();
}

function isBlockedByPattern(host: string, patterns: string[]): boolean {
  return patterns.some((pattern) => new RegExp(pattern, "i").test(host));
}

function isAllowedByPattern(host: string, patterns: string[]): boolean {
  if (patterns.length === 0) {
    return true;
  }
  return patterns.some((pattern) => new RegExp(pattern, "i").test(host));
}

function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split(IPV4_SEPARATOR).map((v) => Number.parseInt(v, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) {
    return false;
  }
  const a = parts[0]!;
  const b = parts[1]!;
  if (a === 10 || a === 127 || a === 0) {
    return true;
  }
  if (a === 169 && b === 254) {
    return true;
  }
  if (a === 172 && b >= 16 && b <= 31) {
    return true;
  }
  if (a === 192 && b === 168) {
    return true;
  }
  if (a === 100 && b >= 64 && b <= 127) {
    return true;
  }
  return false;
}

function isPrivateIpv6(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized === IPV6_LOOPBACK) {
    return true;
  }
  return (
    normalized.startsWith("fc") ||
    normalized.startsWith("fd") ||
    normalized.startsWith("fe8") ||
    normalized.startsWith("fe9") ||
    normalized.startsWith("fea") ||
    normalized.startsWith("feb")
  );
}

function isPrivateIp(ip: string): boolean {
  const family = isIP(ip);
  if (family === 4) {
    return isPrivateIpv4(ip);
  }
  if (family === 6) {
    return isPrivateIpv6(ip);
  }
  return false;
}

async function assertHostResolvesPublic(
  host: string,
  lookupFn: (hostname: string) => Promise<Array<{ address: string; family: number }>>
): Promise<void> {
  if (isIP(host) && isPrivateIp(host)) {
    throw new Error(`Blocked code URL host: ${host}`);
  }

  try {
    const records = await lookupFn(host);
    for (const record of records) {
      if (isPrivateIp(record.address)) {
        throw new Error(`Blocked code URL host: ${host}`);
      }
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("Blocked code URL host:")) {
      throw err;
    }
    throw new Error(`Failed to resolve code URL host: ${host}`);
  }
}

function decodeUtf8(content: Uint8Array): string {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const text = decoder.decode(content);
  if (text.includes("\u0000")) {
    throw new Error("Fetched code appears to be binary content");
  }
  return text;
}

export async function fetchRemoteCode(
  request: FetchCodeRequest,
  policy: RemoteCodePolicy,
  deps: CodeFetcherDeps = {}
): Promise<FetchCodeResult> {
  if (!policy.enabled) {
    throw new Error("Remote code fetching is disabled. Set remoteCode.enabled=true to allow it.");
  }

  const fetchFn = deps.fetchFn ?? globalThis.fetch;
  const lookupFn =
    deps.lookupFn ??
    (async (hostname: string) => {
      const records = await dnsLookup(hostname, { all: true, verbatim: true });
      return records;
    });

  if (!request.codeUrl) {
    throw new Error("codeUrl is required for remote code fetching");
  }

  const url = new URL(request.codeUrl);
  const scheme = normalizeScheme(url);

  if (scheme === "http" && !request.allowInsecureCodeUrl) {
    throw new Error("Insecure code URL blocked. Use allowInsecureCodeUrl=true to allow HTTP.");
  }

  if (!policy.allowedSchemes.map((s) => s.toLowerCase()).includes(scheme)) {
    throw new Error(`URL scheme not allowed: ${scheme}`);
  }

  const host = url.hostname.toLowerCase();
  if (
    !isAllowedByPattern(host, policy.allowedHosts) ||
    isBlockedByPattern(host, policy.blockedHosts)
  ) {
    throw new Error(`Blocked code URL host: ${host}`);
  }

  await assertHostResolvesPublic(host, lookupFn);

  if (policy.requireHash && !request.codeHash) {
    throw new Error("Hash verification required: provide codeHash for remote code execution.");
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), policy.fetchTimeoutMs);

  let response: Response;
  try {
    response = await fetchFn(url.toString(), {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
    });
  } catch (err) {
    throw new Error(
      err instanceof Error && err.name === "AbortError"
        ? `Remote code fetch timed out after ${policy.fetchTimeoutMs}ms`
        : `Failed to fetch remote code: ${err instanceof Error ? err.message : String(err)}`
    );
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch remote code: HTTP ${response.status}`);
  }

  const contentLengthHeader = response.headers.get("content-length");
  if (contentLengthHeader) {
    const parsedLength = Number.parseInt(contentLengthHeader, 10);
    if (!Number.isNaN(parsedLength) && parsedLength > policy.maxCodeSize) {
      throw new Error(
        `Remote code exceeds maxCodeSize (${policy.maxCodeSize} bytes): ${parsedLength} bytes`
      );
    }
  }

  if (!response.body) {
    throw new Error("Remote code response body is empty");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    if (!value) {
      continue;
    }
    totalBytes += value.byteLength;
    if (totalBytes > policy.maxCodeSize) {
      throw new Error(`Remote code exceeds maxCodeSize (${policy.maxCodeSize} bytes)`);
    }
    chunks.push(value);
  }

  const buffer = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    buffer.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const code = decodeUtf8(buffer);
  const hash = sha256Hex(code);

  if (request.codeHash && hash.toLowerCase() !== request.codeHash.toLowerCase()) {
    throw new Error("Remote code hash mismatch");
  }

  return { code, url: url.toString(), hash };
}
