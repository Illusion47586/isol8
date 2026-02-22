import { describe, expect, test } from "bun:test";
import { DockerIsol8 } from "@isol8/core";
import { hasDocker } from "./setup";

describe("Integration: Network Logging", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  test("Network logging captures allowed HTTP requests", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "filtered",
      logNetwork: true,
    });

    const result = await engine.execute({
      code: `
import urllib.request
r = urllib.request.urlopen("http://example.com", timeout=5)
print("success")
`,
      runtime: "python",
      timeoutMs: 15_000,
    });

    expect(result.stdout).toContain("success");
    expect(result.networkLogs).toBeDefined();
    expect(result.networkLogs!.length).toBeGreaterThan(0);

    const log = result.networkLogs!.find((l) => l.host === "example.com");
    expect(log).toBeDefined();
    expect(log!.method).toBe("GET");
    expect(log!.action).toBe("ALLOW");
    expect(log!.path).toBe("/");
    expect(log!.durationMs).toBeGreaterThanOrEqual(0);
  }, 60_000);

  test("Network logging captures blocked HTTP requests", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "filtered",
      networkFilter: {
        whitelist: [],
        blacklist: ["^example\\.com$"],
      },
      logNetwork: true,
    });

    const result = await engine.execute({
      code: `
import urllib.request
try:
    r = urllib.request.urlopen("http://example.com", timeout=5)
    print("not_blocked")
except urllib.error.HTTPError as e:
    if e.code == 403:
        print("blocked")
    else:
        print(f"error: {e.code}")
except Exception as e:
    print(f"error: {e}")
`,
      runtime: "python",
      timeoutMs: 15_000,
    });

    expect(result.stdout).toContain("blocked");
    expect(result.networkLogs).toBeDefined();
    expect(result.networkLogs!.length).toBeGreaterThan(0);

    const log = result.networkLogs!.find((l) => l.host === "example.com");
    expect(log).toBeDefined();
    expect(log!.method).toBe("GET");
    expect(log!.action).toBe("BLOCK");
  }, 60_000);

  test("Network logging captures HTTPS CONNECT tunnel", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "filtered",
      logNetwork: true,
    });

    const result = await engine.execute({
      code: `
import urllib.request
import ssl
try:
    ctx = ssl.create_default_context()
    r = urllib.request.urlopen("https://example.com", timeout=5, context=ctx)
    print("success")
except Exception as e:
    print(f"error: {e}")
`,
      runtime: "python",
      timeoutMs: 15_000,
    });

    // Note: HTTPS CONNECT might succeed or fail depending on network
    // But we should still get a log entry
    expect(result.networkLogs).toBeDefined();

    const connectLog = result.networkLogs!.find((l) => l.method === "CONNECT");
    expect(connectLog).toBeDefined();
    expect(connectLog!.host).toBe("example.com");
    expect(connectLog!.path).toBeNull();
    expect(connectLog!.action).toBeDefined();
  }, 60_000);

  test("Network logging disabled when logNetwork is false", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "filtered",
      logNetwork: false,
    });

    const result = await engine.execute({
      code: `
import urllib.request
r = urllib.request.urlopen("http://example.com", timeout=5)
print("success")
`,
      runtime: "python",
      timeoutMs: 15_000,
    });

    expect(result.stdout).toContain("success");
    expect(result.networkLogs).toBeUndefined();
  }, 60_000);

  test("Network logging no-op when network is not filtered", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      logNetwork: true,
    });

    const result = await engine.execute({
      code: "print('hello')",
      runtime: "python",
    });

    expect(result.stdout).toContain("hello");
    expect(result.networkLogs).toBeUndefined();
  }, 30_000);

  test("Network logging captures multiple requests", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "filtered",
      logNetwork: true,
    });

    const result = await engine.execute({
      code: `
import urllib.request
urllib.request.urlopen("http://example.com", timeout=5)
urllib.request.urlopen("http://example.com", timeout=5)
print("done")
`,
      runtime: "python",
      timeoutMs: 20_000,
    });

    expect(result.stdout).toContain("done");
    expect(result.networkLogs).toBeDefined();
    // Should have at least 2 logs (one per request)
    const exampleLogs = result.networkLogs!.filter((l) => l.host === "example.com");
    expect(exampleLogs.length).toBeGreaterThanOrEqual(2);
  }, 60_000);
});
