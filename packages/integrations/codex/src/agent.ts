import {
  isolatedCodexEnv,
  loadCodexSdk,
  runCodexSession,
} from "@browserbasehq/stagehand-integrations-codex-sdk";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildAllowlistedEnv } from "@browserbasehq/stagehand-integrations/harness";
import { fileURLToPath } from "node:url";

/**
 * codex-sdk has no in-process MCP mounting; MCP servers are supplied through
 * the config override (config.toml shape), the same mechanism the evals codex
 * harness uses.
 */
export function buildCodexConfig(): Record<string, unknown> {
  // Resolved here (not at module load) so a missing build surfaces through
  // handleFailure instead of an uncaught module error.
  const serverPath = fileURLToPath(
    import.meta.resolve("@browserbasehq/stagehand-integrations/facade/stdio-server"),
  );
  return {
    // Required for headless MCP calls on machines without a global
    // approvals_reviewer: without it, tool calls die with "user cancelled
    // MCP tool call" regardless of approvalPolicy.
    approvals_reviewer: "auto_review",
    mcp_servers: {
      stagehand: {
        command: process.execPath,
        args: [serverPath],
        env: buildAllowlistedEnv(),
        default_tools_approval_mode: "approve",
        // Browser launches exceed the default MCP timeouts.
        startup_timeout_sec: 60,
        tool_timeout_sec: 300,
      },
    },
  };
}

const logger = {
  log: () => {},
  warn: () => {},
  error: () => {},
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const instruction = (args[0] === "--" ? args.slice(1) : args).join(" ").trim();
  if (!instruction) throw new Error('Usage: pnpm start "your instruction"');

  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), "stagehand-codex-example-"));
  try {
    const env = await isolatedCodexEnv(cwd);
    const sdk = await loadCodexSdk({
      env,
      ...(process.env.OPENAI_API_KEY ? { apiKey: process.env.OPENAI_API_KEY } : {}),
      // pnpm can skip the SDK's vendored-binary postinstall; point at a locally
      // installed codex when that happens (same escape hatch the evals harness
      // uses).
      ...(process.env.CODEX_PATH_OVERRIDE
        ? { codexPathOverride: process.env.CODEX_PATH_OVERRIDE }
        : {}),
      extraConfig: buildCodexConfig(),
    });
    const result = await runCodexSession({
      prompt: `Use only the mounted Stagehand MCP tools for browser interaction.\n\n${instruction}`,
      allowedMcpServers: ["stagehand"],
      codexHome: env.CODEX_HOME,
      diagnosticDirectory: process.env.STAGEHAND_CODEX_DIAGNOSTICS_DIR,
      // Codex picks its own harness-tuned default model; override only via env.
      model: process.env.CODEX_STAGEHAND_MODEL ?? "",
      sdk,
      logger,
      thread: {
        workingDirectory: cwd,
        // The browser work happens in the MCP server; the local sandbox can stay
        // read-only.
        sandboxMode: "read-only",
        // Headless policy chosen empirically: "on-failure" lets MCP tool calls
        // complete; "never" and "untrusted" auto-cancel them ("user cancelled
        // MCP tool call").
        approvalPolicy: "on-failure",
        skipGitRepoCheck: true,
      },
    });
    if (result.status !== "completed") {
      if (result.diagnosticPath)
        process.stderr.write(`Codex diagnostic saved: ${result.diagnosticPath}\n`);
      // Surface any answer the agent produced before the abnormal stop; a
      // budget/max-turns stop usually still carries a useful final message.
      throw (
        result.iterationError ??
        new Error(
          `Agent did not finish: ${result.stopReason ?? result.status}` +
            (result.finalMessage ? `\nLast agent message: ${result.finalMessage}` : ""),
        )
      );
    }
    // oxlint-disable-next-line no-console -- CLI example prints the agent result.
    console.log(result.finalMessage);
  } finally {
    await fs.rm(cwd, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  main().catch(handleFailure);
}

function handleFailure(error: unknown): void {
  // oxlint-disable-next-line no-console -- CLI example reports failures to stderr.
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
