import { describe, expect, mock, test } from "bun:test";
import type Docker from "dockerode";
import { DockerIsol8 } from "../../src/engine/docker";

/**
 * Tests for the agent runtime validation logic in DockerIsol8.
 *
 * The engine enforces that agent runtime executions use network: "filtered"
 * with at least one whitelist entry. These tests verify that constraint
 * via the public execute() API.
 */
describe("Agent runtime validation", () => {
  const createMockDocker = () => {
    const removeMock = mock(() => Promise.resolve());

    const execInspect = mock(() => Promise.resolve({ Running: false, ExitCode: 0 }));
    const execStartStream = {
      on: mock((event: string, cb: (...args: unknown[]) => void) => {
        if (event === "end") {
          setTimeout(() => cb(), 0);
        }
        return execStartStream;
      }),
    };
    const execStart = mock(() => Promise.resolve(execStartStream));

    const containerExec = mock(() =>
      Promise.resolve({
        start: execStart,
        inspect: execInspect,
      })
    );

    const container = {
      id: "mock-container-id",
      start: mock(() => Promise.resolve()),
      stop: mock(() => Promise.resolve()),
      exec: containerExec,
      inspect: mock(() => Promise.resolve({ State: { Running: true } })),
      remove: removeMock,
      modem: { demuxStream: mock() },
    } as unknown as Docker.Container;

    const createContainer = mock(() => Promise.resolve(container));
    const getImage = mock(() => ({
      inspect: mock(() => Promise.reject(new Error("no custom image"))),
    }));

    const docker = {
      createContainer,
      getImage,
    } as unknown as Docker;

    return { docker, container, createContainer, removeMock };
  };

  // ── Validation: network mode ──

  test("rejects agent runtime with network: 'none'", async () => {
    const { docker } = createMockDocker();
    const engine = new DockerIsol8({
      docker,
      mode: "ephemeral",
      network: "none",
    });

    await expect(
      engine.execute({
        code: "Write hello world",
        runtime: "agent",
      })
    ).rejects.toThrow('Agent runtime requires network mode "filtered"');
  });

  test("rejects agent runtime with network: 'host'", async () => {
    const { docker } = createMockDocker();
    const engine = new DockerIsol8({
      docker,
      mode: "ephemeral",
      network: "host",
    });

    await expect(
      engine.execute({
        code: "Write hello world",
        runtime: "agent",
      })
    ).rejects.toThrow('Agent runtime requires network mode "filtered"');
  });

  // ── Validation: whitelist required ──

  test("rejects agent runtime with empty whitelist", async () => {
    const { docker } = createMockDocker();
    const engine = new DockerIsol8({
      docker,
      mode: "ephemeral",
      network: "filtered",
      networkFilter: {
        whitelist: [],
        blacklist: [],
      },
    });

    await expect(
      engine.execute({
        code: "Write hello world",
        runtime: "agent",
      })
    ).rejects.toThrow("Agent runtime requires at least one network whitelist entry");
  });

  test("rejects agent runtime with filtered network but no networkFilter", async () => {
    const { docker } = createMockDocker();
    const engine = new DockerIsol8({
      docker,
      mode: "ephemeral",
      network: "filtered",
      // No networkFilter → whitelist defaults to empty
    });

    await expect(
      engine.execute({
        code: "Write hello world",
        runtime: "agent",
      })
    ).rejects.toThrow("Agent runtime requires at least one network whitelist entry");
  });

  // ── Validation: valid configurations ──

  test("accepts agent runtime with filtered network and whitelist", () => {
    const { docker } = createMockDocker();
    // Construction should succeed — validation happens in execute()
    const engine = new DockerIsol8({
      docker,
      mode: "ephemeral",
      network: "filtered",
      networkFilter: {
        whitelist: ["^api\\.anthropic\\.com$"],
        blacklist: [],
      },
    });
    expect(engine).toBeDefined();
  });

  // ── Non-agent runtimes skip validation ──

  test("non-agent runtimes are not affected by agent validation", async () => {
    const { docker } = createMockDocker();
    const engine = new DockerIsol8({
      docker,
      mode: "ephemeral",
      network: "none",
    });

    // Python with network: none should NOT throw the agent validation error
    // (it may fail for other mock-related reasons, but NOT with the agent error)
    try {
      await engine.execute({
        code: 'print("hello")',
        runtime: "python",
      });
    } catch (e: unknown) {
      const msg = (e as Error).message;
      expect(msg).not.toContain("Agent runtime requires");
    }
  });
});
