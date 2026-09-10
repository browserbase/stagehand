import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp.js";

/** Evaluate in the main world with temporary references to author closed roots. */
export async function evaluateWithShadowRoots<Result>(
  session: CDPSessionLike,
  evaluate: (expression: string) => Promise<unknown>,
  functionSource: string,
): Promise<Result> {
  const { root } = await session.send<Protocol.DOM.GetDocumentResponse>("DOM.getDocument", {
    depth: -1,
    pierce: true,
  });
  const closedIds: number[] = [];
  const visit = (node: Protocol.DOM.Node): void => {
    if (node.shadowRootType === "closed") closedIds.push(node.backendNodeId);
    for (const child of node.children ?? []) visit(child);
    for (const shadow of node.shadowRoots ?? []) {
      if (shadow.shadowRootType !== "user-agent") visit(shadow);
    }
    // Frame documents have separate main worlds and are resolved by frame locators.
  };
  visit(root);
  if (!closedIds.length) return (await evaluate(`(${functionSource})([])`)) as Result;
  const objectGroup = `stagehand-shadow-query-${crypto.randomUUID()}`;
  try {
    const objects: Array<{ objectId: string }> = [];
    for (const backendNodeId of closedIds) {
      const { object } = await session.send<Protocol.DOM.ResolveNodeResponse>("DOM.resolveNode", {
        backendNodeId,
        objectGroup,
      });
      if (!object.objectId) throw new Error("Closed shadow root is no longer available");
      objects.push({ objectId: object.objectId });
    }
    const response = await session.send<Protocol.Runtime.CallFunctionOnResponse>(
      "Runtime.callFunctionOn",
      {
        objectId: objects[0]!.objectId,
        functionDeclaration: `function(...roots) { return (${functionSource})(roots); }`,
        arguments: objects,
        awaitPromise: true,
        returnByValue: true,
      },
    );
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.text);
    return response.result.value as Result;
  } finally {
    await session.send("Runtime.releaseObjectGroup", { objectGroup });
  }
}
