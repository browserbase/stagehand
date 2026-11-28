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

    try {
      const { result } = await session.send<{ result: { value?: string } }>(
        "Runtime.callFunctionOn",
        {
          objectId,
          functionDeclaration: nodeToAbsoluteXPath.toString(),
          returnByValue: true,
        },
      );
      return typeof result?.value === "string" && result.value ? result.value : null;
    } finally {
      await session.send("Runtime.releaseObject", { objectId }).catch(() => {});
    }
  } catch {
    return null;
  }
}

export function prefixXPath(parentAbs: string, child: string): string {
  const pNorm = normalizeXPath(parentAbs);
  const p = pNorm === "/" ? "" : pNorm;
  const cNorm = normalizeXPath(child);
  if (!cNorm || cNorm === "/") return p || "/";
  if (cNorm.startsWith("//")) {
    const rest = cNorm.slice(2);
    if (!p) return `//${rest}`;
    return p.endsWith("//") ? `${p}${rest}` : `${p}//${rest}`;
  }
  const c = cNorm.slice(1);
  if (!p) return `/${c}`;
  return p.endsWith("//") ? `${p}${c}` : `${p}/${c}`;
}

export function normalizeXPath(x?: string): string {
  if (!x) return "";
  let s = x
    .trim()
    .replace(/^xpath=/i, "")
    .trim();
  if (!s) return "";
  if (!s.startsWith("/")) s = "/" + s;
  s = s.replace(/^\/{3,}/, "//");
  if (s.endsWith("///")) {
    s = s.replace(/\/{3,}$/, "//");
  } else if (s.length > 1 && s.endsWith("/") && !s.endsWith("//")) {
    s = s.slice(0, -1);
  }
  return s;
}

function toXPathStringLiteral(value: string): string {
  if (!value.includes("'")) return `'${value}'`;
  if (!value.includes('"')) return `"${value}"`;
  const parts = value.split("'").map((part) => `'${part}'`);
  return `concat(${parts.join(',"\'",')})`;
}

export function buildChildXPathSegments(kids: Protocol.DOM.Node[]): string[] {
  const segs: string[] = [];
  const ctr = new Map<string, number>();
  for (const child of kids) {
    const tag = String(child.nodeName).toLowerCase();
    const key = `${child.nodeType}:${tag}`;
    const idx = (ctr.get(key) ?? 0) + 1;
    ctr.set(key, idx);
    if (child.nodeType === 3) {
      segs.push(`text()[${idx}]`);
    } else if (child.nodeType === 8) {
      segs.push(`comment()[${idx}]`);
    } else {
      segs.push(
        tag.includes(":") ? `*[name()=${toXPathStringLiteral(tag)}][${idx}]` : `${tag}[${idx}]`,
      );
    }
  }
  return segs;
}

export function joinXPath(base: string, step: string): string {
  const normalizedBase = base ? normalizeXPath(base) : "";
  if (step === "//") {
    if (!normalizedBase || normalizedBase === "/") return "//";
    return normalizedBase.endsWith("//") ? normalizedBase : `${normalizedBase}//`;
  }
  const cleanStep = step.replace(/^\/+/, "");
  if (!normalizedBase || normalizedBase === "/") return cleanStep ? `/${cleanStep}` : "/";
  if (!cleanStep) return normalizedBase;
  if (normalizedBase.endsWith("//")) return `${normalizedBase}${cleanStep}`;
  return `${normalizedBase}/${cleanStep}`;
}
