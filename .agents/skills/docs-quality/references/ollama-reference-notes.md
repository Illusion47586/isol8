# Ollama Reference Notes (Applied Patterns)

These notes capture practical patterns from Ollama docs that are worth reusing.

Reviewed sources:

- `docs/docs.json`
- `docs/index.mdx`
- `docs/quickstart.mdx`
- `docs/cli.mdx`
- `docs/faq.mdx`
- `docs/troubleshooting.mdx`
- `docs/gpu.mdx`
- `docs/api/introduction.mdx`
- `docs/api/streaming.mdx`
- `docs/api/errors.mdx`

## 1) Information architecture patterns

### Strong pattern

- Clear tab separation between product docs and API reference.
- Groups are task-oriented (`Get started`, `Capabilities`, `Integrations`, `More information`).
- API reference has concept pages (`introduction`, `authentication`, `streaming`, `errors`) before endpoint detail.

### How to apply in isol8 docs

- Keep conceptual API pages separate from endpoint pages.
- Ensure each major section has a narrative path, not only flat references.

## 2) Landing page pattern

### Strong pattern

`index.mdx` uses card-based directional navigation:

- Quickstart
- Download
- API reference
- Libraries/community links

### How to apply

- Use homepage cards to route users by intent: first run, configuration, API, troubleshooting.
- Keep each card action-oriented.

## 3) Quickstart pattern

### Strong pattern

- Very short setup path to first success.
- Immediate runnable commands.
- Follow-up links to deeper integrations/API.

### How to apply

- Keep quickstart focused on shortest path to working output.
- Move advanced details to linked guides/reference pages.

## 4) Troubleshooting pattern

### Strong pattern

- Organized by operational context (OS/container/GPU/runtime).
- Gives concrete diagnostics (`journalctl`, `docker logs`, env vars).
- Includes escalation path (community/support) and low-level debug knobs.

### How to apply

- Structure by symptom and environment.
- Always include checks and exact commands, not just explanations.

## 5) Hardware/support matrix pattern

### Strong pattern

`gpu.mdx` uses large support tables + override environment variables + fallback guidance.

### How to apply

- Use tables only where comparison density matters.
- Pair every compatibility table with practical override/fallback instructions.

## 6) API concept pages pattern

### Strong pattern

Before endpoint details, Ollama documents:

- Base URL and environment variants
- Streaming transport format and non-streaming alternative
- Error envelope and mid-stream error behavior

### How to apply

- Always document transport and failure semantics explicitly.
- For stream APIs, explain how errors differ after stream start.

## 7) Style pattern observations

### What works

- Direct, task-first headings.
- Minimal fluff.
- Strong command density with realistic snippets.
- Explicit defaults and behavior notes.

### What to preserve

- Keep prose concise but do not omit behavior details.
- Prefer concrete examples over abstract explanations.

## 8) Checklist additions inspired by Ollama

When writing/reviewing a page, ensure:

1. It has one clear user intent and outcome.
2. It includes at least one runnable example.
3. It links to next-step pages.
4. If API-related, it documents transport format and error shape.
5. If environment-specific, it includes OS/container specific commands.
