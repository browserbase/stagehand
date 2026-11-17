import { describe, it } from "vitest";

/**
 * Only for POSIX-specific behavior, such as Unix ownership, permissions, and
 * shell quoting. External-command fixtures should use writeNodeExecutable so
 * their tests can run on Windows too.
 */
export const itPosix = it.runIf(process.platform !== "win32");
export const describePosix = describe.runIf(process.platform !== "win32");
