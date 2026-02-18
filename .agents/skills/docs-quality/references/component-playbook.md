# Mintlify Component Playbook

Use this quick matrix while authoring.

## Decision matrix

- Need sequential onboarding? Use `<Steps>`.
- Need exhaustive field docs? Use `<ResponseField>` or `<ParamField>`.
- Need side-by-side platform/language variants? Use `<Tabs>` or `<CodeGroup>`.
- Need prominent risk callout? Use `<Warning>`.
- Need non-blocking context? Use `<Note>`/`<Info>`.
- Need navigation to adjacent pages? Use `<CardGroup>`.

## Field-heavy references

Prefer:

```mdx
<ResponseField name="timeoutMs" type="number" default="30000">
  Per-request timeout in milliseconds.
</ResponseField>
```

over large dense tables when behavior notes are non-trivial.

## API pages

Prefer `ParamField` and `ResponseField` for contracts, then add one working `curl` example.

## FAQ pages

Use `AccordionGroup` with one question per accordion; keep answers concise and actionable.

## Troubleshooting pages

Use heading-per-problem with clear symptom/check/fix structure.

## Related pages sections

For end-of-page navigation on major docs pages, use `<CardGroup>` cards with concise “why click this” descriptions. Reserve bullet lists for small inline references.
