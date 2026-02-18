#!/usr/bin/env bash
set -euo pipefail

DOCS_DIR="${1:-docs}"

if [[ ! -d "$DOCS_DIR" ]]; then
  echo "docs_qc: directory not found: $DOCS_DIR" >&2
  exit 1
fi

echo "[docs_qc] scanning $DOCS_DIR"

# 1) Missing required frontmatter fields
missing_frontmatter=0
while IFS= read -r f; do
  if ! rg -q '^title:' "$f" || ! rg -q '^description:' "$f"; then
    echo "[WARN] missing title/description: $f"
    missing_frontmatter=1
  fi
done < <(find "$DOCS_DIR" -name '*.mdx' -type f)

# 2) Suspicious table inline code with raw pipes
rg -n '\| .*`[^`]*<[^`]*\|[^`]*>[^`]*`' "$DOCS_DIR" || true

# 3) Mermaid block count and untitled-adjacent heuristic
# (simple signal: if two consecutive mermaid blocks appear, ensure an H3 exists before each)
# This is heuristic-only.
for f in $(find "$DOCS_DIR" -name '*.mdx' -type f); do
  if rg -n '```mermaid' "$f" >/dev/null; then
    blocks=$(rg -n '```mermaid' "$f" | wc -l | tr -d ' ')
    if [[ "$blocks" -gt 1 ]]; then
      echo "[INFO] multiple mermaid blocks in: $f (verify headings exist above each block)"
    fi
  fi
done

if [[ "$missing_frontmatter" -eq 1 ]]; then
  echo "[docs_qc] completed with warnings"
  exit 0
fi

echo "[docs_qc] done"
