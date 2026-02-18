# Docs Quality Manual

This manual defines how to write and revamp docs in this repository.

It is based on:

- Structural patterns from Ollama docs (`docs/docs.json`, `quickstart`, `faq`, `troubleshooting`, API split)
- Mintlify best practices
- Lessons from our own docs iteration (title clarity, parser pitfalls, diagram readability, cross-link gaps)

## 0. Research before writing

Treat docs as implementation-backed, not assumption-backed.

Before drafting or revising a page:

- inspect relevant code paths under `/src/`
- review `/src/types.ts` for user-facing request/result/options/config contracts
- review `/schema/isol8.config.schema.json` for configuration key shape, defaults, and allowed values

Use this research to drive complete parameter coverage and avoid stale docs.

## 1. Documentation architecture

Design docs as an intentional system, not isolated pages.

### 1.1 Recommended top-level IA pattern

Use tabs/groups with distinct intent, similar to the strongest parts of Ollama's structure:

- **Get started**: onboarding path, first success
- **Core concepts**: mental models and behavior
- **Reference**: exhaustive flags/options/types
- **Guides**: use-case or workflow-oriented content
- **API reference**: endpoint-by-endpoint contract docs
- **Help**: FAQ + troubleshooting

### 1.2 Page archetypes

Choose one archetype before writing:

- `overview`: explain what/why, link to detailed pages
- `how-to`: accomplish one concrete task
- `reference`: exhaustive options, parameters, defaults
- `guide`: scenario-based multi-step path
- `faq`: short Q/A for recurring confusion
- `troubleshooting`: symptom → diagnosis → fix
- `api`: request/response contract with examples

Do not mix archetypes heavily in one page.

## 2. Titles and descriptions

Titles and descriptions are product UX, not metadata chores.

### 2.1 Title rules

- Prefer clear, human-readable phrasing over clever wording.
- Reflect task/user intent, not internal implementation detail.
- Keep sidebar titles short, page titles specific.

Good:

- `Passing values (CLI, config, API, library)`
- `Execution guide`
- `Troubleshooting`

Weak:

- `Command center`
- `Option atlas`
- `Internals`

### 2.2 Description rules

Descriptions should answer:

- What this page helps you do
- Which scope/surfaces it covers

Formula:

`<Verb> + <object> + <scope/surfaces> + <key outcomes>`

Example:

`Run code with isol8 across CLI, library, and API: request lifecycle, mode behavior, streaming, files, installs, and output handling.`

## 3. Component selection (Mintlify)

Use components to improve comprehension, not decoration.

### 3.1 Default components by need

- `<Steps>`: ordered onboarding/task execution
- `<ResponseField>`: parameter-by-parameter reference docs
- `<ParamField>`: API request/query/path contracts
- `<Accordion>`: FAQ entries and optional detail
- `<Card>` / `<CardGroup>`: navigation to related pages
- `<Tabs>`: parallel options by platform/language
- `<CodeGroup>`: equivalent code samples by ecosystem
- `<Warning>` / `<Note>` / `<Info>`: risk and emphasis

### 3.2 When to avoid components

- Do not use tabs for content that should be read sequentially.
- Do not use accordions for critical steps that users must see.
- Do not over-fragment short pages with too many visual blocks.

### 3.3 Callout rules

Use callouts intentionally; they are semantic emphasis, not decoration.

- `<Warning>`: destructive actions, security/safety risks, or high-likelihood failure modes
- `<Info>`: operational context users should know while deciding
- `<Tip>`: recommended best practices that improve reliability or maintainability
- `<Note>`: important caveats that are non-destructive and non-alarmist
- `<Check>`: explicit success state confirmation

Callout usage constraints:

- Keep callouts short and specific (prefer 1-3 sentences).
- Do not stack multiple callouts back-to-back unless they convey distinct severities.
- If content is core flow, keep it in prose/steps; reserve callouts for exceptions, risks, and high-signal guidance.

## 4. Examples and code snippets

Examples should be realistic and progressive.

### 4.1 Example quality bar

Each example should communicate:

- why this example exists
- minimal required inputs
- expected behavior/output

Add explicit `Expected output` or `Expected behavior` when a snippet has a meaningful observable result. For setup-only snippets, a short prose success condition is sufficient.

When an input and its output are shown together, prefer a single `<CodeGroup>` so both stay visually and contextually linked.

Use realistic values (`api.openai.com`, `session-123`, `timeoutMs: 30000`) not placeholders like `foo` unless teaching syntax.

### 4.2 Example progression

Per page, prefer:

1. quick minimal example
2. practical production-like example
3. edge-case example (if relevant)

### 4.3 CLI/API/library parity

Where a feature exists across surfaces, show at least two surfaces.

For reference-heavy pages, include all surfaces explicitly.

## 5. Tables vs prose vs diagrams

### 5.1 Use tables when

- comparing multiple options/fields with same dimensions
- summarizing defaults and mappings

### 5.2 Use prose when

- explaining behavior, tradeoffs, and mental models
- clarifying lifecycle and precedence

### 5.3 Use Mermaid when

- sequence/flow genuinely helps understanding
- architecture has branching behavior that prose makes ambiguous

Mermaid readability rules:

- Prefer `flowchart TD` for long sequences (vertical)
- Split dense graphs into 2 smaller diagrams if needed
- Add a heading above each diagram
- Keep node labels short and scannable

## 6. FAQ and troubleshooting design

### 6.1 FAQ entries

Each entry should include:

- direct answer in first sentence
- short rationale
- command/config snippet if applicable

### 6.2 Troubleshooting entries

Use fixed pattern:

- **Symptom**
- **Checks**
- **Fix**
- **Related page** (optional)

For substantial guide/reference pages, include page-specific FAQ and troubleshooting at the end (or provide clearly labeled links to dedicated FAQ/troubleshooting pages when duplication would be excessive).

## 7. Cross-linking rules

Every substantial page should link to:

- at least 1 prerequisite page
- at least 1 deeper reference page
- at least 1 troubleshooting/help page when failures are plausible

Avoid isolated pages with no inbound/outbound links.

For substantial “Related pages” sections, prefer a `<CardGroup>` with short descriptive text per link. Use plain bullet links only for very small/inline link lists.

## 8. Parameter-level completeness

For reference pages, list every supported option/field and include:

- type
- default
- where/how to set it
- behavior note or constraint

Use `ResponseField` style similar to `docs/library/overview.mdx` for high-fidelity reference pages.

## 9. Known pitfalls from this repo

### 9.1 Markdown parser issues in tables

Inline code containing `|` inside table cells can break rendering in some MDX pipelines.

Prefer safe placeholder names (`<mode>`, `<size>`) and explain accepted values below table/field.

### 9.2 Diagram readability

Large horizontal diagrams become unreadable in normal viewport.

Prefer vertically oriented or split diagrams with explicit headings.

### 9.3 Ambiguous mode behavior

Always document:

- how to set mode
- how to change mode
- cleanup implications when switching away from persistent

## 10. Definition of done

Before submitting docs updates, verify:

1. title and description are specific and user-facing
2. page follows one dominant archetype
3. major options/fields are covered without gaps
4. examples are realistic and scoped
5. snippets with meaningful outcomes include expected output/behavior
6. diagrams are readable and titled
7. cross-links are present and useful
8. no parser-sensitive table syntax issues
9. navigation (`docs.json`) updated when needed
10. page ends with relevant FAQ/troubleshooting guidance or explicit links
