import { describe, expect, test } from "bun:test";
import {
  checkUrlSecurity,
  generatePostExecutionCommands,
  generatePreExecutionCommands,
  getCredentialEnvVars,
  getDefaultGitSecurityConfig,
  parseGitUrl,
  validateGitOperations,
} from "../../src/git";
import type { GitOperations } from "../../src/types";

describe("parseGitUrl", () => {
  test("parses HTTPS URL", () => {
    const result = parseGitUrl("https://github.com/user/repo.git");
    expect(result).toEqual({
      protocol: "https",
      host: "github.com",
      path: "user/repo.git",
    });
  });

  test("parses HTTP URL", () => {
    const result = parseGitUrl("http://github.com/user/repo.git");
    expect(result).toEqual({
      protocol: "http",
      host: "github.com",
      path: "user/repo.git",
    });
  });

  test("parses SSH format (git@)", () => {
    const result = parseGitUrl("git@github.com:user/repo.git");
    expect(result).toEqual({
      protocol: "ssh",
      host: "github.com",
      path: "user/repo.git",
    });
  });

  test("parses SSH protocol", () => {
    const result = parseGitUrl("ssh://git@github.com/user/repo.git");
    expect(result).toEqual({
      protocol: "ssh",
      host: "github.com",
      path: "user/repo.git",
    });
  });

  test("returns null for invalid URL", () => {
    expect(parseGitUrl("not-a-valid-url")).toBeNull();
    expect(parseGitUrl("ftp://example.com/repo.git")).toBeNull();
    expect(parseGitUrl("")).toBeNull();
  });
});

describe("checkUrlSecurity", () => {
  test("allows GitHub URLs by default", () => {
    const result = checkUrlSecurity("https://github.com/user/repo.git");
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test("allows GitLab URLs by default", () => {
    const result = checkUrlSecurity("https://gitlab.com/user/repo.git");
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test("allows Bitbucket URLs by default", () => {
    const result = checkUrlSecurity("https://bitbucket.org/user/repo.git");
    expect(result.allowed).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  test("blocks localhost URLs", () => {
    const result = checkUrlSecurity("https://localhost/repo.git");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Private/internal IP addresses");
  });

  test("blocks 127.0.0.1 URLs", () => {
    const result = checkUrlSecurity("https://127.0.0.1/repo.git");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Private/internal IP addresses");
  });

  test("blocks private IP ranges", () => {
    expect(checkUrlSecurity("https://10.0.0.1/repo.git").allowed).toBe(false);
    expect(checkUrlSecurity("https://192.168.1.1/repo.git").allowed).toBe(false);
    expect(checkUrlSecurity("https://172.16.0.1/repo.git").allowed).toBe(false);
  });

  test("blocks URLs not in allowed hosts list", () => {
    const result = checkUrlSecurity("https://example.com/repo.git", {
      allowedHosts: ["github.com"],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not in the allowed hosts list");
  });

  test("allows URLs matching custom allowed hosts", () => {
    const result = checkUrlSecurity("https://internal.company.com/repo.git", {
      allowedHosts: ["internal.company.com"],
    });
    expect(result.allowed).toBe(true);
  });

  test("blocks URLs matching blocked patterns", () => {
    const result = checkUrlSecurity("https://github.com/user/repo.git", {
      blockedPatterns: ["github.com"],
    });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("blocked pattern");
  });

  test("allows private IPs when explicitly configured", () => {
    const result = checkUrlSecurity("https://192.168.1.1/repo.git", {
      allowPrivateIPs: true,
    });
    expect(result.allowed).toBe(true);
  });

  test("returns error for invalid URLs", () => {
    const result = checkUrlSecurity("invalid-url");
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe("Invalid Git URL format");
  });
});

describe("validateGitOperations", () => {
  test("validates successful clone operation", () => {
    const git: GitOperations = {
      clone: { url: "https://github.com/user/repo.git" },
    };
    const result = validateGitOperations(git);
    expect(result.valid).toBe(true);
    expect(result.error).toBeUndefined();
  });

  test("fails validation for blocked URL", () => {
    const git: GitOperations = {
      clone: { url: "https://localhost/repo.git" },
    };
    const result = validateGitOperations(git);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("Git clone blocked");
  });

  test("validates paths without directory traversal", () => {
    const git: GitOperations = {
      clone: { url: "https://github.com/user/repo.git", path: "my-project" },
      commit: { message: "test", repoPath: "my-project" },
    };
    const result = validateGitOperations(git);
    expect(result.valid).toBe(true);
  });

  test("fails validation for paths with directory traversal", () => {
    const git: GitOperations = {
      clone: { url: "https://github.com/user/repo.git", path: "../etc" },
    };
    const result = validateGitOperations(git);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("unsafe characters or traversal");
  });

  test("fails validation for paths starting with /", () => {
    const git: GitOperations = {
      clone: { url: "https://github.com/user/repo.git", path: "/etc/passwd" },
    };
    const result = validateGitOperations(git);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("unsafe characters or traversal");
  });

  test("validates commit without clone", () => {
    const git: GitOperations = {
      commit: { message: "test commit", all: true },
    };
    const result = validateGitOperations(git);
    expect(result.valid).toBe(true);
  });
});

describe("generatePreExecutionCommands", () => {
  test("generates clone command", () => {
    const git: GitOperations = {
      clone: { url: "https://github.com/user/repo.git" },
    };
    const commands = generatePreExecutionCommands(git);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.some((cmd) => cmd.includes("git clone"))).toBe(true);
    expect(commands.some((cmd) => cmd.includes("https://github.com/user/repo.git"))).toBe(true);
  });

  test("generates clone with branch checkout", () => {
    const git: GitOperations = {
      clone: { url: "https://github.com/user/repo.git", path: "repo", branch: "develop" },
    };
    const commands = generatePreExecutionCommands(git);
    expect(commands.some((cmd) => cmd.includes("git clone"))).toBe(true);
    expect(commands.some((cmd) => cmd.includes("git checkout"))).toBe(true);
    expect(commands.some((cmd) => cmd.includes('"develop"'))).toBe(true);
  });

  test("generates clone with depth option", () => {
    const git: GitOperations = {
      clone: { url: "https://github.com/user/repo.git", depth: 1 },
    };
    const commands = generatePreExecutionCommands(git);
    expect(commands.some((cmd) => cmd.includes("--depth 1"))).toBe(true);
  });

  test("generates clone with recursive option", () => {
    const git: GitOperations = {
      clone: { url: "https://github.com/user/repo.git", recursive: true },
    };
    const commands = generatePreExecutionCommands(git);
    expect(commands.some((cmd) => cmd.includes("--recursive"))).toBe(true);
  });

  test("generates checkout command", () => {
    const git: GitOperations = {
      checkout: { target: "feature-branch", repoPath: "my-project" },
    };
    const commands = generatePreExecutionCommands(git);
    expect(commands.some((cmd) => cmd.includes("git checkout"))).toBe(true);
    expect(commands.some((cmd) => cmd.includes('"feature-branch"'))).toBe(true);
  });

  test("generates checkout with new branch creation", () => {
    const git: GitOperations = {
      checkout: { target: "new-feature", createBranch: true, repoPath: "my-project" },
    };
    const commands = generatePreExecutionCommands(git);
    expect(commands.some((cmd) => cmd.includes("git checkout -b"))).toBe(true);
  });

  test("generates pull command", () => {
    const git: GitOperations = {
      pull: { remote: "origin", branch: "main", repoPath: "my-project" },
    };
    const commands = generatePreExecutionCommands(git);
    expect(commands.some((cmd) => cmd.includes("git pull"))).toBe(true);
    expect(commands.some((cmd) => cmd.includes('"origin"'))).toBe(true);
    expect(commands.some((cmd) => cmd.includes('"main"'))).toBe(true);
  });

  test("generates pull with rebase", () => {
    const git: GitOperations = {
      pull: { rebase: true, repoPath: "my-project" },
    };
    const commands = generatePreExecutionCommands(git);
    expect(commands.some((cmd) => cmd.includes("git pull") && cmd.includes("--rebase"))).toBe(true);
  });

  test("generates empty array for no pre-execution operations", () => {
    const git: GitOperations = {
      commit: { message: "test" },
      push: { branch: "main" },
    };
    const commands = generatePreExecutionCommands(git);
    expect(commands.length).toBe(0);
  });

  test("includes git safe directory configuration", () => {
    const git: GitOperations = {
      clone: { url: "https://github.com/user/repo.git" },
    };
    const commands = generatePreExecutionCommands(git);
    expect(
      commands.some((cmd) => cmd.includes("git config") && cmd.includes("safe.directory"))
    ).toBe(true);
  });
});

describe("generatePostExecutionCommands", () => {
  test("generates commit command", () => {
    const git: GitOperations = {
      commit: { message: "feat: add new feature", repoPath: "my-project" },
    };
    const commands = generatePostExecutionCommands(git);
    expect(commands.length).toBeGreaterThan(0);
    expect(commands.some((cmd) => cmd.includes("git commit"))).toBe(true);
    expect(commands.some((cmd) => cmd.includes('"feat: add new feature"'))).toBe(true);
  });

  test("generates commit with author configuration", () => {
    const git: GitOperations = {
      commit: {
        message: "test commit",
        authorName: "AI Agent",
        authorEmail: "agent@example.com",
        repoPath: "my-project",
      },
    };
    const commands = generatePostExecutionCommands(git);
    expect(commands.some((cmd) => cmd.includes('git config user.name "AI Agent"'))).toBe(true);
    expect(commands.some((cmd) => cmd.includes('git config user.email "agent@example.com"'))).toBe(
      true
    );
  });

  test("generates commit with all flag", () => {
    const git: GitOperations = {
      commit: { message: "update", all: true, repoPath: "my-project" },
    };
    const commands = generatePostExecutionCommands(git);
    expect(commands.some((cmd) => cmd.includes("git add -A"))).toBe(true);
  });

  test("generates commit with specific files", () => {
    const git: GitOperations = {
      commit: { message: "update", files: ["src/main.ts", "README.md"], repoPath: "my-project" },
    };
    const commands = generatePostExecutionCommands(git);
    expect(commands.some((cmd) => cmd.includes('git add "src/main.ts"'))).toBe(true);
    expect(commands.some((cmd) => cmd.includes('git add "README.md"'))).toBe(true);
  });

  test("generates push command", () => {
    const git: GitOperations = {
      push: { remote: "origin", branch: "main", repoPath: "my-project" },
    };
    const commands = generatePostExecutionCommands(git);
    expect(commands.some((cmd) => cmd.includes("git push"))).toBe(true);
    expect(commands.some((cmd) => cmd.includes('"origin"'))).toBe(true);
    expect(commands.some((cmd) => cmd.includes('"main"'))).toBe(true);
  });

  test("generates push with force flag", () => {
    const git: GitOperations = {
      push: { branch: "feature", force: true, repoPath: "my-project" },
    };
    const commands = generatePostExecutionCommands(git);
    expect(commands.some((cmd) => cmd.includes("git push") && cmd.includes("--force"))).toBe(true);
  });

  test("generates push with upstream tracking", () => {
    const git: GitOperations = {
      push: { branch: "new-branch", setUpstream: true, repoPath: "my-project" },
    };
    const commands = generatePostExecutionCommands(git);
    expect(commands.some((cmd) => cmd.includes("git push") && cmd.includes("-u"))).toBe(true);
  });

  test("generates empty array for no post-execution operations", () => {
    const git: GitOperations = {
      clone: { url: "https://github.com/user/repo.git" },
      checkout: { target: "main" },
    };
    const commands = generatePostExecutionCommands(git);
    expect(commands.length).toBe(0);
  });

  test("generates both commit and push commands", () => {
    const git: GitOperations = {
      commit: { message: "update", all: true, repoPath: "my-project" },
      push: { branch: "main", repoPath: "my-project" },
    };
    const commands = generatePostExecutionCommands(git);
    expect(commands.some((cmd) => cmd.includes("git commit"))).toBe(true);
    expect(commands.some((cmd) => cmd.includes("git push"))).toBe(true);
    // Commit should come before push
    const commitIndex = commands.findIndex((cmd) => cmd.includes("git commit"));
    const pushIndex = commands.findIndex((cmd) => cmd.includes("git push"));
    expect(commitIndex).toBeLessThan(pushIndex);
  });
});

describe("getCredentialEnvVars", () => {
  test("returns default credential env vars", () => {
    const vars = getCredentialEnvVars();
    expect(vars).toContain("GIT_TOKEN");
    expect(vars).toContain("GITHUB_TOKEN");
    expect(vars).toContain("GITLAB_TOKEN");
    expect(vars).toContain("BITBUCKET_TOKEN");
  });

  test("returns custom credential env vars when configured", () => {
    const vars = getCredentialEnvVars({
      credentialEnvVars: ["CUSTOM_TOKEN", "MY_GIT_KEY"],
    });
    expect(vars).toEqual(["CUSTOM_TOKEN", "MY_GIT_KEY"]);
  });
});

describe("getDefaultGitSecurityConfig", () => {
  test("returns default security configuration", () => {
    const config = getDefaultGitSecurityConfig();
    expect(config.allowedHosts).toContain("github.com");
    expect(config.allowedHosts).toContain("gitlab.com");
    expect(config.allowedHosts).toContain("bitbucket.org");
    expect(config.allowPrivateIPs).toBe(false);
    expect(config.blockedPatterns).toEqual([]);
    expect(config.credentialEnvVars).toBeDefined();
  });
});

describe("Git URL edge cases", () => {
  test("handles URLs with special characters in path", () => {
    const result = parseGitUrl("https://github.com/user/my-repo_name.git");
    expect(result).not.toBeNull();
    expect(result?.path).toBe("user/my-repo_name.git");
  });

  test("handles SSH URLs with port numbers", () => {
    const result = parseGitUrl("ssh://git@github.com:22/user/repo.git");
    expect(result).not.toBeNull();
    expect(result?.host).toBe("github.com");
  });

  test("handles URLs with query parameters", () => {
    const result = parseGitUrl("https://github.com/user/repo.git?ref=main");
    expect(result).not.toBeNull();
    expect(result?.path).toBe("user/repo.git");
  });

  test("handles IPv6 loopback", () => {
    const result = checkUrlSecurity("https://[::1]/repo.git");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("blocked pattern");
  });
});

describe("Git operations complex scenarios", () => {
  test("validates full workflow: clone, commit, push", () => {
    const git: GitOperations = {
      clone: { url: "https://github.com/user/repo.git", path: "project" },
      commit: { message: "feat: initial commit", all: true, repoPath: "project" },
      push: { branch: "main", repoPath: "project" },
    };

    const validation = validateGitOperations(git);
    expect(validation.valid).toBe(true);

    const preCommands = generatePreExecutionCommands(git);
    expect(preCommands.some((cmd) => cmd.includes("git clone"))).toBe(true);

    const postCommands = generatePostExecutionCommands(git);
    expect(postCommands.some((cmd) => cmd.includes("git commit"))).toBe(true);
    expect(postCommands.some((cmd) => cmd.includes("git push"))).toBe(true);
  });

  test("handles SSH URLs in security checks", () => {
    const git: GitOperations = {
      clone: { url: "git@github.com:user/repo.git" },
    };

    const result = validateGitOperations(git);
    expect(result.valid).toBe(true);
  });

  test("blocks SSH URLs to internal hosts", () => {
    const git: GitOperations = {
      clone: { url: "git@192.168.1.1:user/repo.git" },
    };

    const result = validateGitOperations(git);
    expect(result.valid).toBe(false);
    expect(result.error).toContain("blocked");
  });
});
