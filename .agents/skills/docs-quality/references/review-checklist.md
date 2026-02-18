# Docs Review Checklist

## Editorial quality

- [ ] Title is specific, not vague.
- [ ] Description states scope and user outcome.
- [ ] Page has one dominant archetype.

## Technical completeness

- [ ] All relevant options/parameters are covered.
- [ ] Defaults and constraints are documented.
- [ ] Examples reflect real usage.
- [ ] Snippets with meaningful observable outcomes include expected output/behavior.
- [ ] Claims are verified against `src/`, `src/types.ts`, and `schema/isol8.config.schema.json`.

## UX/readability

- [ ] Sections are scannable.
- [ ] Callouts use the correct type (`Warning`/`Info`/`Tip`/`Note`/`Check`) for the message intent.
- [ ] Callouts are concise and not overused.
- [ ] Diagrams are readable and titled.

## Structure/linking

- [ ] Cross-links to related pages exist.
- [ ] New pages are added to `docs/docs.json`.
- [ ] No orphan pages.
- [ ] Page ends with relevant FAQ/troubleshooting guidance (or explicit links to those pages).

## Validation

- [ ] No parser-sensitive table patterns (`|` in inline code cells without escaping/alternative format).
- [ ] Internal links are valid root-relative paths.
- [ ] Frontmatter includes at least `title` and `description`.
