import { describe, expect, test } from "bun:test";
import { DockerIsol8 } from "../../src/engine/docker";
import { hasDocker } from "./setup";

describe("Integration: Streaming Output", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  const engine = new DockerIsol8({
    mode: "ephemeral",
    network: "none",
  });

  test("Python: streams stdout chunks", async () => {
    const events: any[] = [];

    for await (const event of engine.executeStream({
      code: "import time; print('start'); time.sleep(0.1); print('end')",
      runtime: "python",
    })) {
      events.push(event);
    }

    const stdout = events
      .filter((e) => e.type === "stdout")
      .map((e) => e.data)
      .join("");
    expect(stdout).toContain("start");
    expect(stdout).toContain("end");

    const exit = events.find((e) => e.type === "exit");
    expect(exit).toBeDefined();
    expect(exit.data).toBe("0");
  }, 30_000);

  test("Streaming Error Handling", async () => {
    const events: any[] = [];

    for await (const event of engine.executeStream({
      code: "raise ValueError('boom')",
      runtime: "python",
    })) {
      events.push(event);
    }

    const stderr = events
      .filter((e) => e.type === "stderr")
      .map((e) => e.data)
      .join("");
    expect(stderr).toContain("ValueError");
    expect(stderr).toContain("boom");

    const exit = events.find((e) => e.type === "exit");
    expect(exit).toBeDefined();
    expect(exit.data).not.toBe("0");
  }, 30_000);
});
