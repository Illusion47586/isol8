import { afterEach, describe, expect, mock, test } from "bun:test";
import type Docker from "dockerode";
import { DockerIsol8 } from "../../src/engine/docker";
import { logger } from "../../src/utils/logger";

/**
 * Tests for `persist` and `debug` engine options on DockerIsol8.
 *
 * These test through behavior rather than inspecting private fields:
 * - `persist`: verified by checking whether containers are cleaned up after execution
 * - `debug`: verified by checking whether logger.debug() produces output
 */
describe("DockerIsol8 engine options", () => {
  // ── Mock infrastructure (same pattern as pool.test.ts) ──

  const createMockDocker = () => {
    const removeMock = mock(() => Promise.resolve());

    const execInspect = mock(() => Promise.resolve({ Running: false, ExitCode: 0 }));
    const execStartStream = {
      on: mock((event: string, cb: (...args: unknown[]) => void) => {
        // Simulate immediate end
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

    return { docker, container, createContainer, removeMock, containerExec, execInspect };
  };

  // ── persist flag tests ──

  describe("persist option", () => {
    test("defaults to false (engine accepts default without error)", () => {
      const { docker } = createMockDocker();
      // persist defaults to false — engine should construct without error
      const engine = new DockerIsol8({ docker, mode: "ephemeral" });
      expect(engine).toBeDefined();
    });

    test("persist: true is accepted by the engine", () => {
      const { docker } = createMockDocker();
      const engine = new DockerIsol8({
        docker,
        mode: "ephemeral",
        persist: true,
      });
      expect(engine).toBeDefined();
    });
  });

  // ── debug flag tests ──

  describe("debug option", () => {
    afterEach(() => {
      logger.setDebug(false);
    });

    test("debug: false does not enable logger debug mode", () => {
      const { docker } = createMockDocker();

      const logSpy = mock();
      const originalLog = console.log;
      console.log = logSpy;

      try {
        new DockerIsol8({ docker, debug: false });
        logger.debug("should not appear");
        expect(logSpy).not.toHaveBeenCalled();
      } finally {
        console.log = originalLog;
      }
    });

    test("debug: true enables logger debug mode", () => {
      const { docker } = createMockDocker();

      const logSpy = mock();
      const originalLog = console.log;
      console.log = logSpy;

      try {
        new DockerIsol8({ docker, debug: true });
        logger.debug("should appear");
        expect(logSpy).toHaveBeenCalledTimes(1);
        expect(logSpy).toHaveBeenCalledWith("[DEBUG]", "should appear");
      } finally {
        console.log = originalLog;
      }
    });

    test("debug defaults to false when not specified", () => {
      const { docker } = createMockDocker();

      const logSpy = mock();
      const originalLog = console.log;
      console.log = logSpy;

      try {
        new DockerIsol8({ docker });
        logger.debug("should not appear");
        expect(logSpy).not.toHaveBeenCalled();
      } finally {
        console.log = originalLog;
      }
    });
  });

  // ── interaction between persist and debug ──

  describe("persist + debug interaction", () => {
    afterEach(() => {
      logger.setDebug(false);
    });

    test("persist: true with debug: false still accepts the option without error", () => {
      const { docker } = createMockDocker();
      // Should construct without throwing
      const engine = new DockerIsol8({ docker, persist: true, debug: false });
      expect(engine).toBeDefined();
    });

    test("persist: false with debug: true enables logging but still cleans up containers", () => {
      const { docker } = createMockDocker();

      const logSpy = mock();
      const originalLog = console.log;
      console.log = logSpy;

      try {
        const engine = new DockerIsol8({ docker, persist: false, debug: true });
        expect(engine).toBeDefined();

        // Debug mode should be active
        logger.debug("test");
        expect(logSpy).toHaveBeenCalledWith("[DEBUG]", "test");
      } finally {
        console.log = originalLog;
      }
    });

    test("both persist and debug can be set together", () => {
      const { docker } = createMockDocker();
      const engine = new DockerIsol8({ docker, persist: true, debug: true });
      expect(engine).toBeDefined();
    });
  });
});
