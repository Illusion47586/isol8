import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { RemoteIsol8 } from "../../src/client/remote";
import { createServer } from "../../src/server/index";
import { hasDocker } from "./setup";

describe("Integration: Server & Client", () => {
  if (!hasDocker) {
    test.skip("Docker not available", () => {});
    return;
  }

  const PORT = 4567;
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

  afterAll(() => {
    serverInstance.stop();
  });

  test("Remote execution (Hello World)", async () => {
    const client = new RemoteIsol8(
      { host: `http://localhost:${PORT}`, apiKey: API_KEY },
      { network: "none" }
    );

    await client.start();
    const result = await client.execute({
      code: 'print("Hello Remote")',
      runtime: "python",
    });

    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("Hello Remote");
    await client.stop();
  }, 30_000);

  test("Auth failure (Wrong Key)", async () => {
    const client = new RemoteIsol8(
      { host: `http://localhost:${PORT}`, apiKey: "wrong-key" },
      { network: "none" }
    );

    // execute should fail with 403
    try {
      await client.execute({ code: "print(1)", runtime: "python" });
      throw new Error("Should have failed");
    } catch (e: any) {
      expect(e.message).toContain("Invalid API key");
    }
  }, 30_000);

  test("Persistent Session & File I/O", async () => {
    const sessionId = "integ-session-1";
    const client = new RemoteIsol8(
      { host: `http://localhost:${PORT}`, apiKey: API_KEY, sessionId },
      { network: "none" }
    );

    // 1. Execute first to create the persistent session
    const initResult = await client.execute({
      code: "print('session started')",
      runtime: "python",
    });
    expect(initResult.exitCode).toBe(0);

    // 2. Upload file
    await client.putFile("/sandbox/data.txt", "remote-file-content");

    // 3. Read file via execution
    const result = await client.execute({
      code: "print(open('/sandbox/data.txt').read())",
      runtime: "python",
    });
    expect(result.stdout).toContain("remote-file-content");

    // 4. Download file
    const content = await client.getFile("/sandbox/data.txt");
    expect(content.toString()).toBe("remote-file-content");

    await client.stop();
  }, 30_000);
});
