import { startsWithHover } from "./hover.js";
import type { ActionSnapshot } from "./actionPlans.js";
import {
  headingLevel,
  isNativeElementPath,
  normalizeHeading,
  visibleNativeHeading,
} from "./nativeHeading.js";
import type { OutlineNode } from "./tree.js";

const LANDMARK = /\/(?:nav|aside|footer)(?:\[\d+\])?(?:\/|$)/u;
const SECTION_REQUEST =
  /^(?:click|open|press|tap|hover(?: over)?)\s+(?:.+\blink\s+(?:in|under)\s+(.+?)|.+\s+(?:in|under)\s+(.+? section))[.!]?$/iu;
const TITLE_REQUEST = /^(?:click|open|press|tap|find)\b.*\btitle links?\b/iu;

export type StructuralEvidence =
  | { inSection: boolean; section: string }
  | { title_link: true; title?: string };

type Context = (node: OutlineNode) => StructuralEvidence | undefined;

function frameOf(id: string) {
  return id.slice(0, id.indexOf("-"));
}

function visibleHeading(snapshot: ActionSnapshot, node: OutlineNode) {
  return visibleNativeHeading(snapshot.xpathMap[node.id], snapshot.facts[node.id], node.name);
}

function sectionContext(
  snapshot: ActionSnapshot,
  nodes: OutlineNode[],
  requested: string,
): Context | undefined {
  const name = normalizeHeading(requested)
    .replace(/^the\s+/u, "")
    .replace(/\s+section$/u, "")
    .replace(/^["“]|["”]$/gu, "");
  if (!name) return;
  const matches = nodes.filter(
    (node) => node.role === "heading" && normalizeHeading(node.name) === name,
  );
  const heading = matches[0];
  if (matches.length !== 1 || !heading) return;
  const dom = visibleHeading(snapshot, heading);
  if (!dom) return;

  const frame = frameOf(heading.id);
  const parent = dom.path.slice(0, dom.path.lastIndexOf("/"));
  const entries = Object.entries(snapshot.xpathMap).filter(([id]) => frameOf(id) === frame);
  const start = entries.findIndex(([id]) => id === heading.id);
  const members = new Set<string>();
  // The DOM map is in traversal order. XPath indices alone cannot order unlike siblings.
  for (let i = start + 1; i < entries.length; i++) {
    const [id, path] = entries[i]!;
    if (!path.startsWith(`${parent}/`)) break;
    const relative = path.slice(parent.length);
    const level = relative.indexOf("/", 1) === -1 ? headingLevel(relative) : undefined;
    if (level !== undefined && level <= dom.level) break;
    if (!LANDMARK.test(relative)) members.add(id);
  }
  return (node) => {
    const path = snapshot.xpathMap[node.id];
    if (node.role !== "link" || !isNativeElementPath(path)) return;
    return { inSection: members.has(node.id), section: heading.name };
  };
}

export function actionContext(
  snapshot: ActionSnapshot,
  nodes: OutlineNode[],
  instruction: string,
): Context | undefined {
  const match = SECTION_REQUEST.exec(instruction.trim());
  const request = match?.[1] ?? match?.[2];
  if (request) {
    const section = sectionContext(snapshot, nodes, request);
    if (section) return section;
    if (startsWithHover(instruction)) return () => undefined;
  }

  const unquoted = instruction.replace(/"[^"]*"|“[^”]*”/gu, "");
  if (!TITLE_REQUEST.test(unquoted.trim())) return;
  const headings = new Map<string, string[]>();
  for (const node of nodes) {
    if (node.role !== "heading") continue;
    const heading = visibleHeading(snapshot, node);
    if (!heading) continue;
    const frame = frameOf(node.id);
    const paths = headings.get(frame) ?? [];
    paths.push(heading.path);
    headings.set(frame, paths);
  }
  if (!headings.size) return;
  return (node) => {
    const path = snapshot.xpathMap[node.id];
    const fact = snapshot.facts[node.id];
    if (node.role !== "link" || fact?.tag !== "a" || !isNativeElementPath(path)) return;
    if (
      !headings
        .get(frameOf(node.id))
        ?.some((heading) => path.startsWith(`${heading}/`) || heading.startsWith(`${path}/`))
    ) {
      return;
    }
    return {
      title_link: true,
      ...(fact.title && fact.title !== node.name ? { title: fact.title.slice(0, 160) } : {}),
    };
  };
}
