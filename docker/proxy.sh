#!/bin/bash
# isol8 proxy launcher — parses env vars and starts the proxy listener.
#
# Env vars:
#   ISOL8_WHITELIST  - JSON array of regex strings (allow these)
#   ISOL8_BLACKLIST  - JSON array of regex strings (block these)
#   ISOL8_PROXY_PORT - Port to listen on (default: 8118)
#
# This script:
#   1. Parses ISOL8_WHITELIST/BLACKLIST JSON arrays into grep-compatible pattern files
#   2. Starts nc -lk -e /usr/local/bin/proxy-handler.sh on the specified port
#
# The pattern files are stored in /tmp/isol8-proxy/ and exported as env vars
# so the handler (forked by nc -e) can access them via inherited environment.

PORT="${ISOL8_PROXY_PORT:-8118}"
PROXY_DIR="/tmp/isol8-proxy"
mkdir -p "$PROXY_DIR"

# Create security events log file
touch "$PROXY_DIR/security-events.jsonl"

WL_FILE="$PROXY_DIR/whitelist"
BL_FILE="$PROXY_DIR/blacklist"

# Parse JSON array of regex strings into a file with one ERE pattern per line.
# Input: JSON like '["^example\\.com$","^api\\."]'
# Output: file with one grep -E compatible pattern per line
parse_patterns() {
  local json="$1" outfile="$2"
  : > "$outfile"
  if [ -z "$json" ] || [ "$json" = "[]" ]; then
    return
  fi
  # Strip brackets, split on ","  → one quoted pattern per line
  # Then strip quotes and unescape doubled backslashes from JSON encoding
  echo "$json" \
    | sed 's/^\[//; s/\]$//' \
    | sed 's/","/"\n"/g' \
    | sed 's/^"//; s/"$//' \
    | sed 's/\\\\/\\/g' \
    > "$outfile"
}

parse_patterns "${ISOL8_WHITELIST:-}" "$WL_FILE"
parse_patterns "${ISOL8_BLACKLIST:-}" "$BL_FILE"

# Export paths so the handler (forked by nc -e) can find them
export ISOL8_WHITELIST_FILE="$WL_FILE"
export ISOL8_BLACKLIST_FILE="$BL_FILE"

echo "isol8 proxy listening on 127.0.0.1:${PORT}"

# Start listening — nc -lk provides a persistent server that forks
# a handler for each connection with stdin/stdout wired to the socket
exec nc -lk -s 127.0.0.1 -p "$PORT" -e /usr/local/bin/proxy-handler.sh
