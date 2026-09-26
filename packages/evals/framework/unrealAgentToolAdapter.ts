import http from "node:http";
import { randomUUID } from "node:crypto";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import type { AddressInfo } from "node:net";
import type { ProbeEvidence } from "stagehand-v3";
import type { StartupProfile, ToolSurface, RunnerToolCallResult } from "../core/contracts/tool.js";
import type { EvalLogger } from "../logger.js";
import type { ExternalHarnessTaskPlan } from "./externalHarnessPlan.js";
import { startAgentToolRuntime } from "./agentToolRuntime.js";
import { ObservationRecorder, type StepObservation } from "./observationRecorder.js";
import { resolveStartupProfile, resolveToolSurface } from "./harnesses/toolSurfaceResolution.js";
import { EvalsError } from "../errors.js";

export const UNREAL_AGENT_TOOL_SURFACES: ToolSurface[] = ["stagehand_facade"];
type FacadeName = "run" | "snapshot" | "screenshot";

export interface FacadeCallRecord {
  name: FacadeName;
  args: Record<string, unknown>;
  result: RunnerToolCallResult;
}

export interface UnrealAgentToolAdapter {
  cwd: string;
  env: Record<string, string>;
  promptInstructions: string;
  facadeCalls: FacadeCallRecord[];
  captureEvidence: () => Promise<ProbeEvidence>;
  drainStepObservations: () => Promise<StepObservation[]>;
  cleanup: () => Promise<void>;
}

export interface UnrealAgentToolAdapterInput {
  toolSurface?: ToolSurface;
  startupProfile?: StartupProfile;
  environment: "LOCAL" | "BROWSERBASE";
  plan: ExternalHarnessTaskPlan;
  logger: EvalLogger;
}

const clientSource = `#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
const name = process.argv[2];
if (!['run', 'snapshot', 'screenshot'].includes(name)) {
  console.error('Usage: facade <run|snapshot|screenshot> [JSON arguments]');
  process.exit(2);
}
let args = {};
try {
  if (name === 'run') {
    const input = process.argv[3];
    if (!input) throw new Error('run needs JavaScript code or an actions JSON object');
    if (input.startsWith('@')) args = {code: fs.readFileSync(input.slice(1), 'utf8')};
    else if (input.startsWith('{')) args = JSON.parse(input);
    else args = {code: input};
  } else if (process.argv[3]) args = JSON.parse(process.argv[3]);
  const response = await fetch('http://127.0.0.1:' + process.env.EVAL_UNREAL_FACADE_PORT + '/tool', {
    method: 'POST',
    headers: {'content-type': 'application/json', 'authorization': 'Bearer ' + process.env.EVAL_UNREAL_FACADE_TOKEN},
    body: JSON.stringify({name, args}),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || 'bridge error');
  for (const [index, item] of payload.content.entries()) {
    if (item.type === 'text') console.log(item.text);
    else if (item.type === 'image') {
      const ext = item.mimeType === 'image/jpeg' ? 'jpg' : 'png';
      const filename = path.join(process.cwd(), 'facade-' + Date.now() + '-' + index + '.' + ext);
      fs.writeFileSync(filename, Buffer.from(item.data, 'base64'));
      console.log('Screenshot: ' + filename);
    } else console.log(JSON.stringify(item));
  }
  if (payload.isError) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
`;

export async function prepareUnrealAgentToolAdapter(
  input: UnrealAgentToolAdapterInput,
): Promise<UnrealAgentToolAdapter> {
  const surface = resolveToolSurface(
    { harness: "unreal_agent", supportedToolSurfaces: UNREAL_AGENT_TOOL_SURFACES },
    input.toolSurface,
  );
  if (surface !== "stagehand_facade")
    throw new EvalsError("Unreal Agent requires stagehand_facade.");
  const startupProfile = resolveStartupProfile(surface, input.environment, input.startupProfile);
  const runtime = await startAgentToolRuntime({
    toolSurface: surface,
    startupProfile,
    environment: input.environment,
    logger: input.logger,
  });
  let cwd: string | undefined;
  let server: http.Server | undefined;
  try {
    const callTool = runtime.running.callTool;
    const captureEvidence = runtime.running.captureEvidence;
    if (!callTool || !captureEvidence)
      throw new EvalsError("stagehand_facade did not expose runner tool calls and evidence.");
    cwd = await fsp.mkdtemp(path.join(os.tmpdir(), "stagehand-evals-unreal-"));
    const clientPath = path.join(cwd, "facade");
    await fsp.writeFile(clientPath, clientSource, { mode: 0o700 });
    const token = randomUUID();
    const facadeCalls: FacadeCallRecord[] = [];
    const observations = new ObservationRecorder(captureEvidence);
    server = http.createServer(async (req, res) => {
      if (
        req.method !== "POST" ||
        req.url !== "/tool" ||
        req.headers.authorization !== `Bearer ${token}`
      ) {
        res.writeHead(403).end(JSON.stringify({ error: "forbidden" }));
        return;
      }
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.from(chunk));
          if (Buffer.concat(chunks).length > 1_000_000) throw new Error("tool request too large");
        }
        const payload = JSON.parse(Buffer.concat(chunks).toString()) as {
          name?: string;
          args?: unknown;
        };
        if (!isFacadeName(payload.name) || !isRecord(payload.args))
          throw new Error("invalid facade tool call");
        const result = await callTool(payload.name, payload.args, { timeoutMs: 300_000 });
        facadeCalls.push({ name: payload.name, args: payload.args, result });
        await observations.record();
        res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(400, { "content-type": "application/json" }).end(
          JSON.stringify({
            error: error instanceof Error ? error.message : String(error),
          }),
        );
      }
    });
    await new Promise<void>((resolve, reject) => {
      server!.once("error", reject);
      server!.listen(0, "127.0.0.1", resolve);
    });
    const port = (server.address() as AddressInfo).port;
    const env = {
      ...process.env,
      PATH: `${cwd}${path.delimiter}${process.env.PATH ?? ""}`,
      EVAL_UNREAL_FACADE_PORT: String(port),
      EVAL_UNREAL_FACADE_TOKEN: token,
    } as Record<string, string>;
    let cleanupPromise: Promise<void> | undefined;
    return {
      cwd,
      env,
      facadeCalls,
      captureEvidence,
      drainStepObservations: async () => {
        await observations.settle();
        return observations.drain();
      },
      promptInstructions: [
        "Use the facade command through Bash for all browser work. It controls one persistent browser.",
        "facade snapshot",
        "facade screenshot",
        "facade run 'await page.goto(\"https://example.com\"); return await page.title()'",
        "For longer JavaScript, write a file in this workspace and call facade run @file.js.",
        "Run code has page, context, and browser in scope. Snapshot IDs are valid until the next snapshot or navigation.",
        "Do not use other browser commands or edit files outside this temporary workspace.",
      ].join("\n"),
      cleanup: () =>
        (cleanupPromise ??= (async () => {
          await new Promise<void>((resolve) => {
            server!.close(() => resolve());
            server!.closeAllConnections?.();
          });
          try {
            await runtime.cleanup();
          } finally {
            await fsp.rm(cwd!, { recursive: true, force: true });
          }
        })()),
    };
  } catch (error) {
    if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
    await runtime.cleanup();
    if (cwd) await fsp.rm(cwd, { recursive: true, force: true });
    throw error;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isFacadeName(value: unknown): value is FacadeName {
  return value === "run" || value === "snapshot" || value === "screenshot";
}
