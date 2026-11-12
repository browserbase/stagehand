import type { Protocol } from "devtools-protocol";
import type { Frame } from "../frame.js";
import type { Page } from "../page.js";
import type { ChainTarget } from "../locatorChain.js";
import type { Progress } from "../progress.js";
import { executionContexts } from "../executionContextRegistry.js";
import { resolveContentFrame } from "../frameLocator.js";
import type { ApcQueryResult } from "./query.js";
import type { ApcTarget } from "./targets.js";

/** Document scopes stay in one frame; element scopes exclude the root itself. */
export type ApcScope =
  | { type: "document"; frame: Frame }
  | { type: "element"; target: ChainTarget }
  | { type: "frame"; target: ChainTarget };

/** Union roots by DOM identity, retaining capture order rather than scope order. */
export async function scopeAnnotatedPageContent(
  page: Page,
  query: ApcQueryResult,
  scopes: readonly ApcScope[],
  progress: Progress,
): Promise<ApcQueryResult> {
  const documents = new Set<string>();
  const elements = new Map<string, { frame: Frame; roots: Set<number> }>();
  for (const scope of scopes) {
    progress.throwIfStopped();
    if (scope.type === "document") {
      documents.add(scope.frame.frameId);
    } else if (scope.type === "frame") {
      const frame = await resolveContentFrame(
        page,
        scope.target.frame,
        scope.target.backendNodeId,
        progress,
      );
      documents.add(frame.frameId);
    } else {
      const { frame, backendNodeId } = scope.target;
      let group = elements.get(frame.frameId);
      if (!group) {
        group = { frame, roots: new Set() };
        elements.set(frame.frameId, group);
      }
      group.roots.add(backendNodeId);
    }
  }

  const included = new Set<string>();
  const candidates = new Map<string, ApcTarget[]>();
  for (const target of query.targetsById.values()) {
    progress.throwIfStopped();
    if (documents.has(target.frame.frameId)) included.add(target.id);
    else if (elements.has(target.frame.frameId)) {
      const group = candidates.get(target.frame.frameId) ?? [];
      group.push(target);
      candidates.set(target.frame.frameId, group);
    }
  }
  for (const [frameId, targets] of candidates) {
    const { frame, roots } = elements.get(frameId)!;
    for (const id of await findDescendants(frame, [...roots], targets, progress)) included.add(id);
  }

  const seen = new Set<string>();
  const targetsById = new Map<string, ApcTarget>();
  const nodes = query.nodes.filter((node) => {
    progress.throwIfStopped();
    const target = node.id === undefined ? undefined : query.targetsById.get(node.id);
    if (!target || !included.has(target.id)) return false;
    const identity = target.frame.frameId + ":" + target.backendNodeId;
    if (seen.has(identity)) return false;
    seen.add(identity);
    targetsById.set(target.id, target);
    return true;
  });
  return { ...query, nodes, targetsById };
}

/** Check actual DOM ancestry, crossing shadow roots but never frame documents. */
async function findDescendants(
  frame: Frame,
  roots: readonly number[],
  targets: readonly ApcTarget[],
  progress: Progress,
): Promise<string[]> {
  const { contextId } = await executionContexts.waitForLocatorWorld(
    frame.session,
    frame.frameId,
    1000,
    progress,
  );
  const release = (objectId: string) =>
    frame.session.send("Runtime.releaseObject", { objectId }).catch(() => {});
  const resolve = async (backendNodeId: number, owned: string[]) => {
    const { object } = await progress.run(
      "resolving APC scope node",
      () =>
        frame.session.send<Protocol.DOM.ResolveNodeResponse>("DOM.resolveNode", {
          backendNodeId,
          executionContextId: contextId,
        }),
      (late) => (late.object.objectId ? release(late.object.objectId) : undefined),
    );
    if (!object.objectId) throw new Error("APC scope node is no longer attached");
    owned.push(object.objectId);
    return { objectId: object.objectId };
  };
  const rootHandles: string[] = [];
  const included: string[] = [];
  try {
    const rootArguments: Protocol.Runtime.CallArgument[] = [];
    for (const root of roots) rootArguments.push(await resolve(root, rootHandles));
    // Bound remote handle lifetime and the size of each CDP call.
    for (let start = 0; start < targets.length; start += 128) {
      const batch = targets.slice(start, start + 128);
      const handles: string[] = [];
      try {
        const args = [...rootArguments];
        for (const target of batch) args.push(await resolve(target.backendNodeId, handles));
        const response = await progress.run("checking APC scope ancestry", () =>
          frame.session.send<Protocol.Runtime.CallFunctionOnResponse>("Runtime.callFunctionOn", {
            executionContextId: contextId,
            functionDeclaration: `function(rootCount, ...nodes) {
              const roots = new Set(nodes.slice(0, rootCount));
              for (const root of roots) {
                if (!root.isConnected || root.nodeType !== Node.ELEMENT_NODE)
                  throw new Error("APC element scope is no longer attached");
              }
              return nodes.slice(rootCount).map(node => {
                if (!node.isConnected) return false;
                for (let parent = node.parentNode; parent;
                     parent = parent.parentNode || (parent instanceof ShadowRoot ? parent.host : null)) {
                  if (roots.has(parent)) return true;
                }
                return false;
              });
            }`,
            arguments: [{ value: roots.length }, ...args],
            returnByValue: true,
          }),
        );
        if (response.exceptionDetails) {
          throw new Error(
            response.exceptionDetails.exception?.description ?? response.exceptionDetails.text,
          );
        }
        const matches = response.result.value as boolean[];
        for (let index = 0; index < batch.length; index++) {
          if (matches[index]) included.push(batch[index]!.id);
        }
      } finally {
        await progress.cleanup(() => Promise.all(handles.map(release)));
      }
    }
    progress.throwIfStopped();
    return included;
  } finally {
    await progress.cleanup(() => Promise.all(rootHandles.map(release)));
  }
}
