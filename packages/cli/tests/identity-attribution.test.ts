/**
 * Focused unit tests for:
 * 1. toMetadataValue — sanitizes userMetadata values for the session-create validator
 * 2. attributionHeaders (via api.ts) — always sends x-bb-client; conditionally x-bb-install-id
 * 3. remoteStagehandOptions — always includes browse_cli + cli_version; includes install_id only when resolved
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

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

  it("always includes browse_cli and the seeded cli_version", async () => {
    process.env.BROWSERBASE_API_KEY = "bb_test";
    process.env.BROWSERBASE_TELEMETRY_INSTALL_ID_FILE = installIdFile;

    try {
      // Dynamic import so each test gets a fresh module resolution path
      const identityModule = await import("../src/lib/identity.js");
      // Seed the version the way base.ts does from Config.version at startup.
      identityModule.setCliVersion("1.2.3");

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
      // cli_version reflects the seeded oclif version, never "unknown".
      expect(meta.cli_version).toBe("1.2.3");
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

// ---------------------------------------------------------------------------
// resolveInstallIdPath / migration — standardized config dir + legacy carry-forward
// ---------------------------------------------------------------------------

describe("resolveInstallIdPath — standardized config dir", () => {
  beforeEach(() => {
    // Fresh module so the module-level install-id cache starts clear.
    vi.resetModules();
  });

  it("uses <BROWSERBASE_CONFIG_DIR>/install-id when that env is set", async () => {
    const { resolveInstallIdPath } = await import("../src/lib/identity.js");
    const configDir = "/tmp/explicit-bb-config";
    expect(resolveInstallIdPath({ BROWSERBASE_CONFIG_DIR: configDir })).toBe(
      join(configDir, "install-id"),
    );
  });

  it("uses <XDG_CONFIG_HOME>/browserbase/install-id when only XDG is set", async () => {
    const { resolveInstallIdPath } = await import("../src/lib/identity.js");
    const xdg = "/tmp/xdg-config-home";
    expect(resolveInstallIdPath({ XDG_CONFIG_HOME: xdg })).toBe(
      join(xdg, "browserbase", "install-id"),
    );
  });

  it("override (BROWSERBASE_TELEMETRY_INSTALL_ID_FILE) short-circuits the config dir", async () => {
    const { resolveInstallIdPath } = await import("../src/lib/identity.js");
    const override = "/tmp/override/some-file";
    expect(
      resolveInstallIdPath({
        BROWSERBASE_TELEMETRY_INSTALL_ID_FILE: override,
        BROWSERBASE_CONFIG_DIR: "/tmp/ignored",
        XDG_CONFIG_HOME: "/tmp/also-ignored",
      }),
    ).toBe(override);
  });
});

describe("resolveInstallId — legacy path migration", () => {
  let tmpDir: string;
  let savedHome: string | undefined;
  let savedUserProfile: string | undefined;

  beforeEach(async () => {
    tmpDir = await mkdtemp(join(tmpdir(), "browse-install-id-migrate-"));
    cleanupPaths.push(tmpDir);
    // Isolate homedir() so the platform-specific legacy markers (macOS
    // ~/Library/..., Windows AppData) resolve INSIDE the temp dir and only
    // exist when this test seeds them — never the host machine's real marker.
    savedHome = process.env.HOME;
    savedUserProfile = process.env.USERPROFILE;
    process.env.HOME = tmpDir;
    process.env.USERPROFILE = tmpDir;
    // Fresh module per test so the module-level cache is reset.
    vi.resetModules();
  });

  afterEach(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedUserProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedUserProfile;
  });

  it("forward-migrates the id from the legacy XDG telemetry-id marker", async () => {
    const knownId = "11111111-2222-3333-4444-555555555555";
    const legacyDir = join(tmpDir, "browserbase", "cli");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(legacyDir, "telemetry-id"), `${knownId}\n`, "utf8");

    const { resolveInstallId } = await import("../src/lib/identity.js");
    const id = await resolveInstallId({ XDG_CONFIG_HOME: tmpDir });

    // The stable id is carried forward, not reset.
    expect(id).toBe(knownId);

    // ...and it now lives at the canonical install-id path.
    const canonical = join(tmpDir, "browserbase", "install-id");
    const persisted = (await readFile(canonical, "utf8")).trim();
    expect(persisted).toBe(knownId);
  });

  it("prefers the canonical install-id over a legacy marker (no clobber)", async () => {
    const canonicalId = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
    const legacyId = "99999999-8888-7777-6666-555555555555";

    const bbDir = join(tmpDir, "browserbase");
    const legacyDir = join(bbDir, "cli");
    await mkdir(legacyDir, { recursive: true });
    await writeFile(join(bbDir, "install-id"), `${canonicalId}\n`, "utf8");
    await writeFile(join(legacyDir, "telemetry-id"), `${legacyId}\n`, "utf8");

    const { resolveInstallId } = await import("../src/lib/identity.js");
    const id = await resolveInstallId({ XDG_CONFIG_HOME: tmpDir });

    expect(id).toBe(canonicalId);
    // The canonical marker is untouched.
    const persisted = (
      await readFile(join(bbDir, "install-id"), "utf8")
    ).trim();
    expect(persisted).toBe(canonicalId);
  });

  it("mints a fresh id at the canonical path on a true first run", async () => {
    // Neither a canonical nor a legacy marker exists under tmpDir.
    const { resolveInstallId } = await import("../src/lib/identity.js");
    const id = await resolveInstallId({ XDG_CONFIG_HOME: tmpDir });

    expect(id.length).toBeGreaterThan(0);
    const canonical = join(tmpDir, "browserbase", "install-id");
    const persisted = (await readFile(canonical, "utf8")).trim();
    expect(persisted).toBe(id);
  });
});

// ---------------------------------------------------------------------------
// getCliVersion / setCliVersion — seeded from Config.version, no fs
// ---------------------------------------------------------------------------

describe("getCliVersion / setCliVersion", () => {
  beforeEach(() => {
    // Fresh module per test so the module-level version cache starts unset.
    vi.resetModules();
  });

  it("returns 'unknown' when never seeded (no filesystem fallback)", async () => {
    const { getCliVersion } = await import("../src/lib/identity.js");
    expect(getCliVersion()).toBe("unknown");
  });

  it("returns the value seeded via setCliVersion", async () => {
    const { getCliVersion, setCliVersion } = await import(
      "../src/lib/identity.js"
    );
    setCliVersion("0.9.0");
    expect(getCliVersion()).toBe("0.9.0");
  });

  it("ignores an empty seed, leaving the 'unknown' fallback intact", async () => {
    const { getCliVersion, setCliVersion } = await import(
      "../src/lib/identity.js"
    );
    setCliVersion("");
    expect(getCliVersion()).toBe("unknown");
  });

  it("keeps a previously-seeded version when later seeded with empty", async () => {
    const { getCliVersion, setCliVersion } = await import(
      "../src/lib/identity.js"
    );
    setCliVersion("1.4.2");
    setCliVersion("");
    expect(getCliVersion()).toBe("1.4.2");
  });
});

// ---------------------------------------------------------------------------
// BrowseCommand.init() — seeds getCliVersion from Config.version at the
// command lifecycle boundary (the real path used by the foreground command
// and the background `browse daemon` process that creates sessions).
// ---------------------------------------------------------------------------

describe("BrowseCommand.init() — version seeding at lifecycle boundary", () => {
  beforeEach(() => {
    // Fresh module so getCliVersion starts unseeded ("unknown") before init.
    vi.resetModules();
  });

  it("seeds getCliVersion() from this.config.version when init() runs", async () => {
    const { Config } = await import("@oclif/core");
    const { BrowseCommand } = await import("../src/base.js");
    const { getCliVersion } = await import("../src/lib/identity.js");

    // Load the package's real oclif Config (this is the same Config oclif
    // hands every command; its .version comes from package.json => 0.9.0).
    // fileURLToPath keeps this correct on Windows (no leading-slash artifact).
    const config = await Config.load(
      fileURLToPath(new URL("..", import.meta.url)),
    );

    // Sanity: unseeded before any command init runs.
    expect(getCliVersion()).toBe("unknown");

    // A minimal concrete BrowseCommand subclass; run the real init() lifecycle.
    class TestCommand extends BrowseCommand {
      async run(): Promise<void> {}
    }
    const command = new TestCommand([], config);
    await command.init();

    // After init(), getCliVersion() reflects Config.version — never "unknown".
    expect(getCliVersion()).toBe(config.version);
    expect(getCliVersion()).not.toBe("unknown");
  });
});
