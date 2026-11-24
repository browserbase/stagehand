import type { LocatorQuerySelector } from "@browserbasehq/stagehand-protocol/types";
import { queryAll } from "./queryAll.js";

export type FrameChainMatch = { id: number; isFrame: boolean };

/** Operation-owned DOM identities, retained by one remote object per document. */
export function createFrameChainScope() {
  const nodes: (Document | Element)[] = [document];
  const ids = new Map<Document | Element, number>([[document, 0]]);
  return {
    query(selector: LocatorQuerySelector, scopes: number[]): FrameChainMatch[][] {
      const shadowPresence = new Map<Document, boolean>();
      // Keep each scope's results separate so the caller can interleave results
      // from other documents before deduplication and positional selection.
      return scopes.map((scopeId) => {
        const scope = nodes[scopeId];
        if (!scope) throw new Error("Unknown chain scope");
        return queryAll(selector, [scope], shadowPresence)
          .filter((node) => node instanceof Element)
          .map((node) => {
            let id = ids.get(node);
            if (id === undefined) {
              id = nodes.length;
              nodes.push(node);
              ids.set(node, id);
            }
            return { id, isFrame: /^(iframe|frame)$/i.test(node.localName) };
          });
      });
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
