import { queryAll } from "./queryAll.js";
import { getOpenOrClosedShadowRoot } from "./shadowRoots.js";

function documentRoots(): (Document | ShadowRoot)[] {
  return [
    document,
    ...queryAll({ kind: "css", value: "*" })
      .map(getOpenOrClosedShadowRoot)
      .filter((root): root is ShadowRoot => root !== null),
  ];
}

/** Retain real elements while Chrome computes AX data, including out-of-scope naming evidence. */
export function captureRoleCandidates(scopes: (Document | Element)[]) {
  const roots = documentRoots();
  let changed = false;
  const observer = new MutationObserver(() => {
    changed = true;
  });
  for (const root of roots) {
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
  }
  try {
    const groups = scopes.map((scope) => {
      if (!scope.isConnected) throw new Error("Role query scope detached");
      return queryAll({ kind: "css", value: "*" }, [scope]);
    });
    const candidates = [...new Set(groups.flat())];
    return {
      candidates,
      finish(indices: number[]): Element[][] | null {
        // attachShadow itself emits no mutation record. Compare roots as well.
        const currentRoots = documentRoots();
        if (
          changed ||
          observer.takeRecords().length ||
          currentRoots.length !== roots.length ||
          currentRoots.some((root, index) => root !== roots[index])
        )
          return null;
        const selected = new Set(
          indices.map((index) => {
            if (!Number.isSafeInteger(index) || index < 0 || index >= candidates.length) {
              throw new Error("Invalid role candidate index");
            }
            return candidates[index];
          }),
        );
        return groups.map((group) => group.filter((element) => selected.has(element)));
      },
      dispose() {
        observer.disconnect();
      },
    };
  } catch (error) {
    observer.disconnect();
    throw error;
  }
}
