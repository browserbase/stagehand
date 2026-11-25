import { queryAll } from "./queryAll.js";

export function captureRoleCandidates(scopes: (Document | Element)[]) {
  if (scopes.some((scope) => !scope.isConnected)) return null;
  const groups = scopes.map((scope) => queryAll({ kind: "css", value: "*" }, [scope]));
  const candidates = [...new Set(groups.flat())];
  return {
    candidates,
    finish(indices: number[]): Element[][] {
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
  };
}
