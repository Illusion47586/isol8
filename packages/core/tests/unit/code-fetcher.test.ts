import { describe, expect, test } from "bun:test";
import { fetchRemoteCode } from "../../src/engine/code-fetcher";
import type { RemoteCodePolicy } from "../../src/types";

const basePolicy: RemoteCodePolicy = {
  enabled: true,
  allowedSchemes: ["https"],
  allowedHosts: [],
  blockedHosts: ["^localhost$", "^127(?:\\.[0-9]{1,3}){3}$", "^169\\.254\\.169\\.254$"],
  maxCodeSize: 1024,
  fetchTimeoutMs: 5000,
  requireHash: false,
  enableCache: true,
  cacheTtl: 3600,
};

describe("fetchRemoteCode", () => {
  test("fetches code and verifies hash", async () => {
    const result = await fetchRemoteCode(
      {
        codeUrl: "https://example.com/script.py",
        codeHash: "e651ef002de96727cf3b1f8533ebb5c1036d12d795ec486c4cbd4ed2872fde31",
      },
      basePolicy,
      {
        fetchFn: async () => new Response("print('ok')", { status: 200 }),
        lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      }
    );

    expect(result.code).toBe("print('ok')");
  });

  test("blocks insecure http by default", async () => {
    await expect(
      fetchRemoteCode({ codeUrl: "http://example.com/script.py" }, basePolicy, {
        fetchFn: async () => new Response("print('ok')", { status: 200 }),
        lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      })
    ).rejects.toThrow("Insecure code URL blocked");
  });

  test("allows http when explicitly enabled in request and policy", async () => {
    const result = await fetchRemoteCode(
      {
        codeUrl: "http://example.com/script.py",
        allowInsecureCodeUrl: true,
      },
      {
        ...basePolicy,
        allowedSchemes: ["http", "https"],
      },
      {
        fetchFn: async () => new Response("print('ok')", { status: 200 }),
        lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
      }
    );

    expect(result.code).toBe("print('ok')");
  });

  test("blocks hosts that resolve to private IP ranges", async () => {
    await expect(
      fetchRemoteCode({ codeUrl: "https://example.com/script.py" }, basePolicy, {
        fetchFn: async () => new Response("print('ok')", { status: 200 }),
        lookupFn: async () => [{ address: "127.0.0.1", family: 4 }],
      })
    ).rejects.toThrow("Blocked code URL host");
  });

  test("enforces required hash policy", async () => {
    await expect(
      fetchRemoteCode(
        { codeUrl: "https://example.com/script.py" },
        {
          ...basePolicy,
          requireHash: true,
        },
        {
          fetchFn: async () => new Response("print('ok')", { status: 200 }),
          lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
        }
      )
    ).rejects.toThrow("Hash verification required");
  });

  test("rejects on hash mismatch", async () => {
    await expect(
      fetchRemoteCode(
        {
          codeUrl: "https://example.com/script.py",
          codeHash: "deadbeef",
        },
        basePolicy,
        {
          fetchFn: async () => new Response("print('ok')", { status: 200 }),
          lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
        }
      )
    ).rejects.toThrow("Remote code hash mismatch");
  });

  test("rejects when payload exceeds maxCodeSize", async () => {
    await expect(
      fetchRemoteCode(
        { codeUrl: "https://example.com/script.py" },
        {
          ...basePolicy,
          maxCodeSize: 4,
        },
        {
          fetchFn: async () =>
            new Response("print('ok')", {
              status: 200,
              headers: { "content-length": "11" },
            }),
          lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
        }
      )
    ).rejects.toThrow("Remote code exceeds maxCodeSize");
  });
});
