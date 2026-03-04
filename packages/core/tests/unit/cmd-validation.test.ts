import { describe, expect, test } from "bun:test";
import { DockerIsol8 } from "../../src/engine/docker";

class TestDockerIsol8 extends DockerIsol8 {
  testResolveExecutionRequest(req: any) {
    return (this as any).resolveExecutionRequest(req);
  }
}

const engine = new TestDockerIsol8({ mode: "ephemeral" });

describe("resolveExecutionRequest — cmd mutual exclusion", () => {
  test("accepts cmd alone", async () => {
    const result = await engine.testResolveExecutionRequest({
      cmd: "echo hello",
      runtime: "bash",
    });
    expect(result.cmd).toBe("echo hello");
    expect(result.code).toBeUndefined();
  });

  test("accepts code alone", async () => {
    const result = await engine.testResolveExecutionRequest({
      code: "print('hi')",
      runtime: "python",
    });
    expect(result.code).toBe("print('hi')");
    expect(result.cmd).toBeUndefined();
  });

  test("rejects cmd + code together", async () => {
    expect(
      engine.testResolveExecutionRequest({
        cmd: "echo hello",
        code: "print('hi')",
        runtime: "python",
      })
    ).rejects.toThrow("mutually exclusive");
  });

  test("rejects cmd + codeUrl together", async () => {
    expect(
      engine.testResolveExecutionRequest({
        cmd: "echo hello",
        codeUrl: "https://example.com/script.py",
        runtime: "python",
      })
    ).rejects.toThrow("mutually exclusive");
  });

  test("rejects code + codeUrl together (existing behaviour)", async () => {
    expect(
      engine.testResolveExecutionRequest({
        code: "print('hi')",
        codeUrl: "https://example.com/script.py",
        runtime: "python",
      })
    ).rejects.toThrow("mutually exclusive");
  });

  test("rejects empty request (no code, codeUrl, or cmd)", async () => {
    expect(
      engine.testResolveExecutionRequest({
        runtime: "python",
      })
    ).rejects.toThrow("exactly one of");
  });

  test("treats whitespace-only cmd as absent", async () => {
    expect(
      engine.testResolveExecutionRequest({
        cmd: "   ",
        runtime: "bash",
      })
    ).rejects.toThrow("exactly one of");
  });

  test("cmd value is preserved on the returned request", async () => {
    const result = await engine.testResolveExecutionRequest({
      cmd: "npm test",
      runtime: "node",
      env: { NODE_ENV: "test" },
    });
    expect(result.cmd).toBe("npm test");
    expect(result.runtime).toBe("node");
    expect(result.env).toEqual({ NODE_ENV: "test" });
  });
});
