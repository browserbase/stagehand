import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { OpenCode } from "@opencode/sdk";
import { Plugin } from "@opencode/plugin";
import {
  extractOpenCodeAssistantText,
  normalizeOpenCodeModel,
  normalizeOpenCodeUsage,
  type OpenCodeConfig,
  type OpenCodeMessage,
  type OpenCodeSessionConfig,
  type OpenCodeSessionResult,
} from "./session.js";

const acknowledgements = new Map<number, { resolve: () => void; reject: (error: Error) => void }>();
let sequence = 0;
let activeHost: Awaited<ReturnType<typeof OpenCode.create>> | undefined;
let activeSessionID: string | undefined;
let interrupted = false;
let readinessAbort: AbortController | undefined;

export function interruptOpenCodeSession(): void {
  interrupted = true;
  readinessAbort?.abort(new Error("OpenCode run interrupted."));
  if (activeHost && activeSessionID) {
    void activeHost.sessions.interrupt({ sessionID: activeSessionID }).catch(() => undefined);
  }
}

function send(message: Record<string, unknown>): void {
  process.send?.(message);
}

async function toolResult(name: string): Promise<void> {
  const id = ++sequence;
  await new Promise<void>((resolve, reject) => {
    acknowledgements.set(id, { resolve, reject });
    send({ kind: "tool", id, name, part: { type: "tool", name } });
  });
}

async function wrapMcpServers(session: OpenCodeSessionConfig): Promise<OpenCodeConfig> {
  const servers: OpenCodeConfig["mcp"]["servers"] = {};
  for (const [name, server] of Object.entries(session.config.mcp.servers)) {
    const specPath = join(session.configRoot, `mcp-${name.replace(/[^a-zA-Z0-9_-]/g, "_")}.json`);
    await writeFile(
      specPath,
      JSON.stringify({ command: server.command, environment: server.environment ?? {} }),
      { mode: 0o600 },
    );
    servers[name] = {
      ...server,
      command: [
        process.execPath,
        fileURLToPath(new URL("./mcp-wrapper.mjs", import.meta.url)),
        specPath,
      ],
      environment: {},
    };
  }
  return { ...session.config, mcp: { servers } };
}

export async function executeOpenCodeSession(input: {
  prompt: string;
  model: string;
  session: OpenCodeSessionConfig;
}): Promise<OpenCodeSessionResult> {
  let messages: OpenCodeMessage[] = [];
  let outcome: string | undefined;
  let costUsd: number | undefined;
  let tokens: unknown;
  const expectedServers = Object.entries(input.session.config.mcp.servers)
    .filter(([, server]) => !server.disabled)
    .map(([name]) => name.replace(/[^a-zA-Z0-9_-]/g, "_"));
  let ready: (() => void) | undefined;
  const toolsReady = new Promise<void>((resolve) => {
    ready = resolve;
  });
  readinessAbort = new AbortController();
  const plugin = Plugin.define({
    id: "stagehand-opencode-observer",
    async setup(ctx) {
      await ctx.tool.transform((editor) => {
        const tools = editor.list();
        if (
          expectedServers.every((server) =>
            tools.some((tool) => tool.options?.namespace === server),
          )
        )
          ready?.();
      });
      await ctx.tool.hook("execute.after", async (event) => {
        if (event.status === "completed" || event.status === "error") await toolResult(event.tool);
      });
    },
  });
  try {
    const config = await wrapMcpServers(input.session);
    activeHost = await OpenCode.create({
      config: {
        directory: input.session.configRoot,
        project: false,
        content: JSON.stringify(config),
      },
      plugins: [plugin],
    });
    if (interrupted) throw new Error("OpenCode run interrupted.");
    const session = await activeHost.sessions.create({
      location: { directory: input.session.directory },
      title: "Stagehand browser benchmark",
    });
    activeSessionID = session.id;
    const model = normalizeOpenCodeModel(input.model);
    if (model) await activeHost.sessions.switchModel({ sessionID: session.id, model });
    if (expectedServers.length) {
      // SDK startup can register MCP tools after the first prompt takes its tool snapshot.
      await activeHost.mcp.list({ location: { directory: input.session.directory } });
      await waitForToolRegistration(toolsReady, readinessAbort.signal, expectedServers);
    }
    if (interrupted) throw new Error("OpenCode run interrupted.");
    await activeHost.sessions.prompt({ sessionID: session.id, text: input.prompt });
    await activeHost.sessions.wait({ sessionID: session.id });
    const info = await activeHost.sessions.get({ sessionID: session.id });
    outcome = info.outcome;
    costUsd = info.cost;
    tokens = info.tokens;
    let cursor: string | undefined;
    do {
      const page = await activeHost.message.list({
        sessionID: session.id,
        limit: "200",
        ...(cursor ? { cursor } : { order: "asc" }),
      });
      messages.push(
        ...page.data.filter((item): item is OpenCodeMessage => item.type === "assistant"),
      );
      cursor = page.cursor.next ?? undefined;
    } while (cursor);
    const error = messages.find((message) => message.error)?.error?.message;
    const finalMessage = extractOpenCodeAssistantText(messages.at(-1));
    return {
      messages,
      finalMessage,
      status: outcome === "succeeded" && !error ? "completed" : "sdk_error",
      ...(outcome !== "succeeded" && { stopReason: outcome ?? "OpenCode did not finish." }),
      ...(error && { stopReason: error }),
      tokenUsage: normalizeOpenCodeUsage(tokens),
      ...(costUsd !== undefined && { costUsd }),
    };
  } finally {
    if (activeHost && activeSessionID) {
      if (interrupted) {
        await activeHost.sessions.interrupt({ sessionID: activeSessionID }).catch(() => undefined);
      }
      await activeHost.sessions.remove({ sessionID: activeSessionID }).catch(() => undefined);
    }
    await activeHost?.close();
    activeHost = undefined;
    activeSessionID = undefined;
    readinessAbort = undefined;
  }
}

async function waitForToolRegistration(
  ready: Promise<void>,
  signal: AbortSignal,
  servers: string[],
): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => finish(signal.reason);
    const timer = setTimeout(
      () => finish(new Error(`OpenCode MCP tools did not register: ${servers.join(", ")}.`)),
      30_000,
    );
    function finish(error?: unknown): void {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    }
    signal.addEventListener("abort", onAbort, { once: true });
    ready.then(() => finish(), finish);
  });
}

if (process.send) {
  process.on("message", (raw: unknown) => {
    if (!raw || typeof raw !== "object") return;
    const message = raw as Record<string, unknown>;
    if (message.kind === "tool-ack") {
      const id = Number(message.id);
      const pending = acknowledgements.get(id);
      acknowledgements.delete(id);
      if (message.error) pending?.reject(new Error(String(message.error)));
      else pending?.resolve();
    }
    if (message.kind === "abort") {
      interruptOpenCodeSession();
    }
    if (message.kind === "close") {
      void activeHost?.close().finally(() => process.exit(0));
      if (!activeHost) process.exit(0);
    }
    if (message.kind === "run") {
      void executeOpenCodeSession({
        prompt: String(message.prompt),
        model: String(message.model),
        session: message.session as OpenCodeSessionConfig,
      }).then(
        (result) => send({ kind: "result", result }),
        (error) =>
          send({ kind: "error", message: error instanceof Error ? error.message : String(error) }),
      );
    }
  });
}
