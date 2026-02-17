#!/bin/bash
# isol8 proxy handler — handles a single proxied connection.
#
# Invoked by: nc -lk -e proxy-handler.sh
# stdin/stdout are wired to the client socket by nc.
#
# Env vars (inherited from proxy.sh launcher):
#   ISOL8_WHITELIST_FILE - Path to file with whitelist regex patterns
#   ISOL8_BLACKLIST_FILE - Path to file with blacklist regex patterns
#
# Supports:
#   - HTTPS CONNECT tunneling (bidirectional relay via exec nc)
#   - HTTP forwarding (GET/POST/etc via bash /dev/tcp)

WL="${ISOL8_WHITELIST_FILE:-}"
BL="${ISOL8_BLACKLIST_FILE:-}"

is_allowed() {
  local host="$1"

  # Check blacklist first
  if [ -n "$BL" ] && [ -s "$BL" ]; then
    if echo "$host" | grep -qEf "$BL" 2>/dev/null; then
      return 1
    fi
  fi

  # If whitelist is empty or missing, allow all
  if [ -z "$WL" ] || [ ! -s "$WL" ]; then
    return 0
  fi

  # Must match at least one whitelist pattern
  if echo "$host" | grep -qEf "$WL" 2>/dev/null; then
    return 0
  fi

  return 1
}

# Read the request line
# e.g. "CONNECT host:443 HTTP/1.1" or "GET http://host/path HTTP/1.1"
read -r request_line || exit 0
request_line="${request_line%%$'\r'}"

method="${request_line%% *}"
rest="${request_line#* }"
target="${rest%% *}"

# Read and store all headers until blank line
headers=""
content_length=0
while IFS= read -r hline; do
  hline="${hline%%$'\r'}"
  [ -z "$hline" ] && break
  headers="${headers}${hline}"$'\n'
  # Extract Content-Length
  case "$hline" in
    [Cc]ontent-[Ll]ength:*)
      content_length="${hline#*: }"
      content_length="${content_length// /}"
      ;;
  esac
done

# ── CONNECT (HTTPS tunneling) ──────────────────────────────────────────
if [ "$method" = "CONNECT" ]; then
  host="${target%%:*}"
  port="${target##*:}"
  [ "$port" = "$host" ] && port=443

  if ! is_allowed "$host"; then
    msg="isol8: CONNECT to ${host} blocked by network filter"
    # Log security event
    if [ -d "/tmp/isol8-proxy" ]; then
      printf '{"type":"network_blocked","timestamp":"%s","details":{"method":"CONNECT","host":"%s","reason":"filter_mismatch"}}\n' "$(date -Iseconds)" "$host" >> /tmp/isol8-proxy/security-events.jsonl
    fi
    printf "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: %d\r\n\r\n%s" \
      "${#msg}" "$msg"
    exit 0
  fi

  # Send 200 then replace this process with nc for bidirectional relay.
  # nc inherits the client socket on stdin/stdout from the nc -lk -e parent.
  printf "HTTP/1.1 200 Connection Established\r\n\r\n"
  exec nc "$host" "$port"
fi

# ── HTTP forwarding ────────────────────────────────────────────────────
# Proxy HTTP requests use absolute URLs: GET http://host:port/path HTTP/1.1
url_rest="${target#*://}"
hostport="${url_rest%%/*}"
path="/${url_rest#*/}"
# Handle URLs with no path component
[ "$path" = "/${url_rest}" ] && path="/"

host="${hostport%%:*}"
port="${hostport##*:}"
[ "$port" = "$host" ] && port=80

if ! is_allowed "$host"; then
  msg="isol8: request to ${host} blocked by network filter"
  # Log security event
  if [ -d "/tmp/isol8-proxy" ]; then
    printf '{"type":"network_blocked","timestamp":"%s","details":{"method":"%s","host":"%s","reason":"filter_mismatch"}}\n' "$(date -Iseconds)" "$method" "$host" >> /tmp/isol8-proxy/security-events.jsonl
  fi
  printf "HTTP/1.1 403 Forbidden\r\nContent-Type: text/plain\r\nContent-Length: %d\r\n\r\n%s" \
    "${#msg}" "$msg"
  exit 0
fi

# Open TCP connection via bash /dev/tcp
if ! exec 3<>/dev/tcp/"$host"/"$port" 2>/dev/null; then
  msg="isol8: proxy error: connection to ${host}:${port} failed"
  printf "HTTP/1.1 502 Bad Gateway\r\nContent-Type: text/plain\r\nContent-Length: %d\r\n\r\n%s" \
    "${#msg}" "$msg"
  exit 0
fi

# Send request line with relative path (not absolute URL)
printf "%s %s HTTP/1.1\r\n" "$method" "$path" >&3

# Forward headers, skipping Proxy-* headers
while IFS= read -r h; do
  [ -z "$h" ] && continue
  case "$h" in
    Proxy-*|proxy-*) continue ;;
  esac
  printf "%s\r\n" "$h" >&3
done <<< "$headers"
printf "\r\n" >&3

# Forward request body if present
if [ "$content_length" -gt 0 ] 2>/dev/null; then
  head -c "$content_length" >&3
fi

# Relay response back to client
cat <&3

exec 3>&-
exit 0
