/**
 * Production tests: All runtimes
 * Tests: python, node, bun, deno, bash with various operations
 */

import { describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runIsol8 } from "./utils";

describe("Runtime: Python", () => {
  test("basic print", async () => {
    const { stdout } = await runIsol8("run -e \"print('hello python')\" -r python --no-stream");
    expect(stdout).toContain("hello python");
  }, 30_000);

  test("import stdlib", async () => {
    const { stdout } = await runIsol8(
      "run -e \"import json; print(json.dumps({'key': 'value'}))\" -r python --no-stream"
    );
    expect(stdout).toContain('{"key": "value"}');
  }, 30_000);

  test("stderr capture", async () => {
    const { stderr } = await runIsol8(
      "run -e \"import sys; sys.stderr.write('error message')\" -r python --no-stream"
    );
    expect(stderr).toContain("error message");
  }, 30_000);

  test("exit code propagation", async () => {
    try {
      await runIsol8('run -e "import sys; sys.exit(5)" -r python --no-stream');
      throw new Error("Should have failed");
    } catch (err: any) {
      expect(err.code).toBe(5);
    }
  }, 30_000);

  test(".py file execution", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-test-"));
    const filePath = join(tmpDir, "script.py");

    try {
      writeFileSync(filePath, "# Python script\nprint('from file')");
      const { stdout } = await runIsol8(`run ${filePath} --no-stream`);
      expect(stdout).toContain("from file");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30_000);
});

describe("Runtime: Node.js", () => {
  test("basic console.log", async () => {
    const { stdout } = await runIsol8("run -e \"console.log('hello node')\" -r node --no-stream");
    expect(stdout).toContain("hello node");
  }, 30_000);

  test("require() works", async () => {
    const { stdout } = await runIsol8(
      "run -e \"const os = require('os'); console.log(os.platform())\" -r node --no-stream"
    );
    expect(stdout).toContain("linux");
  }, 30_000);

  test(".js file execution", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-test-"));
    const filePath = join(tmpDir, "script.js");

    try {
      writeFileSync(filePath, "console.log('node file');");
      const { stdout } = await runIsol8(`run ${filePath} --no-stream`);
      expect(stdout).toContain("node file");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30_000);

  test(".cjs CommonJS file", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-test-"));
    const filePath = join(tmpDir, "script.cjs");

    try {
      writeFileSync(filePath, "const fs = require('fs'); console.log('CJS works');");
      const { stdout } = await runIsol8(`run ${filePath} --no-stream`);
      expect(stdout).toContain("CJS works");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30_000);
});

describe("Runtime: Bun", () => {
  test("basic console.log", async () => {
    const { stdout } = await runIsol8("run -e \"console.log('hello bun')\" -r bun --no-stream");
    expect(stdout).toContain("hello bun");
  }, 30_000);

  test("fetch is available with network", async () => {
    const code = `
try {
  const res = await fetch('https://api.github.com');
  console.log('fetch-ok');
} catch (e) {
  console.log('fetch-failed');
}
`;
    const { stdout } = await runIsol8(`run -e '${code}' -r bun --net host --no-stream`);
    expect(stdout).toContain("fetch-ok");
  }, 30_000);

  test(".ts file execution", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-test-"));
    const filePath = join(tmpDir, "script.ts");

    try {
      writeFileSync(filePath, "const x: number = 42; console.log(x);");
      const { stdout } = await runIsol8(`run ${filePath} --no-stream`);
      expect(stdout).toContain("42");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30_000);
});

describe("Runtime: Deno", () => {
  test("basic console.log", async () => {
    const { stdout } = await runIsol8("run -e \"console.log('hello deno')\" -r deno --no-stream");
    expect(stdout).toContain("hello deno");
  }, 30_000);

  test("permissions work", async () => {
    const { stdout } = await runIsol8('run -e "console.log(Deno.pid)" -r deno --no-stream');
    expect(stdout).toMatch(/\d+/);
  }, 30_000);

  test(".ts file execution", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-test-"));
    const filePath = join(tmpDir, "script.ts");

    try {
      writeFileSync(filePath, "console.log('deno typescript');");
      const { stdout } = await runIsol8(`run ${filePath} --no-stream`);
      expect(stdout).toContain("deno typescript");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30_000);
});

describe("Runtime: Bash", () => {
  test("basic echo", async () => {
    const { stdout } = await runIsol8('run -e "echo hello bash" -r bash --no-stream');
    expect(stdout).toContain("hello bash");
  }, 30_000);

  test("pipelines work", async () => {
    const { stdout } = await runIsol8('run -e "echo hello | tr a-z A-Z" -r bash --no-stream');
    expect(stdout).toContain("HELLO");
  }, 30_000);

  test("exit code propagation", async () => {
    try {
      await runIsol8('run -e "exit 7" -r bash --no-stream');
      throw new Error("Should have failed");
    } catch (err: any) {
      expect(err.code).toBe(7);
    }
  }, 30_000);

  test(".sh file execution", async () => {
    const tmpDir = mkdtempSync(join(tmpdir(), "isol8-prod-test-"));
    const filePath = join(tmpDir, "script.sh");

    try {
      writeFileSync(filePath, "#!/bin/bash\necho 'bash script'");
      const { stdout } = await runIsol8(`run ${filePath} --no-stream`);
      expect(stdout).toContain("bash script");
    } finally {
      rmSync(tmpDir, { recursive: true });
    }
  }, 30_000);
});
