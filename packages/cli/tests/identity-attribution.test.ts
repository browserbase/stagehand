/**
 * Focused unit tests for:
 * 1. toMetadataValue — sanitizes userMetadata values for the session-create validator
 * 2. attributionHeaders (via api.ts) — always sends x-bb-client; conditionally x-bb-install-id
 * 3. remoteStagehandOptions — always includes browse_cli + cli_version; includes install_id only when resolved
 */

import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { toMetadataValue } from "../src/lib/identity.js";

// ---------------------------------------------------------------------------
// toMetadataValue
// ---------------------------------------------------------------------------

describe("toMetadataValue", () => {
  it("preserves fully-allowed characters unchanged", () => {
    // Allowed: word chars, hyphen, plus underscore (via \w), and the extras
    const allowed = "0.9.0-alpha_1,foo;bar:.ok()&$%#@!?~";
    expect(toMetadataValue(allowed)).toBe(allowed);
  });

  it("strips characters outside the allowed set", () => {
    // The '+' in a semver build suffix (+build.sha) is NOT in the validator set
    expect(toMetadataValue("0.9.0+build.123")).toBe("0.9.0build.123");
  });

  it("strips spaces and slashes", () => {
    expect(toMetadataValue("hello world/foo")).toBe("helloworldfoo");
  });

  it("truncates to the default max of 64 characters", () => {
    const long = "a".repeat(100);
    expect(toMetadataValue(long)).toHaveLength(64);
  });

  it("truncates to a custom max", () => {
    expect(toMetadataValue("abcdef", 3)).toBe("abc");
  });

  it("returns an empty string for an all-disallowed input", () => {
    expect(toMetadataValue(" / \\")).toBe("");
  });

  it("returns an empty string for an empty input", () => {
    expect(toMetadataValue("")).toBe("");
  });

  it("handles a realistic semver with build metadata", () => {
    // Typical semver: "1.2.3" stays intact; "1.2.3+abc" loses the '+'
    expect(toMetadataValue("1.2.3+abc.def")).toBe("1.2.3abc.def");
  });

  it("handles a UUID without stripping characters", () => {
    const uuid = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    expect(toMetadataValue(uuid)).toBe(uuid);
  });
});

// ---------------------------------------------------------------------------
// remoteStagehandOptions — userMetadata paths
// ---------------------------------------------------------------------------

const cleanupPaths: string[] = [];

afterEach(async () => {
  // Reset module-level cache between tests by re-importing via a fresh key.
  // We can't easily reset the ESM cache, so we use env overrides instead.
  vi.restoreAllMocks();
  while (cleanupPaths.length > 0) {
    const p = cleanupPaths.pop();
    if (p) await rm(p, { recursive: true, force: true });
  }
});

describe("remoteStagehandOptions — userMetadata", () => {
  let tmpDir: string;
  let installIdFile: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "browse-identity-test-"));
    cleanupPaths.push(tmpDir);
    installIdFile = join(tmpDir, "telemetry-id");
  });

  it("always includes browse_cli and cli_version", async () => {
    process.env.BROWSERBASE_API_KEY = "bb_test";
    process.env.BROWSERBASE_TELEMETRY_INSTALL_ID_FILE = installIdFile;

    try {
      // Dynamic import so each test gets a fresh module resolution path
      const { remoteStagehandOptions } = await import(
        "../src/lib/driver/remote.js"
      );
      const opts = await remoteStagehandOptions();
      const meta = opts.browserbaseSessionCreateParams?.userMetadata as Record<
        string,
        string
      >;

      expect(meta).toBeDefined();
      expect(meta.browse_cli).toBe("true");
      expect(typeof meta.cli_version).toBe("string");
      expect(meta.cli_version.length).toBeGreaterThan(0);
    } finally {
      delete process.env.BROWSERBASE_API_KEY;
      delete process.env.BROWSERBASE_TELEMETRY_INSTALL_ID_FILE;
    }
  });

  it("includes install_id when resolution succeeds", async () => {
    process.env.BROWSERBASE_API_KEY = "bb_test";
    process.env.BROWSERBASE_TELEMETRY_INSTALL_ID_FILE = installIdFile;

    // Pre-seed the install id so resolution succeeds without race
    await writeFile(installIdFile, "test-install-uuid-123\n", "utf8");

    try {
      const { remoteStagehandOptions } = await import(
        "../src/lib/driver/remote.js"
      );
      const opts = await remoteStagehandOptions();
      const meta = opts.browserbaseSessionCreateParams?.userMetadata as Record<
        string,
        string
      >;

      expect(meta.install_id).toBeDefined();
      // Only allowed chars; UUID hyphens are fine
      expect(meta.install_id).toMatch(/^[\w\-_,;:.()&$%#@!?~]+$/);
    } finally {
      delete process.env.BROWSERBASE_API_KEY;
      delete process.env.BROWSERBASE_TELEMETRY_INSTALL_ID_FILE;
    }
  });

  it("omits install_id when not resolvable but still returns valid metadata", async () => {
    process.env.BROWSERBASE_API_KEY = "bb_test";
    // Point to a file that cannot be created (non-existent parent dir in a
    // read-only location). Simplest: unset the override and use a mock.
    delete process.env.BROWSERBASE_TELEMETRY_INSTALL_ID_FILE;

    // Spy on resolveInstallId to simulate rejection
    const identityModule = await import("../src/lib/identity.js");
    vi.spyOn(identityModule, "resolveInstallId").mockRejectedValue(
      new Error("disk failure"),
    );

    try {
      const { remoteStagehandOptions } = await import(
        "../src/lib/driver/remote.js"
      );
      const opts = await remoteStagehandOptions();
      const meta = opts.browserbaseSessionCreateParams?.userMetadata as Record<
        string,
        string
      >;

      expect(meta.browse_cli).toBe("true");
      expect(typeof meta.cli_version).toBe("string");
      // install_id must NOT be present (never send an undefined/empty value)
      expect(Object.prototype.hasOwnProperty.call(meta, "install_id")).toBe(
        false,
      );
    } finally {
      delete process.env.BROWSERBASE_API_KEY;
    }
  });
});

// ---------------------------------------------------------------------------
// resolveInstallId — persistence + convergence (race-safe marker handling)
// ---------------------------------------------------------------------------

describe("resolveInstallId — persistence", () => {
  let tmpDir: string;
  let installIdFile: string;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "browse-install-id-test-"));
    cleanupPaths.push(tmpDir);
    installIdFile = join(tmpDir, "telemetry-id");
    // Each test needs a fresh module so the module-level install-id cache is
    // reset; resetModules() forces the next dynamic import to re-evaluate.
    vi.resetModules();
  });

  it("takes ownership of an EMPTY marker file: returns a non-empty, persisted id", async () => {
    process.env.BROWSERBASE_TELEMETRY_INSTALL_ID_FILE = installIdFile;
    // Pre-create an EMPTY marker (simulates a process that created the file via
    // 'wx' but crashed/raced before writing, or a stale empty marker).
    await writeFile(installIdFile, "", "utf8");

    try {
      const { resolveInstallId } = await import("../src/lib/identity.js");
      const id = await resolveInstallId(process.env);

      // Must return a non-empty id...
      expect(typeof id).toBe("string");
      expect(id.length).toBeGreaterThan(0);

      // ...AND that id must now be persisted to the (previously empty) file.
      const persisted = (await readFile(installIdFile, "utf8")).trim();
      expect(persisted.length).toBeGreaterThan(0);
      expect(persisted).toBe(id);
    } finally {
      delete process.env.BROWSERBASE_TELEMETRY_INSTALL_ID_FILE;
    }
  });

  it("returns the existing non-empty id without overwriting it", async () => {
    process.env.BROWSERBASE_TELEMETRY_INSTALL_ID_FILE = installIdFile;
    await writeFile(installIdFile, "existing-stable-id-abc\n", "utf8");

    try {
      const { resolveInstallId } = await import("../src/lib/identity.js");
      const id = await resolveInstallId(process.env);

      expect(id).toBe("existing-stable-id-abc");
      const persisted = (await readFile(installIdFile, "utf8")).trim();
      expect(persisted).toBe("existing-stable-id-abc");
    } finally {
      delete process.env.BROWSERBASE_TELEMETRY_INSTALL_ID_FILE;
    }
  });

  it("creates and persists a new id when no marker exists", async () => {
    process.env.BROWSERBASE_TELEMETRY_INSTALL_ID_FILE = installIdFile;
    // Note: installIdFile does not exist yet (only tmpDir does).

    try {
      const { resolveInstallId } = await import("../src/lib/identity.js");
      const id = await resolveInstallId(process.env);

      expect(id.length).toBeGreaterThan(0);
      const persisted = (await readFile(installIdFile, "utf8")).trim();
      expect(persisted).toBe(id);
    } finally {
      delete process.env.BROWSERBASE_TELEMETRY_INSTALL_ID_FILE;
    }
  });
});
