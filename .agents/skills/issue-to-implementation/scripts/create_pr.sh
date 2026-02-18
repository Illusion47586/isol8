#!/usr/bin/env bash
# Create a pull request from current branch using the PR template
# Usage: ./create_pr.sh <issue_number> <type> [labels]

set -e

if [ $# -lt 2 ]; then
    echo "Usage: $0 <issue_number> <type> [labels]"
    echo ""
    echo "Arguments:"
    echo "  issue_number: The GitHub issue number"
    echo "  type:         Type of change (fix/feat/docs/refactor/test)"
    echo "  labels:       Comma-separated list of labels (optional)"
    echo ""
    echo "Examples:"
    echo "  $0 123 fix"
    echo "  $0 456 feat bug,cli"
    echo "  $0 789 docs documentation"
    exit 1
fi

ISSUE_NUMBER="$1"
TYPE="$2"
LABELS="${3:-}"

# Get current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)

# Get the first commit message for PR title
COMMIT_MSG=$(git log --oneline --reverse | head -1 | cut -d' ' -f2-)

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

echo "Creating PR for issue #$ISSUE_NUMBER"
echo "Branch: $BRANCH"
echo "Repo: $OWNER_REPO"
echo ""

# Check if PR template exists
PR_TEMPLATE=".github/pull_request_template.md"
if [ ! -f "$PR_TEMPLATE" ]; then
    echo "Warning: PR template not found at $PR_TEMPLATE"
    echo "Creating PR without template..."
    
    if [ -n "$LABELS" ]; then
        gh pr create \
            --repo "$OWNER_REPO" \
            --title "$TYPE: $COMMIT_MSG" \
            --body "Fixes #$ISSUE_NUMBER" \
            --label "$LABELS"
    else
        gh pr create \
            --repo "$OWNER_REPO" \
            --title "$TYPE: $COMMIT_MSG" \
            --body "Fixes #$ISSUE_NUMBER"
    fi
else
    # Create PR with template
    TEMP_FILE=$(mktemp)
    
    # Read template and fill in issue number
    cat "$PR_TEMPLATE" | sed "s/Fixes # (issue)/Fixes #$ISSUE_NUMBER/" > "$TEMP_FILE"
    
    # Add implementation notes section
    echo "" >> "$TEMP_FILE"
    echo "## Implementation Notes" >> "$TEMP_FILE"
    echo "" >> "$TEMP_FILE"
    echo "<!-- Add any technical details, decisions made, or context that would help reviewers -->" >> "$TEMP_FILE"
    echo "" >> "$TEMP_FILE"
    
    echo "PR description prepared. Opening editor..."
    
    if [ -n "$LABELS" ]; then
        gh pr create \
            --repo "$OWNER_REPO" \
            --title "$TYPE: $COMMIT_MSG" \
            --body-file "$TEMP_FILE" \
            --label "$LABELS"
    else
        gh pr create \
            --repo "$OWNER_REPO" \
            --title "$TYPE: $COMMIT_MSG" \
            --body-file "$TEMP_FILE"
    fi
    
    rm "$TEMP_FILE"
fi

echo ""
echo "✓ Pull request created successfully!"
