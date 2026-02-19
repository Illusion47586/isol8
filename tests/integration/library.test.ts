/**
 * Integration tests for programmatic (library) usage of isol8.
 *
 * These tests validate the public API surface as a consumer would use it:
 * importing from the package entry point, constructing engines with various
 * options, and exercising features like env injection, secret masking,
 * output truncation, concurrent execution, and lifecycle management.
 */

import { describe, expect, test } from "bun:test";
import {
  BunAdapter,
  DenoAdapter,
  DockerIsol8,
  type ExecutionResult,
  type Isol8Engine,
  loadConfig,
  NodeAdapter,
  PythonAdapter,
  RuntimeRegistry,
} from "../../src/index";
import { hasDocker } from "./setup";

describe("Library: Public API Imports", () => {
  test("All public exports are importable and defined", () => {
    expect(DockerIsol8).toBeDefined();
    expect(RuntimeRegistry).toBeDefined();
    expect(PythonAdapter).toBeDefined();
    expect(NodeAdapter).toBeDefined();
    expect(BunAdapter).toBeDefined();
    expect(DenoAdapter).toBeDefined();
    expect(loadConfig).toBeDefined();
  });

  test("RuntimeRegistry lists all built-in adapters", () => {
    const adapters = RuntimeRegistry.list();
    const names = adapters.map((a) => a.name);
    expect(names).toContain("python");
    expect(names).toContain("node");
    expect(names).toContain("bun");
    expect(names).toContain("deno");
    expect(names).toContain("bash");
  });

  test("loadConfig returns valid default config", () => {
    const config = loadConfig();
    expect(config.maxConcurrent).toBeGreaterThan(0);
    expect(config.defaults.timeoutMs).toBeGreaterThan(0);
    expect(config.defaults.memoryLimit).toBeDefined();
    expect(config.cleanup.maxContainerAgeMs).toBeGreaterThan(0);
  });
});

describe("Library: DockerIsol8 as Isol8Engine", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  test("DockerIsol8 implements Isol8Engine interface", () => {
    const engine: Isol8Engine = new DockerIsol8();
    expect(typeof engine.start).toBe("function");
    expect(typeof engine.stop).toBe("function");
    expect(typeof engine.execute).toBe("function");
    expect(typeof engine.putFile).toBe("function");
    expect(typeof engine.getFile).toBe("function");
  });

  test("start() and stop() lifecycle is safe to call multiple times", async () => {
    const engine = new DockerIsol8({ mode: "ephemeral", network: "none" });
    // start should be idempotent and safe across repeated calls
    await engine.start();
    await engine.start();
    // stop with no container should not throw
    await engine.stop();
    await engine.stop();
  }, 10_000);

  test("start() accepts prewarm options", async () => {
    const engine = new DockerIsol8({ mode: "ephemeral", network: "none" });
    await engine.start({ prewarm: { runtimes: ["python"] } });
    await engine.stop();
  }, 15_000);
});

describe("Library: Environment Variable Injection", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  const engine = new DockerIsol8({ mode: "ephemeral", network: "none" });

  test("Custom env vars are available inside execution", async () => {
    const result = await engine.execute({
      code: "import os; print(os.environ.get('MY_VAR', 'not set'))",
      runtime: "python",
      env: { MY_VAR: "hello_from_env" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("hello_from_env");
  }, 30_000);

  test("Multiple env vars are injected correctly", async () => {
    const result = await engine.execute({
      code: "import os; print(os.environ['A'], os.environ['B'])",
      runtime: "python",
      env: { A: "alpha", B: "beta" },
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("alpha beta");
  }, 30_000);
});

describe("Library: Secret Masking", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  test("Secrets in stdout are replaced with ***", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      secrets: { API_KEY: "super-secret-key-123" },
    });

    const result = await engine.execute({
      code: "import os; print('Key is:', os.environ['API_KEY'])",
      runtime: "python",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).not.toContain("super-secret-key-123");
    expect(result.stdout).toContain("***");
  }, 30_000);

  test("Secrets in stderr are also masked", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      secrets: { TOKEN: "my-token-value" },
    });

    const result = await engine.execute({
      code: "import os, sys; print('Token:', os.environ['TOKEN'], file=sys.stderr)",
      runtime: "python",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).not.toContain("my-token-value");
    expect(result.stderr).toContain("***");
  }, 30_000);
});

describe("Library: Output Truncation", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  test("Large output is truncated and flagged", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      maxOutputSize: 1024, // 1KB limit
    });

    // Generate ~10KB of output
    const result = await engine.execute({
      code: "print('x' * 10000)",
      runtime: "python",
    });

    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThan(2048); // Should be truncated well below 10KB
  }, 30_000);

  test("Small output is not truncated", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      maxOutputSize: 1024 * 1024, // 1MB limit (default)
    });

    const result = await engine.execute({
      code: "print('short output')",
      runtime: "python",
    });

    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(false);
    expect(result.stdout).toContain("short output");
  }, 30_000);
});

describe("Library: Concurrent Execution", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  test("Multiple executions run concurrently within semaphore limit", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      memoryLimit: "64m",
    });

    // Launch 3 concurrent executions
    const promises = [
      engine.execute({ code: "print('a')", runtime: "python" }),
      engine.execute({ code: "console.log('b')", runtime: "node" }),
      engine.execute({ code: "echo c", runtime: "bash" }),
    ];

    const results = await Promise.all(promises);

    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.exitCode).toBe(0);
    }
    expect(results[0]!.stdout).toContain("a");
    expect(results[1]!.stdout).toContain("b");
    expect(results[2]!.stdout).toContain("c");
  }, 60_000);
});

describe("Library: Execution Result Shape", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  const engine = new DockerIsol8({ mode: "ephemeral", network: "none" });

  test("Result contains all expected fields with correct types", async () => {
    const result: ExecutionResult = await engine.execute({
      code: "print('hello')",
      runtime: "python",
    });

    expect(typeof result.stdout).toBe("string");
    expect(typeof result.stderr).toBe("string");
    expect(typeof result.exitCode).toBe("number");
    expect(typeof result.durationMs).toBe("number");
    expect(typeof result.truncated).toBe("boolean");
    expect(result.durationMs).toBeGreaterThan(0);
  }, 30_000);

  test("durationMs reflects actual execution time", async () => {
    const result = await engine.execute({
      code: "import time; time.sleep(0.5); print('done')",
      runtime: "python",
    });

    expect(result.exitCode).toBe(0);
    // Should take at least 500ms due to sleep
    expect(result.durationMs).toBeGreaterThanOrEqual(400);
  }, 30_000);
});

describe("Library: Persistent Mode Lifecycle", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  test("Switching runtimes in persistent mode throws an error", async () => {
    const engine = new DockerIsol8({
      mode: "persistent",
      network: "none",
    });

    try {
      // First execution with Python — creates container
      const r1 = await engine.execute({
        code: "print('python running')",
        runtime: "python",
      });
      expect(r1.exitCode).toBe(0);

      // Switching to Node should throw — persistent containers are single-runtime
      await expect(
        engine.execute({
          code: "console.log('node running')",
          runtime: "node",
        })
      ).rejects.toThrow("Cannot switch runtime");
    } finally {
      await engine.stop();
    }
  }, 60_000);

  test("putFile/getFile require an active container", async () => {
    const engine = new DockerIsol8({
      mode: "persistent",
      network: "none",
    });

    // No container started yet — putFile should throw
    try {
      await engine.putFile("/sandbox/test.txt", "data");
      throw new Error("Should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("No active container");
    }

    // No container started yet — getFile should throw
    try {
      await engine.getFile("/sandbox/test.txt");
      throw new Error("Should have thrown");
    } catch (e: any) {
      expect(e.message).toContain("No active container");
    }
  }, 10_000);
});

describe("Library: Error Handling", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  test("Invalid runtime throws descriptive error", () => {
    expect(() => RuntimeRegistry.get("ruby")).toThrow("Unknown runtime");
  });

  test("Syntax errors are captured in stderr", async () => {
    const engine = new DockerIsol8({ mode: "ephemeral", network: "none" });
    const result = await engine.execute({
      code: "def broken(:",
      runtime: "python",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("SyntaxError");
  }, 30_000);

  test("Runtime errors produce non-zero exit code", async () => {
    const engine = new DockerIsol8({ mode: "ephemeral", network: "none" });
    const result = await engine.execute({
      code: "raise ValueError('boom')",
      runtime: "python",
    });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr).toContain("ValueError");
    expect(result.stderr).toContain("boom");
  }, 30_000);
});

describe("Library: Custom Timeout", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  test("Per-request timeout overrides default", async () => {
    // Engine default is 30s, but request specifies 1s
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      timeoutMs: 30_000,
    });

    const start = performance.now();
    const result = await engine.execute({
      code: "import time; time.sleep(10)",
      runtime: "python",
      timeoutMs: 1000,
    });
    const elapsed = performance.now() - start;

    // Should be killed well before the 10s sleep completes
    expect(elapsed).toBeLessThan(8000);
    expect(result.stderr).toContain("TIMED OUT");
  }, 30_000);

  test("Engine-level default timeout applies when request has none", async () => {
    const engine = new DockerIsol8({
      mode: "ephemeral",
      network: "none",
      timeoutMs: 1000, // 1s default
    });

    const start = performance.now();
    const result = await engine.execute({
      code: "import time; time.sleep(10)",
      runtime: "python",
      // No per-request timeout — engine default should apply
    });
    const elapsed = performance.now() - start;

    expect(elapsed).toBeLessThan(8000);
    expect(result.stderr).toContain("TIMED OUT");
  }, 30_000);
});

describe("Library: Multi-Runtime Ephemeral", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  const engine = new DockerIsol8({ mode: "ephemeral", network: "none" });

  test("Node.js execution with file path", async () => {
    const result = await engine.execute({
      code: "const x = 2 + 3; console.log('Result: ' + x);",
      runtime: "node",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Result: 5");
  }, 30_000);

  test("Bash with pipes and subshells", async () => {
    const result = await engine.execute({
      code: 'echo "hello world" | tr "a-z" "A-Z"',
      runtime: "bash",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("HELLO WORLD");
  }, 30_000);

  test("Bun TypeScript execution", async () => {
    const result = await engine.execute({
      code: "const greet = (name: string): string => 'Hi, ' + name + '!'; console.log(greet('isol8'));",
      runtime: "bun",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hi, isol8!");
  }, 30_000);

  test("Deno with permissions", async () => {
    const result = await engine.execute({
      code: "const encoder = new TextEncoder(); Deno.stdout.writeSync(encoder.encode('Deno works\\n'));",
      runtime: "deno",
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Deno works");
  }, 30_000);
});

describe("Library: Binary File I/O", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  test("putFile and getFile round-trip binary content", async () => {
    const engine = new DockerIsol8({
      mode: "persistent",
      network: "none",
    });

    try {
      // Create container first
      await engine.execute({ code: "print('init')", runtime: "python" });

      // Write binary content (all byte values 0-255)
      const binaryData = Buffer.alloc(256);
      for (let i = 0; i < 256; i++) {
        binaryData[i] = i;
      }

      await engine.putFile("/sandbox/binary.bin", binaryData);

      const retrieved = await engine.getFile("/sandbox/binary.bin");
      expect(Buffer.isBuffer(retrieved)).toBe(true);
      expect(retrieved.length).toBe(256);
      expect(retrieved.equals(binaryData)).toBe(true);
    } finally {
      await engine.stop();
    }
  }, 30_000);
});
