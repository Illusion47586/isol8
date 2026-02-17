/**
 * Production tests: CLI run command with all flags
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIsol8, spawnIsol8 } from "./utils";

describe("CLI Run - Basic", () => {
  test("-e runs inline code", async () => {
    const { stdout } = await runIsol8('run -e "print(1+1)" --runtime python --no-stream');
    expect(stdout).toContain("2");
  }, 30_000);

  test("default runtime is Python", async () => {
    const { stdout } = await runIsol8('run -e "print(42)" --no-stream');
    expect(stdout).toContain("42");
  }, 30_000);

  test("explicit runtime -r node", async () => {
    const { stdout } = await runIsol8('run -e "console.log(123)" -r node --no-stream');
    expect(stdout).toContain("123");
  }, 30_000);
});

describe("CLI Run - File Input", () => {
  test("file-based execution with auto-detected runtime", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-"));
    const filePath = join(tmpDir, "test.py");

    try {
      writeFileSync(filePath, 'print("file-based")');
      const { stdout } = await runIsol8(`run ${filePath} --no-stream`);
      expect(stdout).toContain("file-based");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30_000);

  test("file-based execution with .js extension", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-"));
    const filePath = join(tmpDir, "test.js");

    try {
      writeFileSync(filePath, "console.log('js-file');");
      const { stdout } = await runIsol8(`run ${filePath} --no-stream`);
      expect(stdout).toContain("js-file");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30_000);

  test("missing file exits with error", async () => {
    try {
      await runIsol8("run /nonexistent/file.py --no-stream");
      throw new Error("Should have failed");
    } catch (err: any) {
      expect(err.code).toBe(1);
      expect(err.stderr).toContain("File not found");
    }
  });
});

describe("CLI Run - Resource Limits", () => {
  test("--timeout enforces execution timeout", async () => {
    const start = performance.now();
    try {
      await runIsol8('run -e "import time; time.sleep(30)" -r python --timeout 1000 --no-stream', {
        timeout: 15_000,
      });
      throw new Error("Should have timed out");
    } catch {
      const elapsed = performance.now() - start;
      expect(elapsed).toBeLessThan(10_000);
    }
  }, 15_000);

  test("--memory flag is accepted", async () => {
    const { stdout } = await runIsol8('run -e "print(1)" -r python --memory 256m --no-stream');
    expect(stdout).toContain("1");
  }, 30_000);

  test("--cpu flag is accepted", async () => {
    const { stdout } = await runIsol8('run -e "print(2)" -r python --cpu 0.5 --no-stream');
    expect(stdout).toContain("2");
  }, 30_000);

  test("--pids-limit flag is accepted", async () => {
    const { stdout } = await runIsol8('run -e "print(3)" -r python --pids-limit 32 --no-stream');
    expect(stdout).toContain("3");
  }, 30_000);
});

describe("CLI Run - Network", () => {
  test("--net none blocks network access", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-"));
    const filePath = join(tmpDir, "test.py");

    try {
      writeFileSync(
        filePath,
        `
import urllib.request
try:
    urllib.request.urlopen("https://example.com", timeout=3)
    print("success")
except:
    print("blocked")
`
      );
      const { stdout } = await runIsol8(`run ${filePath} -r python --net none --no-stream`);
      expect(stdout).toContain("blocked");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30_000);

  test("--net filtered with --allow and --deny", async () => {
    const proc = spawnIsol8([
      "run",
      "-e",
      "print(7)",
      "-r",
      "python",
      "--net",
      "filtered",
      "--allow",
      "example\\.com",
      "--deny",
      "evil\\.com",
      "--no-stream",
    ]);

    const exitCode = await new Promise((resolve) => {
      proc.on("exit", resolve);
    });
    expect(exitCode).toBe(0);
  }, 30_000);
});

describe("CLI Run - Security", () => {
  test("--secret masks secret values in output", async () => {
    const { stdout } = await runIsol8(
      "run -e \"import os; print(os.environ['MY_KEY'])\" -r python --secret MY_KEY=supersecret123 --no-stream"
    );
    expect(stdout).not.toContain("supersecret123");
    expect(stdout).toContain("***");
  }, 30_000);

  test("--secret with multiple secrets", async () => {
    const { stdout } = await runIsol8(
      "run -e \"import os; print(os.environ['A'], os.environ['B'])\" -r python --secret A=aaa --secret B=bbb --no-stream"
    );
    expect(stdout).not.toContain("aaa");
    expect(stdout).not.toContain("bbb");
  }, 30_000);
});

describe("CLI Run - Output Options", () => {
  test("--max-output truncates large output", async () => {
    const { stdout, stderr } = await runIsol8(
      "run -e \"print('x' * 10000)\" -r python --max-output 1024 --no-stream"
    );
    const combined = stdout + stderr;
    expect(combined).toContain("truncated");
  }, 30_000);

  test("--out writes output to file", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-"));
    const outFile = join(tmpDir, "output.txt");

    try {
      await runIsol8(`run -e "print('file-output')" -r python --no-stream --out ${outFile}`);
      const content = await Bun.file(outFile).text();
      expect(content).toContain("file-output");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30_000);
});

describe("CLI Run - Filesystem", () => {
  test("--sandbox-size flag is accepted", async () => {
    const { stdout } = await runIsol8(
      'run -e "print(4)" -r python --sandbox-size 256m --no-stream'
    );
    expect(stdout).toContain("4");
  }, 30_000);

  test("--tmp-size flag is accepted", async () => {
    const { stdout } = await runIsol8('run -e "print(5)" -r python --tmp-size 128m --no-stream');
    expect(stdout).toContain("5");
  }, 30_000);

  test("--writable allows writing to sandbox", async () => {
    const { stdout } = await runIsol8(
      "run -e \"import os; os.makedirs('/sandbox/test_dir', exist_ok=True); print('writable-ok')\" -r python --writable --no-stream"
    );
    expect(stdout).toContain("writable-ok");
  }, 30_000);
});

describe("CLI Run - Execution Modes", () => {
  test("--persistent sets persistent container mode", async () => {
    const { stdout } = await runIsol8(
      "run -e \"print('persistent-mode')\" -r python --persistent --no-stream"
    );
    expect(stdout).toContain("persistent-mode");
  }, 30_000);

  test("--stdin pipes data to execution", async () => {
    const { stdout } = await runIsol8(
      'run -e "import sys; print(sys.stdin.read())" -r python --stdin "hello-stdin" --no-stream'
    );
    expect(stdout).toContain("hello-stdin");
  }, 30_000);

  test("--debug enables debug logging", async () => {
    const { stdout, stderr } = await runIsol8(
      "run -e \"print('debug-test')\" -r python --debug --no-stream"
    );
    const combined = stdout + stderr;
    expect(combined).toContain("[DEBUG]");
  }, 30_000);

  test("--install installs a package", async () => {
    const { stdout } = await runIsol8(
      'run -e "import requests; print(requests.__version__)" -r python --install requests --net host --no-stream',
      { timeout: 120_000 }
    );
    expect(stdout).toMatch(/\d+\.\d+/);
  }, 120_000);
});

describe("CLI Run - Exit Codes", () => {
  test("exit code 0 for successful execution", async () => {
    const proc = spawnIsol8(["run", "-e", 'print("ok")', "-r", "python", "--no-stream"]);
    const exitCode = await new Promise((resolve) => {
      proc.on("exit", resolve);
    });
    expect(exitCode).toBe(0);
  }, 30_000);

  test("exit code is propagated from executed code", async () => {
    const proc = spawnIsol8([
      "run",
      "-e",
      "import sys; sys.exit(42)",
      "-r",
      "python",
      "--no-stream",
    ]);
    const exitCode = await new Promise((resolve) => {
      proc.on("exit", resolve);
    });
    expect(exitCode).toBe(42);
  }, 30_000);
});

describe("CLI Run - Streaming", () => {
  test("streams output by default", async () => {
    const proc = spawnIsol8([
      "run",
      "-e",
      'import time; print("start"); time.sleep(0.5); print("end")',
      "-r",
      "python",
      "--net",
      "none",
    ]);

    const chunks: string[] = [];
    if (proc.stdout) {
      proc.stdout.on("data", (data) => {
        chunks.push(data.toString());
      });
    }

    await new Promise<void>((resolve) => {
      proc.on("close", () => resolve());
    });

    const output = chunks.join("");
    expect(output).toContain("start");
    expect(output).toContain("end");
  }, 30_000);

  test("--no-stream buffers output", async () => {
    const { stdout } = await runIsol8(
      'run -e "print(1); import time; time.sleep(0.1); print(2)" -r python --no-stream'
    );
    expect(stdout).toContain("1");
    expect(stdout).toContain("2");
  }, 30_000);
});
