import type { ProbeEvidence, TaskSpec, Trajectory } from "stagehand-v3";
import type { UnrealToolCall } from "@browserbasehq/stagehand-integrations-unreal-agent-sdk";
import type { FacadeCallRecord } from "../unrealAgentToolAdapter.js";
import type { StepObservation } from "../observationRecorder.js";
import { buildTrajectory, type NormalizedToolCall } from "./trajectoryAdapter.js";

export function unrealAgentTrajectory(input: {
  taskSpec: TaskSpec;
  toolCalls: UnrealToolCall[];
  facadeCalls: FacadeCallRecord[];
  finalAnswer: string;
  status: Trajectory["status"];
  usage: Partial<Trajectory["usage"]>;
  finalObservation?: ProbeEvidence;
  stepObservations?: StepObservation[];
}): Trajectory {
  const calls: NormalizedToolCall[] = [];
  const observations = new Map(
    (input.stepObservations ?? []).map((item) => [item.runIndex, item.evidence]),
  );
  const addFacadeCall = (index: number) => {
    const call = input.facadeCalls[index];
    if (!call) return;
    const text = call.result.content
      .flatMap((part) => (part.type === "text" && typeof part.text === "string" ? [part.text] : []))
      .join("\n");
    calls.push({
      name: `facade.${call.name}`,
      args: call.args,
      result: text,
      ok: call.result.isError !== true,
      ...(call.result.isError && { error: text || "facade tool error" }),
      ...(observations.has(index) && { probeEvidence: observations.get(index) }),
      images: call.result.content.flatMap((part) =>
        part.type === "image" && typeof part.data === "string" && typeof part.mimeType === "string"
          ? [{ bytes: Buffer.from(part.data, "base64"), mediaType: part.mimeType }]
          : [],
      ),
    });
  };
  let facadeIndex = 0;
  for (const call of input.toolCalls) {
    const command = typeof call.args.command === "string" ? call.args.command : "";
    const invocations = [
      ...command.matchAll(/(?:^|\s)(?:\.\/)?facade\s+(?:run|snapshot|screenshot)\b/g),
    ].length;
    if (call.name === "Bash" && invocations > 0) {
      for (let index = 0; index < invocations && facadeIndex < input.facadeCalls.length; index++) {
        addFacadeCall(facadeIndex++);
      }
      continue;
    }
    calls.push({
      name: call.name,
      args: call.args,
      result: call.result,
      ok: call.status !== "error",
      ...(call.status === "error" && { error: call.result ?? "tool error" }),
    });
  }
  while (facadeIndex < input.facadeCalls.length) addFacadeCall(facadeIndex++);
  return buildTrajectory({
    taskSpec: input.taskSpec,
    toolCalls: calls,
    finalAnswer: input.finalAnswer,
    status: input.status,
    usage: input.usage,
    ...(input.finalObservation && { finalObservation: input.finalObservation }),
  });
}
