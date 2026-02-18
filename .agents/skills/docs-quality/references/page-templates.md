# Page Templates

Use these skeletons as starting points.

## A) Reference page template

```mdx
---
title: "<Page title>"
description: "<What this reference covers and why it matters>."
icon: "<icon>"
---

<Short context paragraph>

## Key options

<ResponseField name="<option>" type="<type>" default="<default>">
  <behavior and constraints>
</ResponseField>

## Examples

```bash
<realistic command>
```

## Related pages

- [<page 1>](/path)
- [<page 2>](/path)
```
```

## B) How-to page template

```mdx
---
title: "How to <task>"
description: "<Outcome>, using <surface/scope>."
icon: "<icon>"
---

<What this accomplishes>

<Steps>
  <Step title="Prepare">
    <pre-req>
  </Step>
  <Step title="Run">
    ```bash
    <command>
    ```
  </Step>
  <Step title="Verify">
    <expected result>
  </Step>
</Steps>

## Troubleshooting

- <common issue> -> <fix>
```
```

## C) Troubleshooting entry template

```mdx
### <Problem title>

**Symptom**

- <what user sees>

**Checks**

```bash
<diagnostic command>
```

**Fix**

```bash
<fix command>
```
```
```
