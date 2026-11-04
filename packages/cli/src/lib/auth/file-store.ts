import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, parse, resolve } from "node:path";

import { fail } from "../errors.js";

export function credentialPath(env: NodeJS.ProcessEnv = process.env): string {
  const root =
    env.BROWSERBASE_CONFIG_DIR ||
    join(env.XDG_CONFIG_HOME || join(homedir(), ".config"), "browserbase");
  return join(resolve(root), "auth", "credential.json");
}

// A private directory prevents other users replacing entries between checks and
// opens. Same-user processes are trusted, as with environment-based API keys.
function checkDirectory(path: string): void {
  const info = lstatSync(path);
  if (
    !info.isDirectory() ||
    info.isSymbolicLink() ||
    info.uid !== process.getuid!() ||
    info.mode & 0o077
  ) {
    fail("Saved credential directory must be owned by you with mode 0700, without symlinks.");
  }
}

function checkAncestors(path: string, allowMissing = false): void {
  const root = parse(path).root;
  let current = path;
  while (current !== root) {
    let info;
    try {
      info = lstatSync(current);
    } catch (error) {
      if (allowMissing && (error as NodeJS.ErrnoException).code === "ENOENT") {
        current = dirname(current);
        continue;
      }
      throw error;
    }
    const trustedOwner = info.uid === process.getuid!() || info.uid === 0;
    const safeStickyRoot = info.uid === 0 && (info.mode & 0o1000) !== 0;
    if (
      !info.isDirectory() ||
      info.isSymbolicLink() ||
      !trustedOwner ||
      ((info.mode & 0o022) !== 0 && !safeStickyRoot)
    ) {
      fail(
        "Saved credential path has an unsafe or symlinked parent directory. Choose a private BROWSERBASE_CONFIG_DIR.",
      );
    }
    current = dirname(current);
  }
}

export function readPrivateRecord(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, unknown> | undefined {
  const path = credentialPath(env);
  try {
    // Missing credentials must not break local commands or environment-key use.
    lstatSync(path);
    if (process.platform !== "win32") {
      checkAncestors(dirname(path));
      checkDirectory(dirname(path));
    }
    const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const info = fstatSync(fd);
      if (
        !info.isFile() ||
        (process.platform !== "win32" && (info.uid !== process.getuid!() || info.mode & 0o077)) ||
        info.nlink !== 1 ||
        info.size > 32768
      ) {
        fail(
          "Saved credential file must be private, owned by you, and not linked to another file.",
        );
      }
      const record = JSON.parse(readFileSync(fd, "utf8"));
      if (record.version !== 1)
        fail("Unsupported saved credential format. Run browse login again.");
      return record;
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    fail(
      "Could not securely read saved credentials. Check the private credential directory or run browse logout.",
    );
  }
}

export function withCredentialLock<T>(env: NodeJS.ProcessEnv, action: () => T): T {
  const directory = dirname(credentialPath(env));
  if (process.platform !== "win32") checkAncestors(directory, true);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    checkAncestors(directory);
    checkDirectory(directory);
  }
  const lockPath = join(directory, "credential.lock");
  let fd: number;
  try {
    fd = openSync(
      lockPath,
      constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
      0o600,
    );
  } catch {
    fail(
      `Another credential update may be running. If an earlier login was interrupted, remove ${lockPath} before retrying.`,
    );
  }
  try {
    return action();
  } finally {
    closeSync(fd);
    unlinkSync(lockPath);
  }
}

export function writePrivateRecord(
  record: Record<string, unknown>,
  env: NodeJS.ProcessEnv = process.env,
): void {
  const data = JSON.stringify(record);
  const path = credentialPath(env);
  const directory = dirname(path);
  if (process.platform !== "win32") checkAncestors(directory, true);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (process.platform !== "win32") {
    checkAncestors(directory);
    checkDirectory(directory);
  }
  const temporary = join(directory, `.credential-${randomUUID()}`);
  const fd = openSync(
    temporary,
    constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    try {
      writeFileSync(fd, data);
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, path);
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      // Cleanup is best effort; preserve any original write failure.
      void error;
    }
  }
}

export function removePrivateRecord(env: NodeJS.ProcessEnv = process.env): boolean {
  const path = credentialPath(env);
  try {
    lstatSync(path);
    if (process.platform !== "win32") {
      checkAncestors(dirname(path));
      checkDirectory(dirname(path));
    }
    // unlink never follows a credential-file symlink.
    unlinkSync(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    fail("Could not remove the saved credential. Check the private credential directory.");
  }
}
