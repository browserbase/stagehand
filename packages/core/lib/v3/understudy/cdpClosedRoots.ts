import type { Protocol } from "devtools-protocol";
import type { Frame } from "./frame.js";
import { executionContexts } from "./executionContextRegistry.js";
import { StagehandDomProcessError } from "../types/public/sdkErrors.js";

export interface ClosedShadowRootHandlePair {
  hostObjectId: Protocol.Runtime.RemoteObjectId;
  rootObjectId: Protocol.Runtime.RemoteObjectId;
  hostBackendNodeId: Protocol.DOM.BackendNodeId;
  rootBackendNodeId: Protocol.DOM.BackendNodeId;
}

export interface ClosedShadowRootBundle {
  contextId: Protocol.Runtime.ExecutionContextId;
  documentObjectId: Protocol.Runtime.RemoteObjectId;
  roots: ClosedShadowRootHandlePair[];
}

export async function releaseRemoteObject(
  frame: Frame,
  objectId: Protocol.Runtime.RemoteObjectId | undefined,
): Promise<void> {
  if (!objectId) return;
  await frame.session
    .send("Runtime.releaseObject", { objectId })
    .catch(() => {});
}

export async function collectClosedShadowRoots(
  frame: Frame,
): Promise<ClosedShadowRootBundle> {
  try {
    const contextId = await executionContexts.waitForMainWorld(
      frame.session,
      frame.frameId,
      1000,
    );

    const evaluated =
      await frame.session.send<Protocol.Runtime.EvaluateResponse>(
        "Runtime.evaluate",
        {
          expression: "document",
          contextId,
          returnByValue: false,
          awaitPromise: true,
        },
      );

    const documentObjectId = evaluated.result.objectId;
    if (!documentObjectId) {
      throw new StagehandDomProcessError(
        "unable to resolve document object for closed shadow root collection",
      );
    }

    const described =
      await frame.session.send<Protocol.DOM.DescribeNodeResponse>(
        "DOM.describeNode",
        {
          objectId: documentObjectId,
          depth: -1,
          pierce: true,
        },
      );

    const pairs: Array<{
      hostBackendNodeId: Protocol.DOM.BackendNodeId;
      rootBackendNodeId: Protocol.DOM.BackendNodeId;
    }> = [];

    const visit = (node: Protocol.DOM.Node): void => {
      if (typeof node.backendNodeId === "number" && node.shadowRoots?.length) {
        for (const shadowRoot of node.shadowRoots) {
          if (
            shadowRoot.shadowRootType === "closed" &&
            typeof shadowRoot.backendNodeId === "number"
          ) {
            pairs.push({
              hostBackendNodeId: node.backendNodeId,
              rootBackendNodeId: shadowRoot.backendNodeId,
            });
          }
          visit(shadowRoot);
        }
      }

      for (const child of node.children ?? []) {
        visit(child);
      }
    };

    visit(described.node);

    const roots: ClosedShadowRootHandlePair[] = [];
    for (const pair of pairs) {
      try {
        const [hostResolved, rootResolved] = await Promise.all([
          frame.session.send<Protocol.DOM.ResolveNodeResponse>(
            "DOM.resolveNode",
            {
              backendNodeId: pair.hostBackendNodeId,
              executionContextId: contextId,
            },
          ),
          frame.session.send<Protocol.DOM.ResolveNodeResponse>(
            "DOM.resolveNode",
            {
              backendNodeId: pair.rootBackendNodeId,
              executionContextId: contextId,
            },
          ),
        ]);

        const hostObjectId = hostResolved.object.objectId;
        const rootObjectId = rootResolved.object.objectId;
        if (!hostObjectId || !rootObjectId) continue;

        roots.push({
          hostObjectId,
          rootObjectId,
          hostBackendNodeId: pair.hostBackendNodeId,
          rootBackendNodeId: pair.rootBackendNodeId,
        });
      } catch {
        // ignore individual root resolution failures
      }
    }

    return { contextId, documentObjectId, roots };
  } catch (error) {
    if (error instanceof StagehandDomProcessError) throw error;
    const message = error instanceof Error ? error.message : String(error);
    throw new StagehandDomProcessError(
      `failed to collect closed shadow roots: ${message}`,
    );
  }
}
