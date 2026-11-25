import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "../../cdp.js";
import { nodeToAbsoluteXPath } from "../../../dom/a11yScripts/index.js";

export async function buildAbsoluteXPathFromChain(
  chain: Array<{
    parentSession: CDPSessionLike;
    iframeBackendNodeId: number;
  }>,
  leafSession: CDPSessionLike,
  leafBackendNodeId: number,
): Promise<string | null> {
  let prefix = "";
  for (const step of chain) {
    const xp = await absoluteXPathForBackendNode(step.parentSession, step.iframeBackendNodeId);
    if (!xp) continue;
    prefix = prefix ? prefixXPath(prefix, xp) : normalizeXPath(xp);
  }
  const leaf = await absoluteXPathForBackendNode(leafSession, leafBackendNodeId);
  if (!leaf) return prefix || "/";
  return prefix ? prefixXPath(prefix, leaf) : normalizeXPath(leaf);
}

export async function absoluteXPathForBackendNode(
  session: CDPSessionLike,
  backendNodeId: number,
): Promise<string | null> {
  try {
    const { object } = await session.send<{ object: { objectId?: string } }>("DOM.resolveNode", {
      backendNodeId,
    });
    const objectId = object?.objectId;
    if (!objectId) return null;

    const { result } = await session.send<{ result: { value?: string } }>(
      "Runtime.callFunctionOn",
      {
        objectId,
        functionDeclaration: nodeToAbsoluteXPath.toString(),
        returnByValue: true,
      },
    );
    await session.send("Runtime.releaseObject", { objectId }).catch(() => {});
    return typeof result?.value === "string" && result.value ? result.value : null;
  } catch {
    return null;
  }
}

export function prefixXPath(parentAbs: string, child: string): string {
  const p = parentAbs === "/" ? "" : parentAbs.replace(/\/$/, "");
  if (!child || child === "/") return p || "/";
  if (child.startsWith("//")) return p ? `${p}//${child.slice(2)}` : `//${child.slice(2)}`;
  const c = child.replace(/^\//, "");
  return p ? `${p}/${c}` : `/${c}`;
}

export function normalizeXPath(x?: string): string {
  if (!x) return "";
  let s = x.trim().replace(/^xpath=/i, "");
  if (!s.startsWith("/")) s = "/" + s;
  if (s.length > 1 && s.endsWith("/")) s = s.slice(0, -1);
  return s;
}

export function buildChildXPathSegments(kids: Protocol.DOM.Node[]): string[] {
  const segs: string[] = [];
  const ctr: Record<string, number> = {};
  for (const child of kids) {
    const tag = String(child.nodeName).toLowerCase();
    const key = `${child.nodeType}:${tag}`;
    const idx = (ctr[key] = (ctr[key] ?? 0) + 1);
    if (child.nodeType === 3) {
      segs.push(`text()[${idx}]`);
    } else if (child.nodeType === 8) {
      segs.push(`comment()[${idx}]`);
    } else {
      segs.push(tag.includes(":") ? `*[name()='${tag}'][${idx}]` : `${tag}[${idx}]`);
    }
  }
  return segs;
}

export function joinXPath(base: string, step: string): string {
  if (step === "//") {
    if (!base || base === "/") return "//";
    return base.endsWith("/") ? `${base}/` : `${base}//`;
  }
  if (!base || base === "/") return step ? `/${step}` : "/";
  if (base.endsWith("//")) return `${base}${step}`;
  if (!step) return base;
  return `${base}/${step}`;
}
