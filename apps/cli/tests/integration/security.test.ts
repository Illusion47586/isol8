import { describe, expect, test } from "bun:test";
import { DockerIsol8 } from "@isol8/core";
import { hasDocker } from "./setup";

describe("Integration: Security & Limits", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  test("Network: 'none' blocks outbound requests", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
    });

    // Python requests should fail
    const result = await engine.execute({
      code: `
import urllib.request
try:
    urllib.request.urlopen("https://example.com", timeout=2)
    print("success")
except:
    print("failure")
      `,
      runtime: "python",
    });

    expect(result.stdout).toContain("failure");
  }, 60_000);

  test("Timeout kills execution", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
    });

    const start = performance.now();
    const result = await engine.execute({
      code: "import time; time.sleep(5)",
      runtime: "python",
      timeoutMs: 1000, // 1s timeout
    });
    const end = performance.now();

    // Container setup adds overhead; total should still be well under 5s (the sleep duration)
    expect(end - start).toBeLessThan(5000);
    // When killed, exit code is usually 137 (SIGKILL) or similar non-zero
    expect(result.exitCode).not.toBe(0);
  }, 30_000);

  test("Memory limit enforcement", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      memoryLimit: "32m", // Low limit
    });

    // Allocate 100MB
    const result = await engine.execute({
      code: "x = 'a' * 1024 * 1024 * 100",
      runtime: "python",
    });

    // Should crash/OOM
    expect(result.exitCode).not.toBe(0);
  }, 30_000);

  // ── Filtered network mode tests ──

  test("Network: 'filtered' blocks raw socket bypass via iptables", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "filtered",
      networkFilter: {
        whitelist: ["^example\\.com$"],
        blacklist: [],
      },
    });

    // Attempt a raw socket connection that bypasses the proxy.
    // With iptables enforcement, this should be dropped at the kernel level.
    const result = await engine.execute({
      code: `
import socket
try:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(3)
    s.connect(("1.1.1.1", 80))
    s.close()
    print("bypass_success")
except Exception as e:
    print("bypass_blocked")
      `,
      runtime: "python",
      timeoutMs: 15_000,
    });

    // The raw socket connection should be blocked by iptables
    expect(result.stdout).toContain("bypass_blocked");
  }, 60_000);

  test("Network: 'filtered' allows HTTP through proxy", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "filtered",
      networkFilter: {
        whitelist: ["^example\\.com$"],
        blacklist: [],
      },
    });

    // HTTP request through proxy should work for whitelisted host
    const result = await engine.execute({
      code: `
import urllib.request
try:
    r = urllib.request.urlopen("http://example.com", timeout=5)
    print("proxy_allowed")
except Exception as e:
    print(f"proxy_error: {e}")
      `,
      runtime: "python",
      timeoutMs: 15_000,
    });

    expect(result.stdout).toContain("proxy_allowed");
  }, 60_000);

  test("Network: 'filtered' blacklist blocks matching host", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "filtered",
      networkFilter: {
        whitelist: [],
        blacklist: ["^example\\.com$"],
      },
    });

    // Blacklisted host should be blocked by the proxy (403)
    const result = await engine.execute({
      code: `
import urllib.request
try:
    r = urllib.request.urlopen("http://example.com", timeout=5)
    print(f"not_blocked: {r.status}")
except urllib.error.HTTPError as e:
    if e.code == 403:
        print("blacklist_blocked")
    else:
        print(f"other_error: {e.code}")
except Exception as e:
    print(f"error: {e}")
      `,
      runtime: "python",
      timeoutMs: 15_000,
    });

    expect(result.stdout).toContain("blacklist_blocked");
  }, 60_000);

  test("Network: 'filtered' whitelist blocks non-matching host", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "filtered",
      networkFilter: {
        whitelist: ["^example\\.com$"],
        blacklist: [],
      },
    });

    // Non-whitelisted host should be blocked by the proxy (403)
    const result = await engine.execute({
      code: `
import urllib.request
try:
    r = urllib.request.urlopen("http://httpbin.org/get", timeout=5)
    print(f"not_blocked: {r.status}")
except urllib.error.HTTPError as e:
    if e.code == 403:
        print("whitelist_blocked")
    else:
        print(f"other_error: {e.code}")
except Exception as e:
    print(f"error: {e}")
      `,
      runtime: "python",
      timeoutMs: 15_000,
    });

    expect(result.stdout).toContain("whitelist_blocked");
  }, 60_000);

  test("Network: 'filtered' blacklist takes precedence over whitelist", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "filtered",
      networkFilter: {
        whitelist: ["^example\\.com$"],
        blacklist: ["^example\\.com$"],
      },
    });

    // When a host matches both whitelist and blacklist, blacklist wins
    const result = await engine.execute({
      code: `
import urllib.request
try:
    r = urllib.request.urlopen("http://example.com", timeout=5)
    print(f"not_blocked: {r.status}")
except urllib.error.HTTPError as e:
    if e.code == 403:
        print("blacklist_wins")
    else:
        print(f"other_error: {e.code}")
except Exception as e:
    print(f"error: {e}")
      `,
      runtime: "python",
      timeoutMs: 15_000,
    });

    expect(result.stdout).toContain("blacklist_wins");
  }, 60_000);

  test("Network: 'filtered' CONNECT tunnel blocks blacklisted host", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "filtered",
      networkFilter: {
        whitelist: [],
        blacklist: ["^example\\.com$"],
      },
    });

    // HTTPS uses CONNECT tunneling — the proxy should block before the TLS handshake
    const result = await engine.execute({
      code: `
import urllib.request
import ssl
try:
    ctx = ssl.create_default_context()
    r = urllib.request.urlopen("https://example.com", timeout=5, context=ctx)
    print(f"not_blocked: {r.status}")
except urllib.error.HTTPError as e:
    if e.code == 403:
        print("connect_blocked")
    else:
        print(f"other_error: {e.code}")
except urllib.error.URLError as e:
    # CONNECT rejection may surface as a URLError with 403 in the reason
    if "403" in str(e):
        print("connect_blocked")
    else:
        print(f"url_error: {e}")
except Exception as e:
    print(f"error: {e}")
      `,
      runtime: "python",
      timeoutMs: 15_000,
    });

    expect(result.stdout).toContain("connect_blocked");
  }, 60_000);

  test("Network: 'filtered' works with Node.js runtime", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "filtered",
      networkFilter: {
        whitelist: ["^example\\.com$"],
        blacklist: [],
      },
    });

    // Verify the bash proxy works across runtimes, not just Python
    const result = await engine.execute({
      code: `
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const http = require("http");
const url = "http://example.com";

console.log("Starting Node.js network test...");
console.log("HTTP_PROXY:", process.env.HTTP_PROXY);

function makeRequest(retries) {
  // Node.js http.get does not automatically respect HTTP_PROXY, so we must manually configure it.
  // We send the request to the proxy host/port, but with the full target URL as the path.
  const proxyUrl = new URL(process.env.HTTP_PROXY);
  const options = {
    hostname: proxyUrl.hostname,
    port: proxyUrl.port,
    path: url, // Proxy request uses full URL
    headers: {
      Host: "example.com"
    },
    timeout: 5000
  };

  const req = http.get(options, (res) => {
    if (res.statusCode === 200) {
      console.log("node_proxy_allowed");
    } else {
      console.log("node_unexpected_status: " + res.statusCode);
    }
    res.resume();
  });

  req.on("error", (e) => {
    if (retries > 0) {
      console.log("Request failed: " + e.message + ". Retrying..." + retries);
      setTimeout(() => makeRequest(retries - 1), 1000);
    } else {
      console.log("node_error: " + e.message);
    }
  });
}

makeRequest(3);
      `,
      runtime: "node",
      timeoutMs: 30_000,
    });

    expect(result.stdout).toContain("node_proxy_allowed");
  }, 60_000);

  test("Network: 'filtered' without networkFilter allows all traffic", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "filtered",
      // No networkFilter — proxy should allow all hostnames
    });

    const result = await engine.execute({
      code: `
import urllib.request
import time

# Retry loop for potential transient network/DNS failures during startup
max_retries = 3
for i in range(max_retries):
    try:
        r = urllib.request.urlopen("http://example.com", timeout=5)
        print("open_proxy_allowed")
        break
    except Exception as e:
        if i == max_retries - 1:
            print(f"error: {e}")
        else:
            print(f"Request failed: {e}. Retrying...")
            time.sleep(1)
      `,
      runtime: "python",
      timeoutMs: 30_000,
    });

    expect(result.stdout).toContain("open_proxy_allowed");
  }, 60_000);

  // ── Regression Tests ──

  test("Regression: Network isolation race condition (run 5 times)", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
    });

    const code = `
import urllib.request
try:
    urllib.request.urlopen("https://example.com", timeout=2)
    print("success")
except:
    print("failure")
    `;

    for (let i = 0; i < 5; i++) {
      const result = await engine.execute({
        code,
        runtime: "python",
      });
      expect(result.stdout.trim()).toBe("failure");
    }
  }, 120_000);

  test("Regression: Memory limit timeout", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      memoryLimit: "32m",
    });

    const result = await engine.execute({
      code: "x = 'a' * 1024 * 1024 * 100",
      runtime: "python",
      timeoutMs: 10_000,
    });

    // Should not time out (which would result in "EXECUTION TIMED OUT" in stderr)
    // Should be killed by OOM (exit code 137 usually)
    expect(result.stderr).not.toContain("EXECUTION TIMED OUT");
    expect(result.exitCode).not.toBe(0);
  }, 30_000);
});
