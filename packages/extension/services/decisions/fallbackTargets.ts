import type { HybridSnapshot } from "../../types/private/snapshot.js";
import type { Page } from "../../understudy/page.js";
import type { Progress } from "../../understudy/progress.js";
import { trimTrailingTextNode } from "../../utils.js";
import { readFacts, type ElementFacts } from "./actionFacts.js";

export function fallbackTargets(
  outline: string,
  snapshot: HybridSnapshot,
  page: Page,
  progress: Progress,
) {
  const paths = snapshot.combinedXpathMap;
  const offeredPaths: Record<string, string> = {};
  const physicalIds = new Map<string, string>();
  const textChildren = new Map<string, string[]>();
  for (const row of outline.matchAll(/^ *\[(\d+-\d+)\] /gmu)) {
    const id = row[1]!;
    const path = paths[id];
    if (!path) continue;
    const parent = trimTrailingTextNode(path);
    if (parent === path) {
      offeredPaths[id] = path;
      physicalIds.set(id, id);
    } else if (parent) {
      // The physical parent can be absent from the AX tree. Iframe roots can
      // share an absolute XPath with the iframe host in its parent document.
      const key = id.split("-")[0] + ":" + parent;
      const children = textChildren.get(key) ?? [];
      children.push(id);
      textChildren.set(key, children);
    }
  }
  if (textChildren.size) {
    for (const [parentId, path] of Object.entries(paths)) {
      const key = parentId.split("-")[0] + ":" + path;
      const children = textChildren.get(key);
      if (!children) continue;
      for (const id of children) {
        physicalIds.set(id, parentId);
        offeredPaths[id] = paths[id]!;
      }
      textChildren.delete(key);
      if (!textChildren.size) break;
    }
  }

  async function read(ids: Iterable<string>): Promise<Record<string, ElementFacts>> {
    const selected = new Set(ids);
    if (!selected.size) return {};
    const groups = snapshot.perFrame;
    if (!groups)
      return page.evaluate(
        readFacts,
        Object.fromEntries([...selected].map((id) => [id, paths[id]!])),
      );
    const facts: Record<string, ElementFacts> = {};
    for (const group of groups) {
      const local: Record<string, string> = {};
      const deep: Record<string, string> = {};
      for (const id of selected) {
        const path = group.xpathMap[id];
        if (!path) continue;
        if (path.includes("//")) deep[id] = path;
        // A document can be offered for keyboard actions. Read its document
        // element for evidence and keep the document ID for dispatch.
        else local[id] = path === "/" ? "/*[1]" : path;
      }
      if (!Object.keys(local).length && !Object.keys(deep).length) continue;
      try {
        const frame = page.frameForId(group.frameId);
        if (Object.keys(local).length) {
          const result = await frame.evaluate(readFacts, local, progress);
          Object.assign(facts, result);
          // Native XPath misses some namespaced elements that the locator
          // world can resolve. Give them the same lookup used at dispatch.
          for (const [id, path] of Object.entries(local)) {
            if (!result[id]) deep[id] = path;
          }
        }
        if (Object.keys(deep).length) {
          const result = await frame.evaluateInLocatorWorld<Record<string, ElementFacts>>(
            () =>
              `(${readFacts.toString()})(${JSON.stringify(deep)}, globalThis.__stagehandLocatorScripts.resolveXPathMainWorld)`,
            progress,
          );
          Object.assign(facts, result);
        }
      } catch {
        progress.throwIfStopped();
        // A detached frame invalidates its own targets. Other frames can still be used.
      }
    }
    return facts;
  }
  return { offeredPaths, physicalIds, read };
}
