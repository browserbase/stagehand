import { determineAgent } from "@vercel/detect-agent";

export async function detectAgent(): Promise<string | null> {
  try {
    if (process.env.HERMES_SESSION_PLATFORM) {
      return "hermes";
    }
    if (process.env.OPENCLAW_SHELL) {
      return "openclaw";
    }

    const result = await determineAgent();
    return result.isAgent ? result.agent.name : null;
  } catch {
    return null;
  }
}

/**
 * Synchronous best-effort check for whether the CLI is being driven by a coding
 * agent (Claude Code, Cursor, Codex, Gemini, etc.) rather than a human at a
 * terminal.
 *
 * This mirrors the env-marker checks used by {@link detectAgent} and
 * `@vercel/detect-agent`'s `determineAgent`, which are themselves almost
 * entirely synchronous env reads. We deliberately omit the one async branch in
 * `determineAgent` (a filesystem probe for Devin) so callers that must stay
 * synchronous — e.g. headed/headless mode resolution — can use this without
 * becoming async. The result is used only as a heuristic to bias the default
 * window mode toward headless for agents; the authoritative async
 * {@link detectAgent} still drives telemetry.
 */
export function isAgentContext(): boolean {
  const env = process.env;
  return Boolean(
    env.HERMES_SESSION_PLATFORM ||
      env.OPENCLAW_SHELL ||
      env.AI_AGENT ||
      env.CURSOR_TRACE_ID ||
      env.CURSOR_AGENT ||
      env.CURSOR_EXTENSION_HOST_ROLE === "agent-exec" ||
      env.GEMINI_CLI ||
      env.CODEX_SANDBOX ||
      env.CODEX_CI ||
      env.CODEX_THREAD_ID ||
      env.ANTIGRAVITY_AGENT ||
      env.AUGMENT_AGENT ||
      env.OPENCODE_CLIENT ||
      env.CLAUDECODE ||
      env.CLAUDE_CODE ||
      env.REPL_ID ||
      env.COPILOT_MODEL ||
      env.COPILOT_ALLOW_ALL ||
      env.COPILOT_GITHUB_TOKEN,
  );
}
