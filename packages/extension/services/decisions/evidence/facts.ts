import type { Fact } from "../dataView.js";
import type { OutlineNode } from "../outline.js";
import { INLINE_ROLES, lower, named, type OutlineIndex } from "./outlineIndex.js";
import { clip } from "./slots.js";

export function collectFacts(
  {
    nodes,
    children,
    numericNodes,
    descendants,
    inlineText,
    textOf,
    tableHeader,
    headingBefore,
  }: OutlineIndex,
  urlMap: Record<string, string>,
): Fact[] {
  const facts: Fact[] = [];
  const LABEL_ROLES = new Set([
    "heading",
    "labeltext",
    "term",
    "strong",
    "columnheader",
    "rowheader",
    "caption",
    "legend",
    "sectionheader",
  ]);
  const usableLabel = (node: OutlineNode, text: string) =>
    /\p{L}/u.test(text) &&
    (!/^(link|button|listmarker)$/.test(lower(node)) || text.endsWith(":")) &&
    text.length <= 90 &&
    !/[$€£¥]|\d{3,}/.test(text) &&
    (LABEL_ROLES.has(lower(node)) || text.endsWith(":") || text.length <= 60);
  const sectionLabel = (node: OutlineNode): string => {
    let current: OutlineNode | undefined = node;
    for (let hops = 0; current && hops < 4; hops++) {
      const parent: OutlineNode | undefined =
        current.parent === undefined ? undefined : nodes[current.parent];
      if (!parent) break;
      const siblings = children[parent.index]!;
      const previous = siblings[siblings.indexOf(current.index) - 1];
      if (previous !== undefined) {
        const text = (inlineText(nodes[previous]!) ?? textOf(nodes[previous]!)).trim();
        if (usableLabel(nodes[previous]!, text) && !text.includes(node.name || "\u0000"))
          return text;
      }
      current = parent;
    }
    return "";
  };
  for (const node of nodes) {
    const kids = descendants(node);
    const namedKids = kids.filter(named);
    const run = inlineText(node, 1500);
    const inline = run !== undefined;
    if (!named(node) && !inline) continue;
    // A heading can expose its number and title as separate text descendants.
    const splitHeading =
      lower(node) === "heading" &&
      namedKids.length > 1 &&
      kids.every((kid) => INLINE_ROLES.has(lower(kid)) && (lower(kid) !== "link" || named(kid))) &&
      !namedKids.some((kid) => kid.name === node.name);
    const leafish =
      inline ||
      namedKids.length === 0 ||
      numericNodes.has(node.index) ||
      splitHeading ||
      ["cell", "link", "gridcell"].includes(lower(node));
    if (!leafish || node.name.length > 1500) continue;
    const value = run ?? node.name;
    if (value.trim().endsWith(":")) continue;
    if (!inline && /statictext|strong|emphasis/.test(lower(node))) {
      let parent = node.parent === undefined ? undefined : nodes[node.parent];
      while (parent && INLINE_ROLES.has(lower(parent)) && !named(parent))
        parent = parent.parent === undefined ? undefined : nodes[parent.parent];
      if (parent && inlineText(parent, 1500)) continue;
    }
    const labels: string[] = [];
    const heading = lower(node) === "heading" ? "" : headingBefore(node);
    if (heading && heading !== value) labels.push(heading);
    const row = ancestor(node, "row");
    if (row) {
      const first = children[row.index]!.map((i) => nodes[i]!).find((cell) => textOf(cell));
      const rowLabel = first ? textOf(first) : "";
      if (rowLabel && rowLabel !== value && !value.startsWith(rowLabel))
        labels.push(clip(rowLabel, 60));
      const cell = ancestorOrSelf(node, /cell|columnheader|rowheader/);
      if (cell) {
        const position =
          children[row.index]!.filter((i) =>
            /cell|columnheader|rowheader/.test(lower(nodes[i]!)),
          ).indexOf(cell.index) + 1;
        const column = tableHeader(row).get(`pos${position}`);
        if (column && column !== value) labels.push(column);
        if (lower(cell) === "columnheader") continue;
      }
    }
    const section = sectionLabel(node);
    if (section && section !== value) labels.push(section);
    const fact: Fact = {
      id: node.id,
      node,
      value,
      label: [...new Set(labels)].join(" › "),
      url: urlMap[node.id],
      chrome: insideChrome(node),
    };
    facts.push(fact);
    if (splitHeading) {
      // A trailing permalink glyph can also be part of the accessible name.
      const lastChild = children[node.index]!.at(-1);
      const link = lastChild === undefined ? undefined : nodes[lastChild];
      if (
        link &&
        lower(link) === "link" &&
        urlMap[link.id]?.includes("#") &&
        link.name &&
        !/[\p{L}\p{N}]/u.test(link.name) &&
        value.endsWith(link.name)
      ) {
        const title = value.slice(0, -link.name.length).trimEnd();
        if (title && !namedKids.some((kid) => kid.name === title))
          facts.push({ ...fact, value: title });
      }
    }
  }

  return facts;

  function insideChrome(node: OutlineNode): boolean {
    let current: OutlineNode | undefined = node;
    while (current) {
      if (
        /^(navigation|banner|contentinfo|menubar|menu|listbox|combobox|menulistpopup|select)$/.test(
          lower(current),
        )
      )
        return true;
      current = current.parent === undefined ? undefined : nodes[current.parent];
    }
    return false;
  }
  function ancestor(node: OutlineNode, role: string): OutlineNode | undefined {
    let current = node.parent === undefined ? undefined : nodes[node.parent];
    while (current && lower(current) !== role)
      current = current.parent === undefined ? undefined : nodes[current.parent];
    return current;
  }
  function ancestorOrSelf(node: OutlineNode, role: RegExp): OutlineNode | undefined {
    let current: OutlineNode | undefined = node;
    while (current && !role.test(lower(current)))
      current = current.parent === undefined ? undefined : nodes[current.parent];
    return current;
  }
}
