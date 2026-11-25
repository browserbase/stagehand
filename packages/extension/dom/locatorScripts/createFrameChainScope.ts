import type {
  LocatorFilterStep,
  LocatorQuerySelector,
} from "@browserbasehq/stagehand-protocol/types";
import { queryAll } from "./queryAll.js";
import { captureRoleCandidates } from "./roleCandidates.js";
import { filterTextMatches } from "./textQuery.js";

export type FrameChainMatch = { id: number; isFrame: boolean };

export function createFrameChainScope() {
  const nodes: (Document | Element)[] = [document];
  const ids = new Map<Document | Element, number>([[document, 0]]);
  let roleCapture: ReturnType<typeof captureRoleCandidates> | undefined;
  const scopeFor = (id: number) => {
    const scope = nodes[id];
    if (!scope) throw new Error("Unknown chain scope");
    return scope;
  };
  const register = (node: Element): FrameChainMatch => {
    let id = ids.get(node);
    if (id === undefined) {
      id = nodes.length;
      nodes.push(node);
      ids.set(node, id);
    }
    return { id, isFrame: /^(iframe|frame)$/i.test(node.localName) };
  };
  return {
    query(selector: LocatorQuerySelector, scopes: number[]): FrameChainMatch[][] {
      if (selector.kind === "role")
        throw new Error("Role queries require native accessibility resolution");
      const shadowPresence = new Map<Document, boolean>();
      return scopes.map((scopeId) =>
        queryAll(selector, [scopeFor(scopeId)], shadowPresence)
          .filter((node) => node instanceof Element)
          .map(register),
      );
    },
    filter(options: LocatorFilterStep, selected: number[]): number[] {
      return filterTextMatches(this.elements(selected), options).map((node) => ids.get(node)!);
    },
    roleCandidates(scopes: number[]): Element[] | null {
      roleCapture = captureRoleCandidates(scopes.map(scopeFor));
      return roleCapture?.candidates ?? null;
    },
    roleMatches(indices: number[]): FrameChainMatch[][] {
      if (!roleCapture) throw new Error("No pending role query");
      try {
        return roleCapture.finish(indices).map((group) => group.map(register));
      } finally {
        roleCapture = undefined;
      }
    },
    elements(selected: number[]): Element[] {
      return selected.map((id) => {
        const node = nodes[id];
        if (!(node instanceof Element)) throw new Error("Chain target is not an element");
        if (/^(iframe|frame)$/i.test(node.localName) && !node.isConnected) {
          throw new Error("Chain iframe detached before entry");
        }
        return node;
      });
    },
  };
}
