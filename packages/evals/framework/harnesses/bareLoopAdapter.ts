/**
 * bareLoopAdapter — converts a bare-loop run (vercel_ai_sdk / anthropic_sdk /
 * openai_agents_sdk) into a `Trajectory` the verifier can consume.
 *
 * Unlike claudeCodeAdapter/codexAdapter, which must reverse-engineer a
 * harness-owned event stream, the bare-loop runners own their loop and record
 * each browse tool invocation as a NormalizedToolCall at execution time. This
 * adapter is therefore nearly the identity function — it exists so all
 * external harnesses go through the same TrajectoryAdapter seam (and so the
 * verifier wiring in gradeExternalTrajectory stays uniform).
 */
import type { TaskSpec, Trajectory } from "@browserbasehq/stagehand";
import {
  buildTrajectory,
  type NormalizedToolCall,
  type TrajectoryAdapter,
} from "./trajectoryAdapter.js";

export interface BareLoopRunResult {
  /** Tool calls recorded by the runner's own loop, in execution order. */
  toolCalls: NormalizedToolCall[];
  /** Final assistant text (the model's closing message). */
  finalAnswer?: string;
  /** Trajectory-level status. Defaults to "complete". */
  status?: Trajectory["status"];
  /** Optional usage to fold into Trajectory.usage. */
  usage?: Partial<Trajectory["usage"]>;
}

export class BareLoopTrajectoryAdapter
  implements TrajectoryAdapter<BareLoopRunResult>
{
  fromHarnessResult(result: BareLoopRunResult, taskSpec: TaskSpec): Trajectory {
    return buildTrajectory({
      taskSpec,
      toolCalls: result.toolCalls,
      finalAnswer: result.finalAnswer,
      status: result.status ?? "complete",
      usage: result.usage,
    });
  }
}

export const bareLoopAdapter = new BareLoopTrajectoryAdapter();
