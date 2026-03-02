import { describe, expect, test } from "bun:test";
import { RuntimeRegistry } from "../../src/runtime";
import { AgentAdapter } from "../../src/runtime/adapters/agent";

// Import to register all adapters including agent
import "../../src/runtime";

// Mirror of the constant in agent.ts — kept in sync to catch drift.
const SP =
  "You are running inside an isol8 sandbox — a Docker container with strict " +
  "resource limits and controlled network access. isol8 exists to execute " +
  "untrusted code safely: outbound network is filtered to a whitelist, the " +
  "filesystem is ephemeral, and some system calls are restricted. Work within " +
  "these constraints: do not assume open internet access, do not rely on " +
  "persistent state across runs, and do not attempt to escape the sandbox.";

/** Shell-quoted version of SP for embedding in expected command strings. */
const SP_Q = `'${SP}'`;

describe("AgentAdapter", () => {
  test("is registered in RuntimeRegistry", () => {
    const adapter = RuntimeRegistry.get("agent");
    expect(adapter.name).toBe("agent");
    expect(adapter.image).toBe("isol8:agent");
  });

  test("appears in RuntimeRegistry.list()", () => {
    const names = RuntimeRegistry.list().map((a) => a.name);
    expect(names).toContain("agent");
  });

  test("file extension is .txt", () => {
    expect(AgentAdapter.getFileExtension()).toBe(".txt");
  });

  // ── getCommand (basic, no agent flags) ──

  test("getCommand wraps prompt in pi --no-session --append-system-prompt ... -p", () => {
    const cmd = AgentAdapter.getCommand("Write hello world");
    expect(cmd).toEqual([
      "bash",
      "-c",
      `pi --no-session --append-system-prompt ${SP_Q} -p 'Write hello world'`,
    ]);
  });

  test("getCommand shell-escapes single quotes in prompt", () => {
    const cmd = AgentAdapter.getCommand("it's a test");
    expect(cmd).toEqual([
      "bash",
      "-c",
      `pi --no-session --append-system-prompt ${SP_Q} -p 'it'\\''s a test'`,
    ]);
  });

  test("getCommand handles empty prompt", () => {
    const cmd = AgentAdapter.getCommand("");
    expect(cmd).toEqual(["bash", "-c", `pi --no-session --append-system-prompt ${SP_Q} -p ''`]);
  });

  test("getCommand handles prompt with special shell characters", () => {
    const cmd = AgentAdapter.getCommand('echo "hello" | grep $VAR && rm -rf /');
    expect(cmd[0]).toBe("bash");
    expect(cmd[1]).toBe("-c");
    expect(cmd[2]).toContain(`--append-system-prompt ${SP_Q}`);
    expect(cmd[2]).toContain('echo "hello" | grep $VAR && rm -rf /');
  });

  test("getCommand handles prompt with newlines", () => {
    const cmd = AgentAdapter.getCommand("line1\nline2");
    expect(cmd[2]).toContain("line1\nline2");
    expect(cmd[2]).toContain(`--append-system-prompt ${SP_Q}`);
  });

  // ── getCommandWithOptions ──

  test("getCommandWithOptions without agentFlags behaves like getCommand", () => {
    const cmd = AgentAdapter.getCommandWithOptions!("hello", {});
    expect(cmd).toEqual([
      "bash",
      "-c",
      `pi --no-session --append-system-prompt ${SP_Q} -p 'hello'`,
    ]);
  });

  test("getCommandWithOptions with agentFlags prepends flags before -p", () => {
    const cmd = AgentAdapter.getCommandWithOptions!("hello", {
      agentFlags: "--model anthropic/claude-sonnet-4 --thinking",
    });
    expect(cmd).toEqual([
      "bash",
      "-c",
      `pi --no-session --append-system-prompt ${SP_Q} --model anthropic/claude-sonnet-4 --thinking -p 'hello'`,
    ]);
  });

  test("getCommandWithOptions with agentFlags and complex prompt", () => {
    const cmd = AgentAdapter.getCommandWithOptions!("it's a 'quoted' test", {
      agentFlags: "--model openai/gpt-4o",
    });
    expect(cmd[2]).toBe(
      `pi --no-session --append-system-prompt ${SP_Q} --model openai/gpt-4o -p 'it'\\''s a '\\''quoted'\\'' test'`
    );
  });

  test("getCommandWithOptions ignores filePath (agent always uses -p)", () => {
    const cmd = AgentAdapter.getCommandWithOptions!("hello", {
      filePath: "/sandbox/prompt.txt",
    });
    // filePath is ignored — agent always inlines prompt via -p
    expect(cmd).toEqual([
      "bash",
      "-c",
      `pi --no-session --append-system-prompt ${SP_Q} -p 'hello'`,
    ]);
  });

  test("getCommandWithOptions with empty agentFlags", () => {
    const cmd = AgentAdapter.getCommandWithOptions!("hello", {
      agentFlags: "",
    });
    // Empty string should not add extra spaces
    expect(cmd).toEqual([
      "bash",
      "-c",
      `pi --no-session --append-system-prompt ${SP_Q} -p 'hello'`,
    ]);
  });
});
