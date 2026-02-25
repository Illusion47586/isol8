/**
 * @module cli/remote
 *
 * Remote profile management for the isol8 CLI.
 * Stores named connection profiles at `~/.isol8/remotes.json` so users
 * don't have to pass `--host` and `--key` on every invocation.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** A saved remote server connection profile. */
export interface RemoteProfile {
  /** Unique profile name (e.g. "staging", "prod"). */
  name: string;
  /** Base URL of the isol8 server. */
  host: string;
  /** API key for Bearer token authentication. */
  apiKey: string;
  /** Whether this profile is the default for `isol8 run` without `--host`. */
  default?: boolean;
}

/** On-disk structure of `~/.isol8/remotes.json`. */
interface RemotesFile {
  profiles: RemoteProfile[];
}

/** Path to the remotes configuration file. */
function getRemotesPath(): string {
  return join(homedir(), ".isol8", "remotes.json");
}

/** Ensure the `~/.isol8` directory exists. */
function ensureConfigDir(): void {
  const dir = join(homedir(), ".isol8");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

/** Load all saved remote profiles from disk. */
export function loadProfiles(): RemoteProfile[] {
  const path = getRemotesPath();
  if (!existsSync(path)) {
    return [];
  }
  try {
    const raw = readFileSync(path, "utf-8");
    const data = JSON.parse(raw) as RemotesFile;
    return data.profiles ?? [];
  } catch {
    return [];
  }
}

/** Persist profiles to disk. */
function saveProfiles(profiles: RemoteProfile[]): void {
  ensureConfigDir();
  const data: RemotesFile = { profiles };
  writeFileSync(getRemotesPath(), JSON.stringify(data, null, 2), "utf-8");
}

/** Add or update a remote profile. */
export function addProfile(name: string, host: string, apiKey: string): void {
  const profiles = loadProfiles();
  const existing = profiles.findIndex((p) => p.name === name);

  const profile: RemoteProfile = {
    name,
    host: host.replace(/\/$/, ""),
    apiKey,
    default: profiles.length === 0,
  };

  if (existing >= 0) {
    // Preserve existing default status unless this is the only profile
    const existingProfile = profiles[existing];
    if (existingProfile) {
      profile.default = existingProfile.default;
    }
    profiles[existing] = profile;
  } else {
    profiles.push(profile);
  }

  saveProfiles(profiles);
}

/** Remove a remote profile by name. Returns true if found and removed. */
export function removeProfile(name: string): boolean {
  const profiles = loadProfiles();
  const index = profiles.findIndex((p) => p.name === name);
  if (index < 0) {
    return false;
  }

  const removedProfile = profiles[index];
  const wasDefault = removedProfile?.default;
  profiles.splice(index, 1);

  // If we removed the default, promote the first remaining profile
  if (wasDefault && profiles.length > 0) {
    const first = profiles[0];
    if (first) {
      first.default = true;
    }
  }

  saveProfiles(profiles);
  return true;
}

/** Set a profile as the default. Returns true if found. */
export function setDefaultProfile(name: string): boolean {
  const profiles = loadProfiles();
  const target = profiles.find((p) => p.name === name);
  if (!target) {
    return false;
  }

  for (const p of profiles) {
    p.default = p.name === name;
  }

  saveProfiles(profiles);
  return true;
}

/** Get the current default profile, or undefined if none. */
export function getDefaultProfile(): RemoteProfile | undefined {
  const profiles = loadProfiles();
  return profiles.find((p) => p.default);
}

/** Get a specific profile by name. */
export function getProfile(name: string): RemoteProfile | undefined {
  const profiles = loadProfiles();
  return profiles.find((p) => p.name === name);
}
