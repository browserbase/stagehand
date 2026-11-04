import { constants, promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { fail } from "../../errors.js";

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

export function runtimeDir(): string {
  const dir = process.env.BROWSE_DAEMON_DIR ?? path.join(os.tmpdir(), defaultRuntimeDirName());
  assertNonEmptyDir(dir);
  return dir;
}

export function sanitizeSessionName(session: string): string {
  const sanitized = session.replace(/[^A-Za-z0-9._-]/g, "-").replace(/^[.-]+|[.-]+$/g, "");
  const base = sanitized || "default";
  if (base === session) return base;
  const hash = createHash("sha256").update(session).digest("hex").slice(0, 8);
  return `${base}-${hash}`;
}

export async function ensureRuntimeDir(): Promise<string> {
  const dir = runtimeDir();
  await ensurePrivateDir(dir);
  return dir;
}

export async function ensurePrivateDir(dir: string): Promise<void> {
  assertNonEmptyDir(dir);
  // Strip trailing separators so O_NOFOLLOW also rejects "symlink/".
  const resolvedDir = path.resolve(dir);
  const uid = typeof process.getuid === "function" ? process.getuid() : undefined;
  if (process.platform !== "win32" && uid !== undefined) {
    await ensureTrustedParents(resolvedDir, uid);
  }
  try {
    await fs.mkdir(resolvedDir, { mode: PRIVATE_DIR_MODE, recursive: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "ENOENT") throw error;
    // mkdir can report ENOENT for a dangling symlink. Inspect the entry below;
    // if it really is missing, opening it will fail without changing anything.
  }

  if (process.platform === "win32") {
    if (!(await fs.lstat(resolvedDir)).isDirectory()) failInvalidDirectory(dir);
    return;
  }

  const handle = await fs
    .open(resolvedDir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === "ELOOP" || error.code === "ENOTDIR") failInvalidDirectory(dir);
      throw error;
    });
  try {
    // Inspect and chmod the same directory, even if its pathname is replaced.
    const entry = await handle.stat();
    if (!entry.isDirectory()) failInvalidDirectory(dir);
    // Root must also reject foreign ownership: chmod does not change the owner.
    if (uid !== undefined && entry.uid !== uid) {
      fail(
        `Refusing to use ${dir}: it is owned by another user. Set BROWSE_DAEMON_DIR to a directory you own.`,
        1,
        { resultCode: "daemon_dir_not_owned" },
      );
    }
    await handle.chmod(PRIVATE_DIR_MODE);
  } finally {
    await handle.close();
  }
}

/**
 * Check from the root downward so each entry is protected before we inspect it
 * or create a child. A trusted sticky directory (such as /tmp) protects entries
 * owned by us or root; a foreign owner can replace children even with that bit.
 * Never realpath first: that would hide replaceable symlink ancestors.
 */
async function ensureTrustedParents(dir: string, uid: number): Promise<void> {
  let symlinksRemaining = 40;

  const reject = (parent: string, reason: string): never => {
    fail(
      `Refusing to use ${dir}: parent ${parent} ${reason}. Choose a runtime directory beneath trusted parents owned by you or the system.`,
      1,
      { resultCode: "daemon_dir_unsafe_parent" },
    );
  };

  const inspect = async (parent: string, createMissing: boolean) => {
    const entry = await fs.lstat(parent).catch(async (error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT" || !createMissing) throw error;
      // The ancestor is already trusted. Inspect even an entry created by a
      // concurrent process instead of assuming mkdir established ownership.
      await fs.mkdir(parent, { mode: PRIVATE_DIR_MODE }).catch((error: NodeJS.ErrnoException) => {
        if (error.code !== "EEXIST") throw error;
      });
      return fs.lstat(parent);
    });
    if (entry.uid !== 0 && entry.uid !== uid) reject(parent, "is owned by another user");
    if (!entry.isSymbolicLink()) {
      if (!entry.isDirectory()) reject(parent, "is not a directory");
      if ((entry.mode & 0o022) !== 0 && (entry.mode & 0o1000) === 0) {
        reject(parent, "is writable by other users without sticky-bit protection");
      }
    }
    return entry;
  };

  const root = path.parse(dir).root;
  await inspect(root, false);
  const walk = async (start: string, parts: string[], createMissing: boolean): Promise<string> => {
    let current = start;
    for (const part of parts) {
      if (part === "" || part === ".") continue;
      if (part === "..") {
        current = path.dirname(current);
        continue;
      }
      const next = path.join(current, part);
      const entry = await inspect(next, createMissing);
      if (entry.isSymbolicLink()) {
        if (symlinksRemaining-- === 0) reject(next, "has too many symbolic links");
        const target = await fs.readlink(next);
        // Resolve each target component before processing '..', just as the
        // kernel does. Normalizing the target first could check the wrong path.
        // Never create missing targets of dangling ancestor links.
        current = await walk(
          path.isAbsolute(target) ? root : current,
          target.split(path.sep),
          false,
        );
      } else {
        current = next;
      }
    }
    return current;
  };

  await walk(root, path.relative(root, path.dirname(dir)).split(path.sep), true);
}

function assertNonEmptyDir(dir: string): void {
  if (dir === "") {
    fail(
      "Refusing to use an empty directory path. Unset BROWSE_DAEMON_DIR or set a non-empty path.",
      1,
      {
        resultCode: "daemon_dir_invalid",
      },
    );
  }
}

function failInvalidDirectory(dir: string): never {
  fail(`Refusing to use ${dir}: it must be a directory, not a symlink or other file.`, 1, {
    resultCode: "daemon_dir_invalid",
  });
}

export async function writePrivateFile(file: string, contents: string): Promise<void> {
  await fs.writeFile(file, contents, { mode: PRIVATE_FILE_MODE });
  await chmodIfSupported(file, PRIVATE_FILE_MODE);
}

export function getSocketPath(session: string): string {
  const name = sanitizeSessionName(session);
  if (process.platform === "win32") {
    return `\\\\.\\pipe\\browse-driver-${name}`;
  }

  return path.join(runtimeDir(), `${name}.sock`);
}

export function getPidPath(session: string): string {
  return path.join(runtimeDir(), `${sanitizeSessionName(session)}.pid`);
}

export function getLockPath(session: string): string {
  return path.join(runtimeDir(), `${sanitizeSessionName(session)}.lock`);
}

interface CleanupDaemonFilesOptions {
  includeLock?: boolean;
}

export async function cleanupDaemonFiles(
  session: string,
  { includeLock = true }: CleanupDaemonFilesOptions = {},
): Promise<void> {
  const files = [getSocketPath(session), getPidPath(session)];
  if (includeLock) files.push(getLockPath(session));
  for (const file of files) {
    // Keep validation outside the best-effort unlink handler. Ownership loss
    // must abort cleanup, including when it happens between artifact deletions.
    await ensureRuntimeDir();
    await fs.unlink(file).catch(() => undefined);
  }
}

export function getNetworkDir(session: string): string {
  return path.join(runtimeDir(), `${sanitizeSessionName(session)}-network`);
}

async function chmodIfSupported(target: string, mode: number): Promise<void> {
  if (process.platform === "win32") return;
  await fs.chmod(target, mode);
}

function defaultRuntimeDirName(): string {
  const uid = typeof process.getuid === "function" ? process.getuid() : null;
  return uid === null ? "browse-driver" : `browse-driver-${uid}`;
}
