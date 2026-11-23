import { LocatorChainSchema } from "@browserbasehq/stagehand-protocol/schemas";
import type { LocatorChain } from "@browserbasehq/stagehand-protocol/types";
import type { Protocol } from "devtools-protocol";
import type { ElementChainResolution } from "../dom/locatorScripts/resolveElementChain.js";
import type { CDPSessionLike } from "./cdp.js";
import { executionContexts, type ReadinessOptions } from "./executionContextRegistry.js";
import type { Frame } from "./frame.js";
import { buildLocatorInvocation } from "./locatorInvocation.js";
import { Progress, runWithProgress } from "./progress.js";

/** Exact identity in the session that performed resolution, with no owned remote handle. */
export type ElementChainTarget = {
  session: CDPSessionLike;
  frameId: string;
  backendNodeId: Protocol.DOM.BackendNodeId;
};

export type ElementChainResult =
  | { mode: "count"; count: number }
  | { mode: "selected" | "all"; targets: ElementChainTarget[] };

/** Internal single-frame resolver. Released locator operations still use their existing adapter. */
export class FrameElementChainResolver {
  constructor(
    readonly frame: Frame,
    private readonly readinessOptions: ReadinessOptions = {},
  ) {}

  resolve(
    chain: LocatorChain,
    resolution: ElementChainResolution,
    progress?: Progress,
  ): Promise<ElementChainResult> {
    return runWithProgress(progress ?? { name: "resolve element chain", timeout: 0 }, (context) =>
      this.resolveWithProgress(chain, resolution, context),
    );
  }

  private async resolveWithProgress(
    chain: LocatorChain,
    resolution: ElementChainResolution,
    progress: Progress,
  ): Promise<ElementChainResult> {
    progress.throwIfStopped();
    const validatedChain = LocatorChainSchema.parse(chain);
    if (
      resolution.mode === "selected" &&
      (!Number.isSafeInteger(resolution.index) || resolution.index < 0)
    ) {
      throw new RangeError("Selected chain index must be a non-negative safe integer");
    }
    // A frame may adopt another session during navigation. All commands and
    // cleanup for this operation must stay on the captured session/context.
    const session = this.frame.session;
    const frameId = this.frame.frameId;
    const { contextId } = await progress.run("waiting for chain locator world", () =>
      executionContexts.waitForLocatorWorld(
        session,
        frameId,
        1000,
        progress,
        this.readinessOptions,
      ),
    );
    const objectGroup = `stagehand-chain-${contextId}-${crypto.randomUUID()}`;
    const release = () =>
      progress.cleanup(() => session.send("Runtime.releaseObjectGroup", { objectGroup }));
    let finishing = false;
    const step = <T>(phase: string, work: () => Promise<T>) =>
      progress.run(
        phase,
        async () => {
          try {
            return await work();
          } catch (error) {
            // A rejected late command can also allocate handles after initial cleanup.
            if (finishing) void release();
            throw error;
          }
        },
        release,
      );

    try {
      const evaluated = await step("collecting chain matches", () =>
        session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
          expression: buildLocatorInvocation("resolveElementChainResult", [
            JSON.stringify(validatedChain),
            JSON.stringify(resolution),
          ]),
          contextId,
          objectGroup,
          returnByValue: resolution.mode === "count",
          awaitPromise: true,
        }),
      );
      throwException(evaluated.exceptionDetails);
      if (resolution.mode === "count") {
        const count: unknown = evaluated.result.value;
        if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
          throw new Error("Invalid element chain count response");
        }
        return { mode: "count", count };
      }
      if (resolution.mode === "selected" && evaluated.result.subtype === "null") {
        return { mode: "selected", targets: [] };
      }
      const objectId = evaluated.result.objectId;
      if (!objectId) throw new Error("Missing element chain result handle");
      let objectIds = [objectId];
      if (resolution.mode === "all") {
        const properties = await step("exporting chain matches", () =>
          session.send<Protocol.Runtime.GetPropertiesResponse>("Runtime.getProperties", {
            objectId,
            ownProperties: true,
          }),
        );
        throwException(properties.exceptionDetails);
        objectIds = properties.result
          .filter((property) => /^(0|[1-9]\d*)$/.test(property.name) && property.value?.objectId)
          .sort((a, b) => Number(a.name) - Number(b.name))
          .map((property) => property.value!.objectId!);
      }
      const targets: ElementChainTarget[] = [];
      // Only final requested targets need backend IDs. All-target mode still
      // has one describe per target; count and selected never describe prefixes.
      for (const id of objectIds) {
        const { node } = await step("materializing chain target", () =>
          session.send<Protocol.DOM.DescribeNodeResponse>("DOM.describeNode", { objectId: id }),
        );
        targets.push({ session, frameId, backendNodeId: node.backendNodeId });
      }
      return { mode: resolution.mode, targets };
    } finally {
      finishing = true;
      await release();
      progress.throwIfStopped();
    }
  }
}

function throwException(details?: Protocol.Runtime.ExceptionDetails): void {
  if (details) throw new Error(details.exception?.description ?? details.text);
}
