import { promises as fs } from "node:fs";
import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";

import { fail } from "../../errors.js";

export const PRIVATE_DIR_MODE = 0o700;
export const PRIVATE_FILE_MODE = 0o600;

export function runtimeDir(): string {
  return process.env.BROWSE_DAEMON_DIR ?? path.join(os.tmpdir(), defaultRuntimeDirName());
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
  // Normalize trailing separators so lstat inspects the directory entry itself,
  // rather than following a symlink with a trailing slash.
  const resolvedDir = path.resolve(dir);
  try {
    await fs.mkdir(resolvedDir, { mode: PRIVATE_DIR_MODE, recursive: true });
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EEXIST" && code !== "ENOENT") throw error;
    // mkdir can report ENOENT for a dangling symlink. Inspect the entry below;
    // if it really is missing, lstat will fail without changing anything.
  }

  const entry = await fs.lstat(resolvedDir);
  if (!entry.isDirectory()) {
    fail(`Refusing to use ${dir}: it must be a directory, not a symlink or other file.`, 1, {
      resultCode: "daemon_dir_invalid",
    });
  }
  // chmod is not an ownership check: root can chmod another user's directory
  // without taking ownership, leaving that user in control of its contents.
  if (typeof process.getuid === "function" && entry.uid !== process.getuid()) {
    fail(
      `Refusing to use ${dir}: it is owned by another user. Set BROWSE_DAEMON_DIR to a directory you own.`,
      1,
      { resultCode: "daemon_dir_not_owned" },
    );
  }
  await chmodIfSupported(resolvedDir, PRIVATE_DIR_MODE);
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
  await Promise.allSettled(files.map((file) => fs.unlink(file)));
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
