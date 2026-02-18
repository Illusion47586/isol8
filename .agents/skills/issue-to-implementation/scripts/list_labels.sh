#!/usr/bin/env bash
# List available labels in the repository
# Usage: ./list_labels.sh [filter]

set -e

# Extract repo from remote
REPO_URL=$(git remote get-url origin)
if [[ "$REPO_URL" == git@github.com:* ]]; then
    OWNER_REPO=$(echo "$REPO_URL" | sed 's|git@github.com:\([^/]*/[^/]*\)\.git|\1|' | sed 's|git@github.com:\([^/]*/[^/]*\)|\1|')
elif [[ "$REPO_URL" == https://github.com/* ]]; then
    OWNER_REPO=$(echo "$REPO_URL" | sed 's|https://github.com/\([^/]*/[^/]*\)\.git|\1|' | sed 's|https://github.com/\([^/]*/[^/]*\)|\1|')
else
    echo "Error: Could not parse remote URL: $REPO_URL"
    exit 1
fi

FILTER="${1:-}"

echo "Available labels in $OWNER_REPO:"
echo "========================================"

if [ -n "$FILTER" ]; then
    gh label list --repo "$OWNER_REPO" --limit 100 | grep -i "$FILTER"
else
    gh label list --repo "$OWNER_REPO" --limit 100
fi
