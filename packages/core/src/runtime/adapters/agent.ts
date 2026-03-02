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
 * Agent runtime adapter.
 *
 * Uses the `pi` CLI (`@mariozechner/pi-coding-agent`) to run an AI coding agent
 * inside the container. The `code` field is treated as the prompt text.
 *
 * Always runs in non-interactive mode (`--no-session -p <prompt>`).
 * Extra flags (e.g. `--model`, `--thinking`) are passed via `agentFlags`.
 */
export const AgentAdapter: RuntimeAdapter = {
  name: "agent",
  image: "isol8:agent",

  getCommand(code: string): string[] {
    return ["bash", "-c", `pi --no-session -p ${shellQuote(code)}`];
  },

  getCommandWithOptions(code: string, options: RuntimeCommandOptions): string[] {
    const flags = options.agentFlags ? `${options.agentFlags} ` : "";
    return ["bash", "-c", `pi --no-session ${flags}-p ${shellQuote(code)}`];
  },

  getFileExtension(): string {
    // Agent prompts are plain text; .txt avoids collisions with other runtimes.
    return ".txt";
  },
};
