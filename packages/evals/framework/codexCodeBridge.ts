/**
 * Code-execution bridge for the codex harness.
 *
 * codex-sdk has no in-process MCP server mounting (unlike claude-agent-sdk),
 * and an external MCP process could not share this process's live surface
 * handles (the v4 Stagehand client, playwright browser objects). So the
 * codex mount for a `code_handles` LLMExposure is a loopback HTTP bridge:
 * this process executes snippets against the in-memory handles; the codex
 * workspace gets a tiny client script (`browser_run.mjs`) that posts a
 * snippet file's contents to the bridge and prints the result.
 *
 * Scope semantics are identical to the claude_code run tool: the snippet
 * runs inside an async function whose arguments are the exposure's handle
 * names plus startUrl, task, and console — names, not order, bind values.
 */
import http from "node:http";
import type { AddressInfo } from "node:net";
import type { LLMExposure } from "../core/contracts/tool.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import type { EvalLogger } from "../logger.js";

const DEFAULT_RUN_TIMEOUT_MS = 60_000;

function readPositiveIntEnv(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`run timed out after ${timeoutMs}ms`)),
      timeoutMs,
    );
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}

function stringifyResult(value: unknown): string {
  if (typeof value === "undefined") return "undefined";
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value, null, 2) ?? String(value);
  } catch {
    return String(value);
  }
}

export interface CodeBridge {
  port: number;
  close: () => Promise<void>;
}

export async function startCodeBridge(input: {
  exposure: LLMExposure;
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}): Promise<CodeBridge> {
  const { exposure, plan, logger } = input;
  const handles = exposure.handles ?? {};
  const runTool = exposure.runTool;
  const bridgeConsole = runTool?.console ?? {
    log: (...args: unknown[]) =>
      logger.log({ category: "codex", level: 1, message: args.join(" ") }),
    warn: (...args: unknown[]) =>
      logger.warn({ category: "codex", level: 1, message: args.join(" ") }),
    error: (...args: unknown[]) =>
      logger.error({ category: "codex", level: 0, message: args.join(" ") }),
  };

  async function executeSnippet(code: string): Promise<unknown> {
    const AsyncFunction = Object.getPrototypeOf(async function () {})
      .constructor as new (
      ...args: string[]
    ) => (...values: unknown[]) => Promise<unknown>;
    const fn = new AsyncFunction(
      ...Object.keys(handles),
      "startUrl",
      "task",
      "console",
      code,
    );
    return fn(
      ...Object.values(handles),
      plan.startUrl,
      runTool?.task ?? {
        instruction: plan.instruction,
        startUrl: plan.startUrl,
      },
      bridgeConsole,
    );
  }

  const server = http.createServer((req, res) => {
    if (req.method !== "POST" || req.url !== "/run") {
      res.writeHead(404).end();
      return;
    }
    let body = "";
    req.on("data", (chunk) => (body += chunk));
    req.on("end", async () => {
      let code: string;
      try {
        code = String((JSON.parse(body) as { code?: unknown }).code ?? "");
      } catch {
        res
          .writeHead(400)
          .end(JSON.stringify({ ok: false, error: "invalid JSON body" }));
        return;
      }
      try {
        const result = await withTimeout(
          executeSnippet(code),
          readPositiveIntEnv(
            "EVAL_CODEX_RUN_TOOL_TIMEOUT_MS",
            DEFAULT_RUN_TIMEOUT_MS,
          ),
        );
        const text = stringifyResult(result);
        logger.log({
          category: "codex",
          level: 1,
          message: `bridge run completed: ${text.slice(0, 500)}`,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: true, result: text }));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.warn({
          category: "codex",
          level: 1,
          message: `bridge run failed: ${message}`,
        });
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ ok: false, error: message }));
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections?.();
      }),
  };
}

/**
 * The workspace client codex invokes via shell. Kept dependency-free and
 * tiny: read a snippet file (or stdin), post to the bridge, print the
 * result text; non-zero exit on execution error so the agent notices.
 */
export function buildBridgeClientScript(port: number): string {
  return `#!/usr/bin/env node
// browser_run.mjs — execute a browser-automation snippet via the eval bridge.
// Usage: node browser_run.mjs <snippet-file>   (or pipe the snippet on stdin)
import { readFileSync } from "node:fs";

const file = process.argv[2];
const code = file ? readFileSync(file, "utf8") : readFileSync(0, "utf8");
const res = await fetch("http://127.0.0.1:${port}/run", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ code }),
});
const payload = await res.json();
if (payload.ok) {
  console.log(payload.result);
} else {
  console.error("run failed: " + payload.error);
  process.exit(1);
}
`;
}
