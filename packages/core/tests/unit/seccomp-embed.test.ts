import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EMBEDDED_DEFAULT_SECCOMP_PROFILE } from "../../src/engine/default-seccomp-profile";

describe("embedded seccomp profile", () => {
  test("matches docker/seccomp-profile.json", () => {
    const profilePath = resolve(import.meta.dir, "../../docker/seccomp-profile.json");
    const fileProfile = JSON.parse(readFileSync(profilePath, "utf-8")) as unknown;
    const embeddedProfile = JSON.parse(EMBEDDED_DEFAULT_SECCOMP_PROFILE) as unknown;

    expect(embeddedProfile).toEqual(fileProfile);
  });
});
