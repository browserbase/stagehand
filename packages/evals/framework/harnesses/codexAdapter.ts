import type { ProbeEvidence, TaskSpec, Trajectory } from "stagehand-v3";
import type { StepObservation } from "../observationRecorder.js";
import {
  buildTrajectory,
  type NormalizedToolCall,
  type TrajectoryAdapter,
} from "./trajectoryAdapter.js";

export interface CodexRunResult {
  events: Array<Record<string, unknown>>;
  finalAnswer?: string;
  status?: Trajectory["status"];
  usage?: Partial<Trajectory["usage"]>;
  finalObservation?: ProbeEvidence;
  stepObservations?: StepObservation[];
  observedToolName?: (name: string) => boolean;
}

export class CodexTrajectoryAdapter implements TrajectoryAdapter<CodexRunResult> {
  fromHarnessResult(result: CodexRunResult, taskSpec: TaskSpec): Trajectory {
    const toolCalls: NormalizedToolCall[] = [];
    let pendingReasoning = "";
    let latestAgentMessage: string | undefined;

    for (const event of result.events) {
      const type = String((event as Record<string, unknown>).type ?? "");
      if (type !== "item.completed") continue;
      const item = (event as Record<string, unknown>).item;
      if (!isRecord(item)) continue;
      const itemType = String(item.type ?? "");

      if (itemType === "reasoning" && typeof item.text === "string") {
        pendingReasoning = pendingReasoning ? `${pendingReasoning}\n${item.text}` : item.text;
        continue;
      }

      if (itemType === "agent_message" && typeof item.text === "string") {
        pendingReasoning = "";
        latestAgentMessage = item.text;
        continue;
      }

      const call = normalizeItem(itemType, item, pendingReasoning);
      if (call) {
        if (typeof item.id === "string") call.id = item.id;
        toolCalls.push(call);
        pendingReasoning = "";
      }
    }

    const keyed = new Map(
      (result.stepObservations ?? [])
        .filter((observation) => observation.toolCallId)
        .map((observation) => [observation.toolCallId, observation.evidence]),
    );
    for (const call of toolCalls) {
      if (call.id && keyed.has(call.id)) call.probeEvidence = keyed.get(call.id);
    }
    const observations = (result.stepObservations ?? []).filter(
      (observation) => !observation.toolCallId,
    );
    if (observations.length > 0) {
      const observedCalls = toolCalls.filter((call) =>
        result.observedToolName
          ? result.observedToolName(call.name)
          : typeof call.args.command === "string" && call.args.command.includes("browser_run.mjs"),
      );
      const totalObservedRuns = Math.max(...observations.map((o) => o.runIndex)) + 1;
      if (observedCalls.length === totalObservedRuns) {
        const observationsByRunIndex = new Map(observations.map((o) => [o.runIndex, o.evidence]));
        observedCalls.forEach((call, ordinal) => {
          const observation = observationsByRunIndex.get(ordinal);
          if (observation) call.probeEvidence = observation;
        });
      }
    }

    const finalAnswer = result.finalAnswer ?? latestAgentMessage;

    return buildTrajectory({
      taskSpec,
      toolCalls,
      finalAnswer,
      status: result.status ?? "complete",
      usage: result.usage,
      ...(result.finalObservation?.screenshot && {
        finalObservation: result.finalObservation,
      }),
    });
  }
}

export const codexAdapter = new CodexTrajectoryAdapter();

function normalizeItem(
  itemType: string,
  item: Record<string, unknown>,
  reasoning: string,
): NormalizedToolCall | undefined {
  if (itemType === "command_execution") {
    const command = typeof item.command === "string" ? item.command : "";
    const exitCode = typeof item.exit_code === "number" ? item.exit_code : undefined;
    const status = String(item.status ?? "");
    const ok = exitCode === 0 || status === "completed";
    const output = typeof item.aggregated_output === "string" ? item.aggregated_output : "";
    const leading = command.split(/\s+/, 1)[0] || "command_execution";
    return {
      name: leading,
      args: { command, ...(exitCode !== undefined && { exit_code: exitCode }) },
      result: output,
      ok,
      ...(!ok && {
        error: exitCode !== undefined ? `exit code ${exitCode}` : `command status ${status}`,
      }),
      reasoning: reasoning || undefined,
    };
  }

  if (itemType === "mcp_tool_call") {
    const server = typeof item.server === "string" ? item.server : "mcp";
    const tool = typeof item.tool === "string" ? item.tool : "tool";
    const args = isRecord(item.arguments) ? (item.arguments as Record<string, unknown>) : {};
    const status = String(item.status ?? "");
    const ok = status !== "failed";
    const mcpResult = isRecord(item.result) ? item.result : undefined;
    const structured = mcpResult?.structured_content;
    const content = mcpResult?.content;
    const errorMessage = isRecord(item.error)
      ? typeof item.error.message === "string"
        ? item.error.message
        : undefined
      : undefined;

    let payload: unknown;
    if (structured !== undefined && structured !== null) {
      payload = structured;
    } else if (Array.isArray(content)) {
      const parts: string[] = [];
      for (const block of content) {
        if (!isRecord(block)) continue;
        if (block.type === "text" && typeof block.text === "string") {
          parts.push(block.text);
        } else if (block.type === "image") {
          parts.push("[image]");
        } else if (typeof block.text === "string") {
          parts.push(block.text);
        }
      }
      payload = parts.join("\n");
    } else if (!ok && errorMessage) {
      payload = errorMessage;
    } else {
      payload = "";
    }

    return {
      name: `${server}.${tool}`,
      args,
      result: payload,
      ok,
      ...(errorMessage && !ok && { error: errorMessage }),
      reasoning: reasoning || undefined,
    };
  }

  if (itemType === "web_search") {
    const query = typeof item.query === "string" ? item.query : "";
    return {
      name: "web_search",
      args: { query },
      result: "",
      ok: true,
      reasoning: reasoning || undefined,
    };
  }

  if (itemType === "file_change") {
    const changes = Array.isArray(item.changes) ? item.changes : [];
    const status = String(item.status ?? "");
    return {
      name: "file_change",
      args: { changes },
      result: { status, changes },
      ok: status === "completed",
      reasoning: reasoning || undefined,
    };
  }

  if (itemType === "error") {
    const message = typeof item.message === "string" ? item.message : "codex error item";
    return {
      name: "error",
      args: {},
      result: message,
      ok: false,
      error: message,
      reasoning: reasoning || undefined,
    };
  }

  return undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
