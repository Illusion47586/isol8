#!/usr/bin/env bash
# Fetch GitHub issue details and comments
# Usage: ./fetch_issue.sh <issue_url>

set -e

if [ $# -lt 1 ]; then
    echo "Usage: $0 <issue_url>"
    echo "Example: $0 https://github.com/owner/repo/issues/123"
    exit 1
fi

ISSUE_URL="$1"

# Extract owner/repo and issue number
OWNER_REPO=$(echo "$ISSUE_URL" | sed -E 's|https://github.com/([^/]+/[^/]+)/issues/.*|\1|')
ISSUE_NUMBER=$(echo "$ISSUE_URL" | sed -E 's|.*/issues/([0-9]+).*|\1|')

echo "========================================"
echo "Fetching Issue #$ISSUE_NUMBER from $OWNER_REPO"
echo "========================================"
echo ""

# Check if gh is authenticated
if ! gh auth status &>/dev/null; then
    echo "Error: gh CLI is not authenticated. Run 'gh auth login' first."
    exit 1
fi

# Create output directory
OUTPUT_DIR=".issue-data"
mkdir -p "$OUTPUT_DIR"

# Fetch issue details as JSON
echo "📋 Fetching issue details..."
gh issue view "$ISSUE_NUMBER" --repo "$OWNER_REPO" \
    --json number,title,body,state,labels,author,createdAt,updatedAt,closed,closedAt,assignees,milestone > "$OUTPUT_DIR/issue_$ISSUE_NUMBER.json"

echo "✓ Issue details saved to $OUTPUT_DIR/issue_$ISSUE_NUMBER.json"

# Fetch all comments
echo ""
echo "💬 Fetching comments..."
gh issue view "$ISSUE_NUMBER" --repo "$OWNER_REPO" --comments > "$OUTPUT_DIR/issue_${ISSUE_NUMBER}_comments.txt"

echo "✓ Comments saved to $OUTPUT_DIR/issue_${ISSUE_NUMBER}_comments.txt"

# Display summary
echo ""
echo "========================================"
echo "Issue Summary"
echo "========================================"

# Parse and display key info
cat "$OUTPUT_DIR/issue_$ISSUE_NUMBER.json" | jq -r '
    "Title: " + .title,
    "State: " + .state,
    "Author: " + .author.login,
    "Created: " + .createdAt,
    "Updated: " + .updatedAt,
    "Labels: " + (.labels | map(.name) | join(", ")),
    "",
    "Body:",
    .body
'

echo ""
echo "========================================"
echo "Comments:"
echo "========================================"
cat "$OUTPUT_DIR/issue_${ISSUE_NUMBER}_comments.txt"

echo ""
echo "========================================"
echo "✓ All data saved to $OUTPUT_DIR/"
echo "========================================"
