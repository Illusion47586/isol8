import { afterAll, describe, expect, test } from "bun:test";
import { DockerIsol8 } from "../../src/engine/docker";
import { hasDocker } from "./setup";

describe("Integration: Persistent Execution & File I/O", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  const engine = new DockerIsol8({
    mode: "persistent",
    network: "none",
    memoryLimit: "128m",
  });

  afterAll(async () => {
    await engine.stop();
  });

  test("State preservation across executions", async () => {
    await engine.start();

    // Set variable
    await engine.execute({
      code: "x = 100",
      runtime: "python",
    });

    // Read variable
    const result = await engine.execute({
      code: "print(x)",
      runtime: "python",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("100");
    expect(result.stdout.trim()).toBe("100");
  });

  test("Bash: State preservation (file based)", async () => {
    // Write file in one exec
    await engine.execute({
      code: "echo 'hello bash' > /tmp/bash_state",
      runtime: "bash",
    });

    // Read file in next exec
    const result = await engine.execute({
      code: "cat /tmp/bash_state",
      runtime: "bash",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello bash");
  });

  test("File Upload (putFile)", async () => {
    await engine.putFile("/sandbox/input.txt", "Hello from host");

    const result = await engine.execute({
      code: "print(open('/sandbox/input.txt').read())",
      runtime: "python",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hello from host");
  });

  test("File Download (getFile)", async () => {
    await engine.execute({
      code: "with open('/sandbox/output.txt', 'w') as f: f.write('Hello from container')",
      runtime: "python",
    });

    const content = await engine.getFile("/sandbox/output.txt");
    expect(content.toString("utf-8")).toBe("Hello from container");
  });
});
