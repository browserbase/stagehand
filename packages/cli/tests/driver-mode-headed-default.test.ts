import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  hasDisplay,
  resolveHeadless,
  shouldDefaultHeaded,
} from "../src/lib/driver/mode.js";

/**
 * Tests for the environment-aware headed/headless default introduced for managed
 * local sessions: a human at an interactive TTY with a display gets a HEADED
 * window, while agents / CI / piped / no-display contexts stay HEADLESS. Explicit
 * --headed / --headless always win.
 */

// Env vars that, if set in the ambient shell, would flip isAgentContext() to true
// and make the "interactive human" branch impossible to observe. We clear them
// for the relevant cases and restore afterwards.
const AGENT_ENV_KEYS = [
  "HERMES_SESSION_PLATFORM",
  "OPENCLAW_SHELL",
  "AI_AGENT",
  "CURSOR_TRACE_ID",
  "CURSOR_AGENT",
  "CURSOR_EXTENSION_HOST_ROLE",
  "GEMINI_CLI",
  "CODEX_SANDBOX",
  "CODEX_CI",
  "CODEX_THREAD_ID",
  "ANTIGRAVITY_AGENT",
  "AUGMENT_AGENT",
  "OPENCODE_CLIENT",
  "CLAUDECODE",
  "CLAUDE_CODE",
  "REPL_ID",
  "COPILOT_MODEL",
  "COPILOT_ALLOW_ALL",
  "COPILOT_GITHUB_TOKEN",
] as const;

const DISPLAY_ENV_KEYS = ["DISPLAY", "WAYLAND_DISPLAY"] as const;

const originalPlatform = process.platform;
const originalIsTTY = process.stdout.isTTY;
let savedEnv: Record<string, string | undefined> = {};

function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, "platform", {
    value: platform,
    configurable: true,
  });
}

function setTTY(value: boolean | undefined): void {
  Object.defineProperty(process.stdout, "isTTY", {
    value,
    configurable: true,
  });
}

function clearKeys(keys: readonly string[]): void {
  for (const key of keys) {
    delete process.env[key];
  }
}

beforeEach(() => {
  // Snapshot every env key we may mutate so each test starts from a clean,
  // deterministic baseline regardless of the outer shell (agent, CI, etc.).
  savedEnv = {};
  for (const key of [...AGENT_ENV_KEYS, ...DISPLAY_ENV_KEYS, "CI"]) {
    savedEnv[key] = process.env[key];
  }
  clearKeys(AGENT_ENV_KEYS);
  clearKeys(DISPLAY_ENV_KEYS);
  delete process.env.CI;
});

afterEach(() => {
  setPlatform(originalPlatform);
  setTTY(originalIsTTY);
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("hasDisplay", () => {
  it("returns true on darwin regardless of DISPLAY", () => {
    setPlatform("darwin");
    expect(hasDisplay()).toBe(true);
  });

  it("returns true on win32 regardless of DISPLAY", () => {
    setPlatform("win32");
    expect(hasDisplay()).toBe(true);
  });

  it("returns false on linux without a display server", () => {
    setPlatform("linux");
    expect(hasDisplay()).toBe(false);
  });

  it("returns true on linux with X11 DISPLAY", () => {
    setPlatform("linux");
    process.env.DISPLAY = ":0";
    expect(hasDisplay()).toBe(true);
  });

  it("returns true on linux with WAYLAND_DISPLAY", () => {
    setPlatform("linux");
    process.env.WAYLAND_DISPLAY = "wayland-0";
    expect(hasDisplay()).toBe(true);
  });
});

describe("shouldDefaultHeaded", () => {
  it("is true for an interactive human: TTY + display + no CI + no agent (darwin)", () => {
    setPlatform("darwin");
    setTTY(true);
    expect(shouldDefaultHeaded()).toBe(true);
  });

  it("is true for an interactive human on linux with a display", () => {
    setPlatform("linux");
    setTTY(true);
    process.env.DISPLAY = ":0";
    expect(shouldDefaultHeaded()).toBe(true);
  });

  it("is false when stdout is not a TTY (piped / non-interactive)", () => {
    setPlatform("darwin");
    setTTY(undefined);
    expect(shouldDefaultHeaded()).toBe(false);
  });

  it("is false when CI is set even with a TTY and display", () => {
    setPlatform("darwin");
    setTTY(true);
    process.env.CI = "true";
    expect(shouldDefaultHeaded()).toBe(false);
  });

  it("is false on linux without a display even with a TTY", () => {
    setPlatform("linux");
    setTTY(true);
    expect(shouldDefaultHeaded()).toBe(false);
  });

  it("is false when an agent marker is set even with a TTY and display", () => {
    setPlatform("darwin");
    setTTY(true);
    process.env.CLAUDECODE = "1";
    expect(shouldDefaultHeaded()).toBe(false);
  });

  it("treats a falsy CI value (empty string) as not CI", () => {
    setPlatform("darwin");
    setTTY(true);
    process.env.CI = "";
    expect(shouldDefaultHeaded()).toBe(true);
  });
});

describe("resolveHeadless default branch", () => {
  it("defaults to HEADED for an interactive human (no flags)", () => {
    setPlatform("darwin");
    setTTY(true);
    expect(resolveHeadless({})).toBe(false);
  });

  it("defaults to HEADLESS when not a TTY (no flags)", () => {
    setPlatform("darwin");
    setTTY(undefined);
    expect(resolveHeadless({})).toBe(true);
  });

  it("defaults to HEADLESS in CI (no flags)", () => {
    setPlatform("darwin");
    setTTY(true);
    process.env.CI = "1";
    expect(resolveHeadless({})).toBe(true);
  });

  it("defaults to HEADLESS for an agent (no flags)", () => {
    setPlatform("darwin");
    setTTY(true);
    process.env.CURSOR_TRACE_ID = "abc";
    expect(resolveHeadless({})).toBe(true);
  });

  it("defaults to HEADLESS on linux without a display (no flags)", () => {
    setPlatform("linux");
    setTTY(true);
    expect(resolveHeadless({})).toBe(true);
  });
});

describe("resolveHeadless explicit flags still override", () => {
  it("--headed forces headed even in a headless-default context (non-TTY)", () => {
    setPlatform("darwin");
    setTTY(undefined);
    expect(resolveHeadless({ headed: true })).toBe(false);
  });

  it("--headless forces headless even in a headed-default context (interactive)", () => {
    setPlatform("darwin");
    setTTY(true);
    expect(resolveHeadless({ headless: true })).toBe(true);
  });

  it("rejects passing both --headed and --headless", () => {
    expect(() => resolveHeadless({ headed: true, headless: true })).toThrow(
      "Pass either --headed or --headless",
    );
  });
});
