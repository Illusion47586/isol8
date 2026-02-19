import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RemoteIsol8 } from "../../src/client/remote";
import { createServer } from "../../src/server/index";
import { hasDocker } from "./setup";

describe("Integration: Server Auto-Pruner", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  const PORT = 4568;
  const API_KEY = "integration-test-key";
  let server: Awaited<ReturnType<typeof createServer>>;
  let serverInstance: any;

  beforeAll(async () => {
    server = await createServer({ port: PORT, apiKey: API_KEY });
    serverInstance = Bun.serve({
      fetch: server.app.fetch,
      port: PORT,
    });
  });

  afterAll(async () => {
    serverInstance.stop();
    await server.shutdown(false);
  });

  test("active session should not be pruned during long execution", async () => {
    const sessionId = "pruner-test-session";
    const client = new RemoteIsol8(
      { host: `http://localhost:${PORT}`, apiKey: API_KEY, sessionId },
      { network: "none" }
    );

    await client.start();

    const result = await client.execute({
      code: "import time; print('starting'); time.sleep(3); print('finished')",
      runtime: "python",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("starting");
    expect(result.stdout).toContain("finished");

    await client.stop();
  }, 30_000);

  test("session should remain accessible after execution completes", async () => {
    const sessionId = "session-persist-test";
    const client = new RemoteIsol8(
      { host: `http://localhost:${PORT}`, apiKey: API_KEY, sessionId },
      { network: "none" }
    );

    await client.start();

    const result1 = await client.execute({
      code: "print('first execution')",
      runtime: "python",
    });
    expect(result1.exitCode).toBe(0);

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const result2 = await client.execute({
      code: "print('second execution')",
      runtime: "python",
    });
    expect(result2.exitCode).toBe(0);
    expect(result2.stdout).toContain("second execution");

    await client.stop();
  }, 30_000);
});
