/**
 * @module git
 *
 * Git operations support for isol8 execution environment.
 * Provides URL validation, security controls, and command generation
 * for Git clone, commit, push, pull, and checkout operations.
 */

import type {
  GitCheckoutOptions,
  GitCloneOptions,
  GitCommitOptions,
  GitOperations,
  GitPullOptions,
  GitPushOptions,
  GitSecurityConfig,
} from "./types";

// Default allowed Git hosts (trusted public Git providers)
const DEFAULT_ALLOWED_HOSTS = [
  "github.com",
  "gitlab.com",
  "bitbucket.org",
  "codeberg.org",
  "gitea.com",
  "dev.azure.com",
];

// Default blocked patterns for SSRF prevention (private IPs, internal ranges)
const DEFAULT_BLOCKED_PATTERNS = [
  // Private IPv4 ranges
  "^https?://(127\\.|10\\.|172\\.(1[6-9]|2[0-9]|3[0-1])\\.|192\\.168\\.)",
  // Localhost variations
  "^https?://localhost",
  "^https?://\\[::1\\]",
  "^https?://\\[0:0:0:0:0:0:0:1\\]",
  // File protocol
  "^file://",
  // SSH with internal hosts
  "^(ssh://)?(git@)?(127\\.|10\\.|172\\.(1[6-9]|2[0-9]|3[0-1])\\.|192\\.168\\.|localhost)",
];

/**
 * Validates and parses a Git URL.
 * Supports HTTPS and SSH formats.
 *
 * @param url - The Git repository URL
 * @returns Parsed URL components or null if invalid
 */
export function parseGitUrl(url: string): { protocol: string; host: string; path: string } | null {
  try {
    // Handle SSH format: git@github.com:user/repo.git
    if (url.startsWith("git@")) {
      const match = url.match(/^git@([^:]+):(.+)$/);
      if (match) {
        return {
          protocol: "ssh",
          host: match[1]!,
          path: match[2]!,
        };
      }
      return null;
    }

    // Handle SSH protocol: ssh://git@github.com/user/repo.git
    if (url.startsWith("ssh://")) {
      const sshUrl = new URL(url);
      return {
        protocol: "ssh",
        host: sshUrl.hostname,
        path: sshUrl.pathname.slice(1), // Remove leading slash
      };
    }

    // Standard URL parsing for HTTP/HTTPS
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }

    return {
      protocol: parsed.protocol.replace(":", ""),
      host: parsed.hostname,
      path: parsed.pathname.slice(1), // Remove leading slash
    };
  } catch {
    return null;
  }
}

/**
 * Checks if a URL is blocked based on security configuration.
 *
 * @param url - The Git repository URL
 * @param config - Security configuration
 * @returns Object with allowed status and reason if blocked
 */
export function checkUrlSecurity(
  url: string,
  config: GitSecurityConfig = {}
): { allowed: boolean; reason?: string } {
  const parsed = parseGitUrl(url);
  if (!parsed) {
    return { allowed: false, reason: "Invalid Git URL format" };
  }

  // Check for private IPs if not explicitly allowed
  if (!config.allowPrivateIPs) {
    const isPrivateIp = isPrivateOrInternalIP(parsed.host);
    if (isPrivateIp) {
      return {
        allowed: false,
        reason: "Private/internal IP addresses are not allowed (SSRF protection)",
      };
    }
  }

  // Check blocked patterns first (blacklist takes precedence)
  // If allowPrivateIPs is true, we still check custom blocked patterns but skip default ones
  const blockedPatterns = config.allowPrivateIPs
    ? [...(config.blockedPatterns ?? [])]
    : [...DEFAULT_BLOCKED_PATTERNS, ...(config.blockedPatterns ?? [])];

  for (const pattern of blockedPatterns) {
    const regex = new RegExp(pattern, "i");
    if (regex.test(url)) {
      return { allowed: false, reason: `URL matches blocked pattern: ${pattern}` };
    }
  }

  // Check allowed hosts if whitelist is specified
  if (config.allowedHosts && config.allowedHosts.length > 0) {
    const isAllowed = config.allowedHosts.some(
      (host) => parsed.host === host || parsed.host.endsWith(`.${host}`)
    );
    if (!isAllowed) {
      return {
        allowed: false,
        reason: `Host '${parsed.host}' is not in the allowed hosts list`,
      };
    }
  }

  return { allowed: true };
}

/**
 * Checks if a hostname is a private or internal IP address.
 *
 * @param hostname - The hostname to check
 * @returns True if it's a private/internal IP
 */
function isPrivateOrInternalIP(hostname: string): boolean {
  // Check for localhost
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }

  // Check for IPv4 private ranges
  const ipv4Match = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ipv4Match) {
    const octets = ipv4Match.slice(1, 5).map(Number);
    const a = octets[0]!;
    const b = octets[1]!;
    // 127.x.x.x (loopback)
    if (a === 127) {
      return true;
    }
    // 10.x.x.x (private)
    if (a === 10) {
      return true;
    }
    // 172.16-31.x.x (private)
    if (a === 172 && b >= 16 && b <= 31) {
      return true;
    }
    // 192.168.x.x (private)
    if (a === 192 && b === 168) {
      return true;
    }
  }

  // Check for IPv6 loopback
  if (hostname === "0:0:0:0:0:0:0:1" || hostname === "::1") {
    return true;
  }

  return false;
}

/**
 * Validates all Git operations against security policies.
 *
 * @param git - Git operations configuration
 * @param config - Security configuration
 * @returns Object with valid status and error message if invalid
 */
export function validateGitOperations(
  git: GitOperations,
  config: GitSecurityConfig = {}
): { valid: boolean; error?: string } {
  // Validate clone operation
  if (git.clone) {
    const result = checkUrlSecurity(git.clone.url, config);
    if (!result.allowed) {
      return { valid: false, error: `Git clone blocked: ${result.reason}` };
    }
  }

  // Validate other operations don't need URL checks (they work on local repos)
  // But we should validate paths to prevent directory traversal
  const operations: Array<{ name: string; path?: string }> = [
    { name: "clone", path: git.clone?.path },
    { name: "checkout", path: git.checkout?.repoPath },
    { name: "pull", path: git.pull?.repoPath },
    { name: "commit", path: git.commit?.repoPath },
    { name: "push", path: git.push?.repoPath },
  ];

  for (const op of operations) {
    if (op.path && !isValidPath(op.path)) {
      return {
        valid: false,
        error: `Invalid path in git.${op.name}: '${op.path}' contains unsafe characters or traversal attempts`,
      };
    }
  }

  return { valid: true };
}

/**
 * Validates a path to prevent directory traversal attacks.
 *
 * @param path - The path to validate
 * @returns True if the path is safe
 */
function isValidPath(path: string): boolean {
  // Prevent directory traversal
  if (path.includes("..") || path.includes("~")) {
    return false;
  }
  // Must be relative and not start with /
  if (path.startsWith("/")) {
    return false;
  }
  // Only allow alphanumeric, dash, underscore, dot, and forward slash
  if (!/^[a-zA-Z0-9._/-]+$/.test(path)) {
    return false;
  }
  return true;
}

/**
 * Generates git commands for pre-execution operations (clone, checkout, pull).
 *
 * @param git - Git operations configuration
 * @returns Array of shell commands to execute
 */
export function generatePreExecutionCommands(git: GitOperations): string[] {
  const commands: string[] = [];

  // Check if there are any pre-execution operations
  const hasOperations = git.clone || git.checkout || git.pull;
  if (!hasOperations) {
    return commands;
  }

  // Set up Git configuration for the sandbox user
  commands.push('export HOME="/sandbox"');
  commands.push("git config --global --add safe.directory /sandbox/* 2>/dev/null || true");

  // Clone operation
  if (git.clone) {
    const cloneCmd = buildCloneCommand(git.clone);
    commands.push(cloneCmd);

    // Checkout branch after clone if specified
    if (git.clone.branch && git.clone.path) {
      const repoPath = `/sandbox/${git.clone.path}`;
      commands.push(`cd "${repoPath}" && git checkout "${git.clone.branch}"`);
    }
  }

  // Checkout operation
  if (git.checkout) {
    const checkoutCmd = buildCheckoutCommand(git.checkout);
    commands.push(checkoutCmd);
  }

  // Pull operation
  if (git.pull) {
    const pullCmd = buildPullCommand(git.pull);
    commands.push(pullCmd);
  }

  return commands;
}

/**
 * Generates git commands for post-execution operations (commit, push).
 *
 * @param git - Git operations configuration
 * @returns Array of shell commands to execute
 */
export function generatePostExecutionCommands(git: GitOperations): string[] {
  const commands: string[] = [];

  // Commit operation
  if (git.commit) {
    const commitCmd = buildCommitCommand(git.commit);
    commands.push(commitCmd);
  }

  // Push operation
  if (git.push) {
    const pushCmd = buildPushCommand(git.push);
    commands.push(pushCmd);
  }

  return commands;
}

/**
 * Builds the git clone command.
 */
function buildCloneCommand(opts: GitCloneOptions): string {
  const args: string[] = ["git", "clone"];

  if (opts.depth) {
    args.push("--depth", String(opts.depth));
  }

  if (opts.recursive) {
    args.push("--recursive");
  }

  // Quote the URL to handle special characters
  args.push(`"${opts.url}"`);

  if (opts.path) {
    args.push(`"${opts.path}"`);
  }

  // Change to the target directory and set up safe directory
  const targetPath = opts.path || ".";
  return `cd /sandbox && ${args.join(" ")} && git config --global --add safe.directory "/sandbox/${targetPath}" 2>/dev/null || true`;
}

/**
 * Builds the git checkout command.
 */
function buildCheckoutCommand(opts: GitCheckoutOptions): string {
  const repoPath = opts.repoPath || ".";
  const args: string[] = ["git", "checkout"];

  if (opts.createBranch) {
    args.push("-b");
  }

  args.push(`"${opts.target}"`);

  return `cd "/sandbox/${repoPath}" && ${args.join(" ")}`;
}

/**
 * Builds the git pull command.
 */
function buildPullCommand(opts: GitPullOptions): string {
  const repoPath = opts.repoPath || ".";
  const args: string[] = ["git", "pull"];

  if (opts.remote) {
    args.push(`"${opts.remote}"`);
  }

  if (opts.branch) {
    args.push(`"${opts.branch}"`);
  }

  if (opts.rebase) {
    args.push("--rebase");
  }

  return `cd "/sandbox/${repoPath}" && ${args.join(" ")}`;
}

/**
 * Builds the git commit command.
 */
function buildCommitCommand(opts: GitCommitOptions): string {
  const repoPath = opts.repoPath || ".";
  const commands: string[] = [];

  // Navigate to repo
  commands.push(`cd "/sandbox/${repoPath}"`);

  // Configure author if provided
  if (opts.authorName) {
    commands.push(`git config user.name "${opts.authorName}"`);
  }
  if (opts.authorEmail) {
    commands.push(`git config user.email "${opts.authorEmail}"`);
  }

  // Stage files
  if (opts.all) {
    commands.push("git add -A");
  } else if (opts.files && opts.files.length > 0) {
    for (const file of opts.files) {
      commands.push(`git add "${file}"`);
    }
  }

  // Commit with message
  commands.push(`git commit -m "${opts.message}"`);

  return commands.join(" && ");
}

/**
 * Builds the git push command.
 */
function buildPushCommand(opts: GitPushOptions): string {
  const repoPath = opts.repoPath || ".";
  const args: string[] = ["git", "push"];

  if (opts.force) {
    args.push("--force");
  }

  if (opts.setUpstream) {
    args.push("-u");
  }

  args.push(`"${opts.remote || "origin"}"`);
  args.push(`"${opts.branch}"`);

  return `cd "/sandbox/${repoPath}" && ${args.join(" ")}`;
}

/**
 * Extracts credential environment variable names from Git operations config.
 *
 * @param config - Security configuration
 * @returns Array of environment variable names to mask
 */
export function getCredentialEnvVars(config: GitSecurityConfig = {}): string[] {
  return (
    config.credentialEnvVars || ["GIT_TOKEN", "GITHUB_TOKEN", "GITLAB_TOKEN", "BITBUCKET_TOKEN"]
  );
}

/**
 * Default Git security configuration.
 */
export function getDefaultGitSecurityConfig(): GitSecurityConfig {
  return {
    allowedHosts: DEFAULT_ALLOWED_HOSTS,
    blockedPatterns: [],
    allowPrivateIPs: false,
    credentialEnvVars: ["GIT_TOKEN", "GITHUB_TOKEN", "GITLAB_TOKEN", "BITBUCKET_TOKEN"],
  };
}
