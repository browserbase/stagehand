import type {
  observationView,
  ObservationCandidate,
  ObservationSnapshot,
} from "./observeCandidates.js";
import {
  headingLevel,
  isNativeElementPath,
  normalizeHeading,
  visibleNativeHeading,
} from "./nativeHeading.js";
import { parseOutline, type OutlineNode } from "./outline.js";

const SECTION_REQUEST =
  /^find all (text )?links in the (?:"([^"\r\n]+)"|“([^“”\r\n]+)”|([^"“”\r\n]+)) section\.?$/iu;
const TAG = /\/([a-z][\w-]*)(?:\[\d+\])?$/u;
const CHROME = /\/(?:nav|aside|header|footer)(?:\[\d+\])?(?:\/|$)/u;
const LANDMARK = /^(?:navigation|complementary|banner|contentinfo)$/u;

type SectionRequest = { heading: string; textOnly: boolean };

export function parseObservationSection(
  instruction: string | undefined,
): SectionRequest | undefined {
  const match = SECTION_REQUEST.exec(instruction?.trim() ?? "");
  const heading = match?.[2] ?? match?.[3] ?? match?.[4];
  if (heading === undefined) return undefined;
  return { heading: normalizeHeading(heading), textOnly: Boolean(match?.[1]) };
}

function uniqueHeading(nodes: OutlineNode[], request: SectionRequest) {
  const matches = nodes.filter(
    (node) => node.role === "heading" && normalizeHeading(node.name) === request.heading,
  );
  return matches.length === 1 ? matches[0] : undefined;
}

export function sectionEvidenceIds(
  nodes: OutlineNode[],
  xpathMap: Record<string, string>,
  request: SectionRequest,
) {
  const heading = uniqueHeading(nodes, request);
  if (!heading || heading.parent === undefined) return [];
  const parent = nodes[heading.parent];
  if (!parent) return [];
  const parentPath = xpathMap[parent.id];
  if (!isNativeElementPath(parentPath)) return [];
  // Native headings and anchors may be omitted by AX. Verify their DOM facts so hidden
  // nodes and fragment markers cannot look like gaps in an otherwise complete section.
  return Object.entries(xpathMap)
    .filter(
      ([, path]) => path.startsWith(`${parentPath}/`) && /\/(?:a|h[1-6])(?:\[\d+\])?$/u.test(path),
    )
    .map(([id]) => id);
}

export function resolveObservationSection(
  snapshot: ObservationSnapshot,
  request: SectionRequest,
  view: ReturnType<typeof observationView>,
): ObservationCandidate[] | undefined {
  if (!request.heading || /%[^%\s]+%/u.test(request.heading) || view.unresolved.length)
    return undefined;

  const nodes = parseOutline(snapshot.formattedTree);
  const heading = uniqueHeading(nodes, request);
  if (!heading) return undefined;

  const { xpathMap, facts } = snapshot;
  const dom = visibleNativeHeading(xpathMap[heading.id], facts[heading.id], heading.name);
  if (!dom || CHROME.test(dom.path)) return undefined;
  const { path: headingPath, level } = dom;

  const parentPath = headingPath.slice(0, headingPath.lastIndexOf("/"));
  const parent = heading.parent === undefined ? undefined : nodes[heading.parent];
  if (!parent || xpathMap[parent.id] !== parentPath) return undefined;
  const outlineEnd =
    nodes.find((node) => node.index > heading.index && node.depth <= parent.depth)?.index ??
    nodes.length;

  // The DOM map is emitted in depth-first document order. Per-tag XPath indices cannot
  // order unlike siblings, and accessibility order can omit or reparent DOM nodes.
  const entries = Object.entries(xpathMap);
  const frame = heading.id.split("-")[0];
  const start = entries.findIndex(([id]) => id === heading.id);
  if (start < 0 || entries.some(([id]) => id.split("-")[0] !== frame)) return undefined;

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  if (nodesById.size !== nodes.length) return undefined;
  const candidatesById = new Map(
    view.candidates.map((candidate) => [candidate.node.id, candidate]),
  );
  const links: ObservationCandidate[] = [];
  let previous = heading.index;
  for (let index = start + 1; index < entries.length; index++) {
    const [id, path] = entries[index]!;
    if (!path.startsWith(`${parentPath}/`)) break;
    if (CHROME.test(path)) continue;
    if (path.includes("//")) return undefined;

    const node = nodesById.get(id);
    const tag = TAG.exec(path)?.[1] ?? "";
    if (tag === "iframe" || tag === "frame" || LANDMARK.test(node?.role ?? "")) return undefined;
    const boundaryLevel = headingLevel(path);
    if (boundaryLevel || node?.role === "heading") {
      const boundary = facts[id];
      if (boundary?.visible === false) continue;
      if (!boundary || boundary.tag !== tag || !boundaryLevel || node?.role !== "heading")
        return undefined;
      if (node.index <= previous || node.index >= outlineEnd) return undefined;
      if (boundaryLevel <= level) {
        // A heading inside another container may label links that precede the heading.
        if (path.slice(0, path.lastIndexOf("/")) !== parentPath) return undefined;
        break;
      }
      previous = node.index;
      continue;
    }
    if (tag !== "a" && node?.role !== "link") continue;

    const link = facts[id];
    // Empty title anchors without an AX node or URL can be fragment markers.
    if (
      path.startsWith(`${headingPath}/`) &&
      !node &&
      !link &&
      !snapshot.urlMap[id] &&
      !entries[index + 1]?.[1].startsWith(`${path}/`)
    )
      continue;
    if (link?.visible === false || (link?.tag === "a" && !link.href && node?.role !== "link"))
      continue;
    const candidate = candidatesById.get(id);
    if (
      !candidate ||
      !isNativeElementPath(path) ||
      candidate.fact.tag !== "a" ||
      !candidate.fact.href ||
      node?.role !== "link" ||
      node.index <= previous ||
      node.index >= outlineEnd
    )
      return undefined;
    previous = node.index;
    if (request.textOnly) {
      if (!candidate.fact.text.trim()) continue;
      // textContent on a mixed-content anchor can include visually hidden labels.
      for (let child = index + 1; child < entries.length; child++) {
        const childPath = entries[child]?.[1];
        if (!childPath?.startsWith(`${path}/`)) break;
        if (isNativeElementPath(childPath)) return undefined;
      }
    }
    links.push(candidate);
  }
  return links.length ? links : undefined;
}
