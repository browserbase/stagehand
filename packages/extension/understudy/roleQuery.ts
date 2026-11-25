import type { Protocol } from "devtools-protocol";
import { createTextMatcher } from "../dom/locatorScripts/textQuery.js";
import type { CDPSessionLike } from "./cdp.js";
import type { Progress } from "./progress.js";

type ToggleState = boolean | "mixed";

export type NativeRoleQuery = {
  role: string;
  name?: string;
  exact?: boolean;
  checked?: ToggleState;
  pressed?: ToggleState;
  selected?: boolean;
  expanded?: boolean;
  disabled?: boolean;
  level?: number;
};

const stateNames = ["checked", "pressed", "selected", "expanded", "disabled", "level"] as const;
type StateName = (typeof stateNames)[number];

function readState(
  node: Protocol.Accessibility.AXNode,
  name: StateName,
): boolean | "mixed" | number | undefined {
  const value: unknown = node.properties?.find((property) => property.name === name)?.value.value;
  if (name === "level") return typeof value === "number" ? value : undefined;
  if ((name === "checked" || name === "pressed") && value === "mixed") return "mixed";
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  // Chrome omits disabled for enabled controls. Other missing states are undefined,
  // so, for example, pressed:false must not match an ordinary non-toggle button.
  return name === "disabled" && value === undefined ? false : undefined;
}

/** Document-wide AX matches; the chain resolver must enforce DOM scope and order. */
export async function queryNativeRoles(
  session: CDPSessionLike,
  contextId: Protocol.Runtime.ExecutionContextId,
  query: NativeRoleQuery,
  progress: Progress,
): Promise<Protocol.Accessibility.AXNode[]> {
  progress.throwIfStopped();
  const matchesName =
    query.name === undefined ? undefined : createTextMatcher(query.name, query.exact);
  // Chromium versions can use either spelling for these equivalent ARIA roles.
  const nativeRoles =
    query.role === "img"
      ? ["img", "image"]
      : query.role === "directory"
        ? ["directory", "list"]
        : [query.role];
  const objectGroup = `stagehand-role-${crypto.randomUUID()}`;
  const release = () =>
    progress.cleanup(() => session.send("Runtime.releaseObjectGroup", { objectGroup }));
  let invalidated = false;
  let finishing = false;
  const destroyed = ({ executionContextId }: { executionContextId: number }) => {
    if (executionContextId === contextId) invalidated = true;
  };
  const cleared = () => {
    invalidated = true;
  };
  const check = () => {
    progress.throwIfStopped();
    if (invalidated) throw new Error("Role query execution context was destroyed");
  };
  session.on("Runtime.executionContextDestroyed", destroyed);
  session.on("Runtime.executionContextsCleared", cleared);
  try {
    const document = await progress.run(
      "reading role query document",
      async () => {
        try {
          return await session.send<Protocol.Runtime.EvaluateResponse>("Runtime.evaluate", {
            expression: "document",
            contextId,
            objectGroup,
          });
        } catch (error) {
          // A late command can allocate handles even if it ultimately rejects.
          if (finishing) void release();
          throw error;
        }
      },
      release,
    );
    check();
    if (document.exceptionDetails) {
      throw new Error(
        document.exceptionDetails.exception?.description ?? document.exceptionDetails.text,
      );
    }
    if (!document.result.objectId) throw new Error("Missing role query document handle");
    const { nodes } = await progress.run("querying native accessible roles", () =>
      session.send<Protocol.Accessibility.QueryAXTreeResponse>("Accessibility.queryAXTree", {
        objectId: document.result.objectId,
        ...(nativeRoles.length === 1 ? { role: nativeRoles[0] } : {}),
        // Native accessibleName is literal equality, not our normalized matcher.
      }),
    );
    check();
    return nodes.filter(
      (node) =>
        !node.ignored &&
        node.backendDOMNodeId !== undefined &&
        nativeRoles.includes(node.role?.value) &&
        (!matchesName || matchesName(node.name?.value ?? "")) &&
        stateNames.every(
          (name) => query[name] === undefined || readState(node, name) === query[name],
        ),
    );
  } finally {
    finishing = true;
    session.off("Runtime.executionContextDestroyed", destroyed);
    session.off("Runtime.executionContextsCleared", cleared);
    await release();
    progress.throwIfStopped();
  }
}
