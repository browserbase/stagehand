import { describe, it } from "vitest";

/**
 * Helpers for tests that only run on POSIX. They depend on shell-script
 * executable stubs (`#!/bin/sh`), `chmod`/uid file modes, or other POSIX-only
 * behavior, so they skip on Windows until the harness writes `.cmd` stubs.
 *
 * The win32 CI leg (run-cli-tests-win32 in ci.yml) runs the full suite; these
 * guards are how a test opts out of Windows. Coverage is on by default — a new
 * test runs on Windows unless it explicitly uses these.
 */
export const itPosix = it.runIf(process.platform !== "win32");
export const describePosix = describe.runIf(process.platform !== "win32");
