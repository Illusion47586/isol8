#!/usr/bin/env bash
# Validate a bug by attempting to reproduce it
# Usage: ./validate_bug.sh <issue_number>

set -e

if [ $# -lt 1 ]; then
    echo "Usage: $0 <issue_number>"
    echo "Example: $0 123"
    exit 1
fi

ISSUE_NUMBER="$1"

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

echo "========================================"
echo "Validating Bug for Issue #$ISSUE_NUMBER"
echo "========================================"
echo ""

# Fetch issue details
ISSUE_DATA=$(gh issue view "$ISSUE_NUMBER" --repo "$OWNER_REPO" --json title,body,labels)

echo "Issue: $(echo "$ISSUE_DATA" | jq -r '.title')"
echo "Labels: $(echo "$ISSUE_DATA" | jq -r '.labels | map(.name) | join(", ")')"
echo ""

# Check if it's actually a bug
if ! echo "$ISSUE_DATA" | jq -r '.labels | map(.name) | join(" ")' | grep -qi "bug"; then
    echo "⚠️  Warning: Issue does not have 'bug' label"
    echo "This may not be a bug fix. Continuing anyway..."
    echo ""
fi

# Extract reproduction steps from issue body
BODY=$(echo "$ISSUE_DATA" | jq -r '.body')

echo "========================================"
echo "Looking for Reproduction Steps..."
echo "========================================"
echo ""

# Try to find reproduction steps in the body
if echo "$BODY" | grep -qi "reproduce\|steps\|example"; then
    echo "Found potential reproduction info:"
    echo "$BODY" | grep -iA 10 "reproduce\|steps\|example" || true
else
    echo "No explicit reproduction steps found in issue."
    echo "You may need to analyze the issue description to understand the bug."
fi

echo ""
echo "========================================"
echo "Bug Validation Checklist"
echo "========================================"
echo ""
echo "To validate this bug, you should:"
echo ""
echo "1. [ ] Read the issue description carefully"
echo "2. [ ] Identify the expected vs actual behavior"
echo "3. [ ] Attempt to reproduce the bug locally"
echo "4. [ ] Document reproduction steps"
echo "5. [ ] Confirm the bug exists in current codebase"
echo "6. [ ] After fix, verify the bug is resolved"
echo ""
echo "========================================"
