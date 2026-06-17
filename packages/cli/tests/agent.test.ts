import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { detectAgent } from "../src/lib/agent.js";

const KNOWN_AGENT_ENV_KEYS = [
  "AI_AGENT",
  "ANTIGRAVITY_AGENT",
  "AUGMENT_AGENT",
  "CLAUDECODE",
  "CLAUDE_CODE",
  "CLAUDE_CODE_IS_COWORK",
  "CODEX_CI",
  "CODEX_SANDBOX",
  "CODEX_THREAD_ID",
  "COPILOT_ALLOW_ALL",
  "COPILOT_GITHUB_TOKEN",
  "COPILOT_MODEL",
  "CURSOR_AGENT",
  "CURSOR_EXTENSION_HOST_ROLE",
  "CURSOR_TRACE_ID",
  "GEMINI_CLI",
  "HERMES_SESSION_PLATFORM",
  "OPENCLAW_SHELL",
  "OPENCODE_CLIENT",
  "REPL_ID",
];

describe("detectAgent", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    for (const key of KNOWN_AGENT_ENV_KEYS) {
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of KNOWN_AGENT_ENV_KEYS) {
      delete process.env[key];
    }
    for (const key of KNOWN_AGENT_ENV_KEYS) {
      if (originalEnv[key] !== undefined) {
        process.env[key] = originalEnv[key];
      }
    }
  });

  it("returns null when no agent env vars are set", async () => {
    expect(await detectAgent()).toBeNull();
  });

  it("detects Claude Code via CLAUDECODE", async () => {
    process.env.CLAUDECODE = "1";
    expect(await detectAgent()).toBe("claude");
  });

  it("detects Codex via CODEX_THREAD_ID", async () => {
    process.env.CODEX_THREAD_ID = "019dbcc0-587f-7ae0-94be-79ea21d5e8f3";
    expect(await detectAgent()).toBe("codex");
  });

  it("detects Codex via CODEX_CI", async () => {
    process.env.CODEX_CI = "1";
    expect(await detectAgent()).toBe("codex");
  });

  it("detects Cursor CLI via CURSOR_AGENT", async () => {
    process.env.CURSOR_AGENT = "1";
    expect(await detectAgent()).toBe("cursor-cli");
  });

  it("detects Hermes via HERMES_SESSION_PLATFORM before generic agent env vars", async () => {
    process.env.HERMES_SESSION_PLATFORM = "telegram";
    process.env.CLAUDECODE = "1";
    expect(await detectAgent()).toBe("hermes");
  });

  it("detects OpenClaw via OPENCLAW_SHELL", async () => {
    process.env.OPENCLAW_SHELL = "exec";
    expect(await detectAgent()).toBe("openclaw");
  });
});
