import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { describePosix } from "./helpers/platform.js";
import { ensurePrivateDir, ensureRuntimeDir } from "../src/lib/driver/daemon/paths.js";

describePosix("daemon parent directory validation", () => {
  let base: string;
  beforeEach(async () => {
    base = await fs.realpath(await fs.mkdtemp(join(tmpdir(), "browse-parent-")));
  });
  afterEach(async () => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    await fs.rm(base, { recursive: true, force: true });
  });

  it.each([0o700, 0o755, 0o1777])("accepts an owned parent with mode %i", async (mode) => {
    await fs.chmod(base, mode);
    const dir = join(base, "nested", "runtime");
    await ensurePrivateDir(dir);
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o700);
    expect((await fs.stat(join(base, "nested"))).mode & 0o777).toBe(0o700);
    expect((await fs.stat(base)).mode & 0o7777).toBe(mode);
  });

  it.each([0o777, 0o775, 0o702])(
    "rejects writable parent mode %i before creating children",
    async (mode) => {
      await fs.chmod(base, mode);
      await expect(ensurePrivateDir(join(base, "nested", "runtime"))).rejects.toMatchObject({
        telemetry: { resultCode: "daemon_dir_unsafe_parent" },
      });
      expect(await fs.readdir(base)).toEqual([]);
      expect((await fs.stat(base)).mode & 0o7777).toBe(mode);
    },
  );

  it("checks ancestors above an otherwise private immediate parent", async () => {
    const parent = join(base, "private");
    const dir = join(parent, "runtime");
    await fs.mkdir(dir, { recursive: true });
    await fs.chmod(parent, 0o700);
    await fs.chmod(dir, 0o755);
    await fs.chmod(base, 0o777);
    await expect(ensurePrivateDir(dir)).rejects.toMatchObject({
      telemetry: { resultCode: "daemon_dir_unsafe_parent" },
    });
    expect((await fs.stat(dir)).mode & 0o777).toBe(0o755);
  });

  it.each([0o755, 0o1777])("rejects foreign-owned parents even with mode %i", async (mode) => {
    await fs.chmod(base, mode);
    const lstat = fs.lstat.bind(fs);
    vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
      const entry = await lstat(...args);
      if (args[0] === base) entry.uid = process.getuid!() + 1;
      return entry;
    });
    await expect(ensurePrivateDir(join(base, "runtime"))).rejects.toMatchObject({
      telemetry: { resultCode: "daemon_dir_unsafe_parent" },
    });
    expect(await fs.readdir(base)).toEqual([]);
  });

  it("rejects a foreign-owned parent for root", async () => {
    vi.spyOn(process, "getuid").mockReturnValue(0);
    const lstat = fs.lstat.bind(fs);
    vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
      const entry = await lstat(...args);
      entry.uid = args[0] === base ? 1 : 0;
      return entry;
    });
    await expect(ensurePrivateDir(join(base, "runtime"))).rejects.toMatchObject({
      telemetry: { resultCode: "daemon_dir_unsafe_parent" },
    });
    expect(await fs.readdir(base)).toEqual([]);
  });

  it("accepts a root-owned sticky parent like /tmp", async () => {
    await fs.chmod(base, 0o1777);
    const lstat = fs.lstat.bind(fs);
    vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
      const entry = await lstat(...args);
      if (args[0] === base) entry.uid = 0;
      return entry;
    });
    await ensurePrivateDir(join(base, "runtime"));
    expect((await fs.stat(join(base, "runtime"))).mode & 0o777).toBe(0o700);
  });

  it("accepts trusted ancestor symlinks and validates their targets", async () => {
    const target = join(base, "target");
    await fs.mkdir(target);
    await fs.symlink("target", join(base, "link"));
    await ensurePrivateDir(join(base, "link", "runtime"));
    expect((await fs.stat(join(target, "runtime"))).mode & 0o777).toBe(0o700);
    expect(await fs.readlink(join(base, "link"))).toBe("target");
  });

  it("rejects an unsafe ancestor in a symlink's target path", async () => {
    const shared = join(base, "shared");
    const target = join(shared, "private");
    await fs.mkdir(target, { recursive: true });
    await fs.chmod(shared, 0o777);
    await fs.chmod(target, 0o700);
    await fs.symlink(target, join(base, "link"));
    await expect(ensurePrivateDir(join(base, "link", "runtime"))).rejects.toMatchObject({
      telemetry: { resultCode: "daemon_dir_unsafe_parent" },
    });
    expect(await fs.readdir(target)).toEqual([]);
  });

  it("does not hide an unsafe symlink location by resolving to a safe target", async () => {
    const target = join(base, "target");
    const shared = join(base, "shared");
    await fs.mkdir(target);
    await fs.mkdir(shared);
    await fs.chmod(shared, 0o777);
    await fs.symlink(target, join(shared, "link"));
    await expect(ensurePrivateDir(join(shared, "link", "runtime"))).rejects.toMatchObject({
      telemetry: { resultCode: "daemon_dir_unsafe_parent" },
    });
    expect(await fs.readdir(target)).toEqual([]);
  });

  it("rejects foreign-owned ancestor symlinks even when their targets are safe", async () => {
    const target = join(base, "target");
    const link = join(base, "link");
    await fs.mkdir(target);
    await fs.symlink(target, link);
    const lstat = fs.lstat.bind(fs);
    vi.spyOn(fs, "lstat").mockImplementation(async (...args) => {
      const entry = await lstat(...args);
      if (args[0] === link) entry.uid = process.getuid!() + 1;
      return entry;
    });
    await expect(ensurePrivateDir(join(link, "runtime"))).rejects.toMatchObject({
      telemetry: { resultCode: "daemon_dir_unsafe_parent" },
    });
    expect(await fs.readdir(target)).toEqual([]);
  });

  it("checks symlink targets before resolving parent traversal components", async () => {
    const safe = join(base, "safe");
    const shared = join(base, "shared");
    await fs.mkdir(join(safe, "private"), { recursive: true });
    await fs.mkdir(join(shared, "deep"), { recursive: true });
    await fs.mkdir(join(shared, "private"));
    await fs.chmod(shared, 0o777);
    await fs.symlink(join(shared, "deep"), join(safe, "link"));
    await fs.symlink("safe/link/../private", join(base, "alias"));

    await expect(ensurePrivateDir(join(base, "alias", "runtime"))).rejects.toMatchObject({
      telemetry: { resultCode: "daemon_dir_unsafe_parent" },
    });
    expect(await fs.readdir(join(shared, "private"))).toEqual([]);
    expect(await fs.readdir(join(safe, "private"))).toEqual([]);
  });

  it("allows parent traversal components in otherwise trusted symlink targets", async () => {
    await fs.mkdir(join(base, "target", "child"), { recursive: true });
    await fs.symlink("target/child/..", join(base, "alias"));
    await ensurePrivateDir(join(base, "alias", "runtime"));
    expect((await fs.stat(join(base, "target", "runtime"))).mode & 0o777).toBe(0o700);
  });

  it("bounds ancestor symlink loops", async () => {
    await fs.symlink("b", join(base, "a"));
    await fs.symlink("a", join(base, "b"));
    await expect(ensurePrivateDir(join(base, "a", "runtime"))).rejects.toMatchObject({
      telemetry: { resultCode: "daemon_dir_unsafe_parent" },
    });
  });

  it("also rejects unsafe parents selected through TMPDIR", async () => {
    await fs.chmod(base, 0o777);
    vi.stubEnv("TMPDIR", base);
    vi.stubEnv("BROWSE_DAEMON_DIR", undefined);
    await expect(ensureRuntimeDir()).rejects.toMatchObject({
      telemetry: { resultCode: "daemon_dir_unsafe_parent" },
    });
    expect(await fs.readdir(base)).toEqual([]);
  });
});
