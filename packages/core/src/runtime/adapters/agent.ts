/**
 * @module runtime/adapters/agent
 *
 * Runtime adapter for the AI coding agent (pi from @mariozechner/pi-coding-agent).
 * Runs pi in non-interactive print mode inside a sandboxed container with bun + git.
 */

import type { RuntimeAdapter, RuntimeCommandOptions } from "../adapter";

/**
 * Shell-escape a string for safe embedding inside single quotes.
 * Replaces each `'` with `'\''` (end quote, escaped quote, start quote).
 */
function shellQuote(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}

/**
 * Injected into every pi invocation via --append-system-prompt.
 * Keeps the agent aware of sandbox constraints without replacing pi's default prompt.
 */
const SANDBOX_SYSTEM_PROMPT =
  "You are running inside an isol8 sandbox — a Docker container with strict " +
  "resource limits and controlled network access. isol8 exists to execute " +
  "untrusted code safely: outbound network is filtered to a whitelist, the " +
  "filesystem is ephemeral, and some system calls are restricted. Work within " +
  "these constraints: do not assume open internet access, do not rely on " +
  "persistent state across runs, and do not attempt to escape the sandbox.";

/**
 * Agent runtime adapter.
 *
 * Uses the `pi` CLI (`@mariozechner/pi-coding-agent`) to run an AI coding agent
 * inside the container. The `code` field is treated as the prompt text.
 *
 * Always runs in non-interactive mode (`--no-session -p <prompt>`).
 * Extra flags (e.g. `--model`, `--thinking`) are passed via `agentFlags`.
 * A fixed system prompt is appended to every invocation via `--append-system-prompt`.
 */
export const AgentAdapter: RuntimeAdapter = {
  name: "agent",
  image: "isol8:agent",

  getCommand(code: string): string[] {
    return [
      "bash",
      "-c",
      `pi --no-session --append-system-prompt ${shellQuote(SANDBOX_SYSTEM_PROMPT)} -p ${shellQuote(code)}`,
    ];
  },

  getCommandWithOptions(code: string, options: RuntimeCommandOptions): string[] {
    const flags = options.agentFlags ? `${options.agentFlags} ` : "";
    return [
      "bash",
      "-c",
      `pi --no-session --append-system-prompt ${shellQuote(SANDBOX_SYSTEM_PROMPT)} ${flags}-p ${shellQuote(code)}`,
    ];
  },

  getFileExtension(): string {
    // Agent prompts are plain text; .txt avoids collisions with other runtimes.
    return ".txt";
  },
};
