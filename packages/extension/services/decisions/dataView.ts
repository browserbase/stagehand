/**
 * A data view of an accessibility outline: repeated record groups with
 * aligned slots, and labelled facts. Stagehand builds it deterministically, so
 * a decision model only has to map schema fields onto slots or facts.
 */
import { parseOutline, type OutlineNode } from "./outline.js";

export type Slot = {
  key: string;
  label?: string;
  /** Share of records that have this slot. */
  coverage: number;
  samples: string[];
  link: boolean;
  urlSamples: string[];
};

export type Group = {
  id: string;
  role: string;
  records: OutlineNode[];
  /** Short text that precedes each record outside it, e.g. a category row or section heading. */
  context: string[];
  sections: string[];
  slots: Slot[];
};

export type Fact = {
  id: string;
  node: OutlineNode;
  value: string;
  label: string;
  url?: string;
  /** Inside navigation, banner, footer or a form control's option list. */
  chrome: boolean;
};

export type DataView = {
  /** Joined text of unnamed nodes made only of inline pieces, by node index. */
  runs: Map<number, string>;
  /** Rows that continue a record drawn over several sibling rows, by record index. */
  followers: Map<number, OutlineNode[]>;
  nodes: OutlineNode[];
  children: number[][];
  groups: Group[];
  facts: Fact[];
  urlMap: Record<string, string>;
};

const SKIP_ROLES = new Set(["rootwebarea", "scrollable, html", "html", "linebreak", "listmarker"]);
const CONTAINER_ROLES = new Set([
  "row",
  "listitem",
  "term",
  "article",
  "link",
  "section",
  "group",
  "div",
  "tbody",
  "layouttablerow",
  "layouttable",
  "li",
  "region",
  "figure",
  "generic",
]);

const lower = (node: OutlineNode) => node.role.toLowerCase();
const named = (node: OutlineNode) => node.name.trim().length > 0 && !SKIP_ROLES.has(lower(node));

/** Slot-key segment for the first item of a list inside a cell. */
export const FIRST_ITEM = "~first";

function subtree(nodes: OutlineNode[], root: OutlineNode): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (let i = root.index + 1; i < nodes.length && nodes[i]!.depth > root.depth; i++)
    out.push(nodes[i]!);
  return out;
}

/** The first named leaf under `root`, or `root` itself when it has none. */
function firstLeaf(nodes: OutlineNode[], root: OutlineNode): OutlineNode {
  return (
    subtree(nodes, root).find((node) => named(node) && !subtree(nodes, node).some(named)) ?? root
  );
}

export function buildDataView(tree: string, urlMap: Record<string, string>): DataView {
  const nodes = parseOutline(tree);
  const children: number[][] = nodes.map(() => []);
  for (const node of nodes) if (node.parent !== undefined) children[node.parent]!.push(node.index);

  const INLINE_ROLES = new Set([
    "statictext",
    "linebreak",
    "strong",
    "emphasis",
    "abbr",
    "time",
    "superscript",
    "subscript",
    "mark",
    "link",
    "listmarker",
  ]);
  /** Text of an unnamed node made only of inline pieces ("2", "tablespoons", "olive oil"). */
  const inlineText = (node: OutlineNode, max = 400): string | undefined => {
    if (node.name.trim()) return undefined;
    const kids = descendants(node);
    const pieces = kids.filter((kid) => named(kid) && lower(kid) !== "listmarker");
    if (pieces.length < 2 || !kids.every((kid) => INLINE_ROLES.has(lower(kid)))) return undefined;
    const direct = new Set(children[node.index]);
    const text = pieces
      .filter((kid) => direct.has(kid.index) || lower(nodes[kid.parent!]!) !== "link")
      .map((kid) => kid.name.trim())
      .join(" ")
      .replace(/\s+([,.;:)])/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    return text.length <= max ? text : undefined;
  };

  const descendants = (root: OutlineNode): OutlineNode[] => subtree(nodes, root);
  const firstItem = (root: OutlineNode): OutlineNode => firstLeaf(nodes, root);

  /** Path of role[ordinal] segments from `root` to `node`. */
  const slotKey = (root: OutlineNode, node: OutlineNode): string => {
    const segments: string[] = [];
    let current = node;
    while (current.index !== root.index) {
      const parent = nodes[current.parent!]!;
      const ordinal =
        children[parent.index]!.filter((i) => lower(nodes[i]!) === lower(current)).indexOf(
          current.index,
        ) + 1;
      segments.unshift(`${lower(current)}[${ordinal}]`);
      current = parent;
    }
    return segments.join("/") || ".";
  };

  const followers = new Map<number, OutlineNode[]>();
  const valuesOf = (record: OutlineNode): Map<string, OutlineNode> => {
    const values = ownValues(record);
    (followers.get(record.index) ?? []).forEach((follower, j) => {
      for (const [key, node] of ownValues(follower)) values.set(`+${j + 1}/${key}`, node);
    });
    return values;
  };
  const ownValues = (record: OutlineNode) => {
    const values = new Map<string, OutlineNode>();
    for (const node of [record, ...descendants(record)]) {
      if (!named(node)) {
        const run = inlineText(node);
        if (!run) continue;
        const key = slotKey(record, node);
        if (!values.has(key)) values.set(key, { ...node, name: run });
        continue;
      }
      const key = slotKey(record, node);
      if (!values.has(key)) values.set(key, node);
    }
    return values;
  };

  // Sibling groups: children of one parent sharing a role.
  const raw: { parent: OutlineNode; role: string; records: OutlineNode[] }[] = [];
  // A last row holding one card: it may only join a group merged across sections.
  const singles: typeof raw = [];
  for (const parent of nodes) {
    const byRole = new Map<string, OutlineNode[]>();
    for (const i of children[parent.index]!) {
      const child = nodes[i]!;
      if (!descendants(child).some(named) && !named(child)) continue;
      const list = byRole.get(lower(child)) ?? [];
      list.push(child);
      byRole.set(lower(child), list);
    }
    for (const [role, records] of byRole) {
      if (records.length >= 2 && (CONTAINER_ROLES.has(role) || records.length >= 5)) {
        raw.push({ parent, role, records });
      } else if (records.length === 1 && CONTAINER_ROLES.has(role)) {
        singles.push({ parent, role, records });
      }
    }
  }

  const headingBefore = (node: OutlineNode, lowerBound = 0): string => {
    for (let i = node.index - 1; i >= lowerBound; i--) {
      const candidate = nodes[i]!;
      if (lower(candidate) === "heading" && candidate.name && candidate.depth <= node.depth + 2)
        return candidate.name;
      if (/^table$/.test(lower(candidate)) && candidate.name) return candidate.name;
    }
    return "";
  };

  const slotKeys = new Map<OutlineNode[], Set<string>>();
  const getSlotKeys = (records: OutlineNode[]) => {
    const cached = slotKeys.get(records);
    if (cached) return cached;
    const keys = new Set(
      records.slice(0, 8).flatMap((record) =>
        descendants(record)
          .filter((node) => node.depth <= record.depth + 2)
          .map((node) => slotKey(record, node)),
      ),
    );
    slotKeys.set(records, keys);
    return keys;
  };

  // Description-list terms are records even when their labels have different markup.
  // Merge across sibling sections only when those sections share a parent.
  const descriptionScope = (parent: OutlineNode) => {
    const section = parent.parent === undefined ? undefined : nodes[parent.parent];
    return section && /^(region|section)$/.test(lower(section)) ? section.parent : undefined;
  };
  const descriptionLabel = (record: OutlineNode) => {
    if (lower(record) !== "term" || record.parent === undefined) return "";
    const list = nodes[record.parent]!;
    if (lower(list) !== "descriptionlist" || list.parent === undefined) return "";
    const definition = nodes[list.parent]!;
    if (lower(definition) !== "definition" || definition.parent === undefined) return "";
    const siblings = children[definition.parent]!;
    for (let i = siblings.indexOf(definition.index) - 1; i >= 0; i--) {
      const sibling = nodes[siblings[i]!]!;
      if (lower(sibling) === "term") return sibling.name;
      if (lower(sibling) !== "definition") break;
    }
    return "";
  };
  const canMerge = (left: (typeof raw)[number], right: (typeof raw)[number]) => {
    if (left.role !== right.role || lower(left.parent) !== lower(right.parent)) return false;
    if (left.role === "term" && lower(left.parent) === "descriptionlist") {
      const scope = descriptionScope(left.parent);
      return scope !== undefined && scope === descriptionScope(right.parent);
    }
    const keys = getSlotKeys(left.records);
    const otherKeys = getSlotKeys(right.records);
    const overlap = [...keys].filter((key) => otherKeys.has(key)).length;
    return overlap / Math.max(keys.size, otherKeys.size) >= 0.6;
  };

  // Merge groups of the same record role and slot shape that sit in different sections.
  const merged: {
    role: string;
    records: OutlineNode[];
    sections: string[];
    parts: OutlineNode[][];
  }[] = [];
  const used = new Set<number>();
  raw.forEach((group, i) => {
    if (used.has(i)) return;
    const parts = [group];
    raw.forEach((other, j) => {
      if (j <= i || used.has(j)) return;
      if (canMerge(group, other)) {
        parts.push(other);
        used.add(j);
      }
    });
    if (parts.length > 1 || (group.role === "term" && lower(group.parent) === "descriptionlist")) {
      const parents = new Set(parts.map((part) => part.parent.parent));
      for (const single of singles) {
        if (single.role !== group.role || lower(single.parent) !== lower(group.parent)) continue;
        const siblingDescription =
          group.role === "term" && lower(group.parent) === "descriptionlist";
        if ((siblingDescription || parents.has(single.parent.parent)) && canMerge(group, single))
          parts.push(single);
      }
    }
    if (parts.reduce((sum, part) => sum + part.records.length, 0) < 3) return;
    merged.push({
      role: group.role,
      records: parts.flatMap((part) => part.records).sort((a, b) => a.index - b.index),
      sections: parts.length > 1 ? parts.map((part) => headingBefore(part.parent)) : [],
      parts: parts.map((part) => part.records),
    });
  });

  const tableHeader = (record: OutlineNode): Map<string, string> => {
    const labels = new Map<string, string>();
    if (lower(record) !== "row") return labels;
    let table: OutlineNode | undefined = record;
    while (table && !/table|grid/.test(lower(table)))
      table = table.parent === undefined ? undefined : nodes[table.parent];
    if (!table) return labels;
    const rows = descendants(table).filter((node) => lower(node) === "row");
    let headerRow: OutlineNode | undefined;
    for (const row of rows) {
      const cells = children[row.index]!.map((i) => nodes[i]!);
      const isHeader =
        cells.some((cell) => lower(cell) === "columnheader" && cell.name) ||
        (row === rows[0] &&
          cells.length > 1 &&
          cells.some((cell) => textOf(cell).trim()) &&
          cells
            .filter((cell) => textOf(cell).trim())
            .every((cell) => descendants(cell).some((d) => lower(d) === "strong")));
      if (!isHeader) break;
      headerRow = row;
    }
    if (!headerRow) return labels;
    let ordinal = 0;
    for (const i of children[headerRow.index]!) {
      const cell = nodes[i]!;
      if (/cell|columnheader|rowheader/.test(lower(cell)))
        labels.set(`pos${++ordinal}`, cell.name || textOf(cell));
    }
    return labels;
  };

  const textOf = (node: OutlineNode): string =>
    node.name ||
    descendants(node)
      .filter(named)
      .map((d) => d.name)
      .join(" ");

  const isHeaderRecord = (record: OutlineNode) => {
    if (!/^(row|layouttablerow|tr)$/.test(lower(record))) return false;
    const cells = children[record.index]!.map((i) => nodes[i]!).filter(
      (n) => named(n) || descendants(n).some(named),
    );
    return (
      cells.length > 0 &&
      cells.every(
        (cell) =>
          lower(cell) === "columnheader" ||
          descendants(cell).some((d) => lower(d) === "strong") ||
          !textOf(cell),
      ) &&
      cells.some((cell) => textOf(cell))
    );
  };

  const inside = (outer: OutlineNode, inner: OutlineNode) =>
    inner.index > outer.index &&
    nodes.slice(outer.index + 1, inner.index + 1).every((n) => n.depth > outer.depth);
  const groups: Group[] = merged.map((group, index) => {
    let records = group.records;
    let labels = tableHeader(records[0]!);
    const headers = records.length > 2 ? records.filter(isHeaderRecord) : [];
    if (headers.length > 0 && headers.length < records.length / 2) {
      labels = new Map(
        children[headers[0]!.index]!.map((i) => nodes[i]!)
          .filter((cell) => /cell|columnheader|rowheader/.test(lower(cell)))
          .map((cell, position) => [`pos${position + 1}`, textOf(cell).trim()] as const),
      );
      records = records.filter((record) => !headers.includes(record));
    }
    // One item drawn over k sibling rows (a story's title row, then its points
    // row): fold each row's followers into it, keyed "+1/…".
    {
      const signature = (record: OutlineNode) =>
        children[record.index]!.map((i) => slotKey(record, nodes[i]!)).join(",");
      const sigs = records.map(signature);
      const agree = (k: number) => {
        let same = 0;
        for (let i = 0; i + k < sigs.length; i++) if (sigs[i] === sigs[i + k]) same++;
        return sigs.length > k ? same / (sigs.length - k) : 0;
      };
      const period = [2, 3].find(
        (k) => records.length >= 2 * k + 2 && agree(k) >= 0.85 && agree(1) <= 0.3,
      );
      if (period) {
        const leaders: OutlineNode[] = [];
        for (let i = 0; i < records.length; i += period) {
          leaders.push(records[i]!);
          followers.set(records[i]!.index, records.slice(i + 1, i + period));
        }
        records = leaders;
      }
    }
    // Records missing most of the common top-level slots are separators (a
    // category row between product rows): they label what follows instead.
    const separators = new Map<number, string>();
    {
      const values = records.map(valuesOf);
      const counts = new Map<string, number>();
      for (const v of values)
        for (const key of v.keys()) counts.set(key, (counts.get(key) ?? 0) + 1);
      const common = [...counts].filter(([, n]) => n / records.length >= 0.6).map(([key]) => key);
      if (/^(row|layouttablerow|tr)$/.test(group.role) && common.length >= 1) {
        records = records.filter((record, i) => {
          const share = common.filter((key) => values[i]!.has(key)).length / common.length;
          if (common.length >= 2 ? share >= 0.34 : share > 0) return true;
          separators.set(record.index, textOf(record).trim());
          return false;
        });
      }
    }
    const perRecord = records.map(valuesOf);
    const counts = new Map<string, number>();
    for (const values of perRecord)
      for (const key of values.keys()) counts.set(key, (counts.get(key) ?? 0) + 1);
    const slots: Slot[] = [...counts]
      .map(([key, count]) => {
        const samples = perRecord
          .flatMap((values) => (values.has(key) ? [values.get(key)!.name] : []))
          .slice(0, 3);
        let label: string | undefined;
        const holder = records.find((_, i) => perRecord[i]!.has(key));
        if (holder && key !== ".") {
          const top = key.split("/")[0]!;
          const cells = children[holder.index]!.map((i) => nodes[i]!).filter((cell) =>
            /cell|columnheader|rowheader/.test(lower(cell)),
          );
          const topNode = readSlot(
            { runs: new Map(), followers, nodes, children, groups: [], facts: [], urlMap },
            holder,
            top,
          );
          const position = topNode
            ? cells.findIndex((cell) => cell.index === topNode.index) + 1
            : 0;
          label = position ? labels.get(`pos${position}`) || undefined : undefined;
        }
        return {
          key,
          label,
          coverage: count / records.length,
          samples,
          link: perRecord.some((values) => {
            const node = values.get(key);
            return node !== undefined && urlMap[node.id] !== undefined;
          }),
          urlSamples: perRecord
            .flatMap((values) => {
              const node = values.get(key);
              return node && urlMap[node.id] ? [urlMap[node.id]!] : [];
            })
            .slice(0, 2),
        };
      })
      .filter((slot) => slot.coverage >= 0.05)
      .sort((a, b) => b.coverage - a.coverage);
    // A cell holding a list ("Mount Everest, Sagarmatha, Chomolungma"): offer
    // its first item as a part of its own, next to the whole cell.
    for (const slot of slots) {
      if (!/^(cell|gridcell)\[\d+\]$/.test(slot.key)) continue;
      const cells = perRecord.map((values) => values.get(slot.key));
      const listed = cells.filter(
        (cell) => cell && descendants(cell).some((d) => lower(d) === "list"),
      );
      if (!listed.length) continue;
      const firsts = cells.map((cell) => (cell ? firstItem(cell) : undefined));
      const contrast = listed.slice(0, 2).map((cell) => firstItem(cell!).name);
      slots.push({
        ...slot,
        key: `${slot.key}/${FIRST_ITEM}`,
        label: `${slot.label ? `${slot.label}, ` : ""}first item only`,
        coverage: firsts.filter(Boolean).length / records.length,
        samples: [...contrast, ...firsts.flatMap((node) => (node ? [node.name] : []))]
          .filter((v, i, a) => a.indexOf(v) === i)
          .slice(0, 3),
      });
    }
    // Records copied from separate tables that nothing else tells apart.
    const tableOf = (record: OutlineNode) => {
      let current: OutlineNode | undefined = record;
      while (current && !/^(table|grid)$/.test(lower(current)))
        current = current.parent === undefined ? undefined : nodes[current.parent];
      return current?.index;
    };
    const tables = [...new Set(group.parts.map((part) => tableOf(part[0]!)))];
    const blockOf = new Map<number, number>();
    if (tables.length >= 2 && tables.every((table) => table !== undefined)) {
      for (const part of group.parts)
        for (const record of part) blockOf.set(record.index, tables.indexOf(tableOf(record) ?? -1));
    }
    const multiSection = new Set(records.map((record) => record.parent)).size > 1;
    let common: OutlineNode | undefined = records[0];
    while (common && !records.every((record) => inside(common!, record))) {
      common = common.parent === undefined ? undefined : nodes[common.parent];
    }
    const context = records.map((record) => {
      let separator = "";
      for (const [index, text] of separators) if (index < record.index) separator = text;
      if (separator) return clip(separator, 60);
      const term = descriptionLabel(record);
      if (term) return term;
      // A short preceding sibling that is not a record, e.g. a category row.
      const parent = record.parent === undefined ? undefined : nodes[record.parent];
      if (parent) {
        const siblings = children[parent.index]!;
        for (let k = siblings.indexOf(record.index) - 1; k >= 0; k--) {
          const sibling = nodes[siblings[k]!]!;
          if (records.includes(sibling)) continue;
          const text = textOf(sibling).trim();
          if (text && text.length <= 60) return text;
          if (headers.includes(sibling)) continue;
          break;
        }
        // Records split one per container (one row per tbody): look at the container's siblings.
        const grand = parent.parent === undefined ? undefined : nodes[parent.parent];
        if (grand && children[parent.index]!.length === 1) {
          const uncles = children[grand.index]!;
          for (let k = uncles.indexOf(parent.index) - 1; k >= 0; k--) {
            const uncle = nodes[uncles[k]!]!;
            const text = textOf(uncle).trim();
            if (records.some((r) => r.parent === uncle.index)) continue;
            if (text && text.length <= 60) return text;
            break;
          }
        }
      }
      if (multiSection) {
        // Records from several containers (an "Economy" table and a "Premium"
        // table): the short text before each container, below their common ancestor.
        let current: OutlineNode | undefined = record;
        while (current && current !== common && current.parent !== undefined) {
          const up: OutlineNode = nodes[current.parent]!;
          const siblings = children[up.index]!;
          for (let k = siblings.indexOf(current.index) - 1; k >= 0; k--) {
            const sibling = nodes[siblings[k]!]!;
            if (records.some((r) => inside(sibling, r) || r === sibling)) return "";
            const heading = [sibling, ...descendants(sibling)].find(
              (n) => lower(n) === "heading" && n.name.trim(),
            );
            if (heading) {
              // A heading already inside this container takes precedence over
              // a heading in a preceding sibling section.
              return clip((headingBefore(record, current.index) || heading.name).trim(), 60);
            }
            // Navigation next to a list ("More", "See all") does not label it.
            const named = [sibling, ...descendants(sibling)].filter(
              (n) => n.name.trim() && lower(n) !== "statictext",
            );
            if (named.length && named.every((n) => /^(link|button|image)$/.test(lower(n))))
              continue;
            const words = descendants(sibling).filter(
              (n) => lower(n) === "statictext" && n.name.trim(),
            );
            const text = (
              words.length ? words.map((n) => n.name.trim()).join(" ") : textOf(sibling)
            ).trim();
            if (!text) continue;
            if (text.length <= 60) return text;
            break;
          }
          if (up === common) break;
          current = up;
        }
      }
      return headingBefore(record);
    });
    if (blockOf.size) {
      const blocks = records.map((record) => blockOf.get(record.index) ?? 0);
      const count = new Set(blocks).size;
      let last = "";
      const shown = context.map((label) => (label ? (last = label) : last));
      const labels = new Set(shown.map((label, i) => `${blocks[i]}:${label}`));
      if (count >= 2 && new Set(shown).size < count && labels.size === count) {
        const starts = new Map<number, string>();
        records.forEach(
          (record, i) =>
            starts.has(blocks[i]!) ||
            starts.set(
              blocks[i]!,
              recordText(
                { runs: new Map(), followers, nodes, children, groups: [], facts: [], urlMap },
                record,
                40,
              ),
            ),
        );
        shown.forEach((label, i) => {
          context[i] =
            `${label ? `${label} › ` : ""}table ${blocks[i]! + 1} of ${count} (starts with ${starts.get(blocks[i]!)})`;
        });
      }
    }
    return { id: `g${index}`, role: group.role, records, context, sections: group.sections, slots };
  });

  const finer = groups.filter(
    (outer) =>
      !groups.some(
        (inner) =>
          inner !== outer &&
          inner.records.length > outer.records.length &&
          inner.slots.filter((slot) => slot.coverage >= 0.5).length >= 1 &&
          outer.records.every((record) => inner.records.some((r) => inside(record, r))),
      ),
  );
  groups.splice(0, groups.length, ...finer);

  // Preserve heading scopes even when identical record shapes were merged across the page.
  // A heading covers its descendants and following siblings until the next peer heading.
  for (const heading of nodes.filter((node) => lower(node) === "heading")) {
    let end = heading.index + 1;
    while (end < nodes.length) {
      const node = nodes[end]!;
      if (node.depth < heading.depth || (node.depth === heading.depth && lower(node) === "heading"))
        break;
      end++;
    }
    // Some manuals render a list as alternating label and description paragraphs.
    // Keep that sequence within the heading that owns it.
    if (heading.parent !== undefined && heading.name) {
      const paragraphs = children[heading.parent]!.filter(
        (index) => index > heading.index && index < end,
      ).map((index) => nodes[index]!);
      const isLabel = (text: string) =>
        text.length > 0 && text.length <= 48 && !/[.!?]$/.test(text);
      for (const offset of [0, 1]) {
        const run = paragraphs.slice(offset);
        if (run.length < 6 || run.length % 2 || run.some((node) => lower(node) !== "paragraph"))
          continue;
        const labels = run.filter((_, index) => index % 2 === 0).map(textOf);
        if (
          !labels.every(isLabel) ||
          !run.every((node, index) => index % 2 === 0 || !isLabel(textOf(node)))
        )
          continue;
        const records = run
          .filter((_, index) => index % 2 === 0)
          .map((node) => firstLeaf(nodes, node));
        if (records.some((node) => !named(node))) continue;
        groups.push({
          id: `labels-${heading.index}`,
          role: "label",
          records,
          context: records.map(() => heading.name),
          sections: [heading.name],
          slots: [
            {
              key: ".",
              label: heading.name,
              coverage: 1,
              samples: records.slice(0, 3).map((node) => node.name),
              link: false,
              urlSamples: [],
            },
          ],
        });
        break;
      }
    }
    for (const group of finer) {
      const positions = group.records.flatMap((record, index) =>
        record.index > heading.index && record.index < end ? [index] : [],
      );
      if (positions.length < 2 || positions.length === group.records.length) continue;
      const records = positions.map((index) => group.records[index]!);
      if (
        groups.some(
          (existing) =>
            existing.records.length === records.length &&
            existing.records.every((record, index) => record.index === records[index]!.index),
        )
      )
        continue;
      groups.push({
        ...group,
        id: `scope-${heading.index}-${group.id}`,
        records,
        context: positions.map((index) => {
          const label = group.context[index];
          return label && label !== heading.name ? `${heading.name} › ${label}` : heading.name;
        }),
        sections: [heading.name],
      });
    }
  }

  // Records split one per container: the per-container siblings carry a category label.
  for (const group of groups) {
    let last = "";
    group.context = group.context.map((value) => {
      const text = value.replace(/^(.+?)(?:\s+\1)+$/, "$1");
      return text ? (last = text) : last;
    });
  }

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
    const leafish =
      inline || namedKids.length === 0 || ["cell", "link", "gridcell"].includes(lower(node));
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
    facts.push({
      id: node.id,
      node,
      value,
      label: [...new Set(labels)].join(" › "),
      url: urlMap[node.id],
      chrome: insideChrome(node),
    });
  }

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

  const runs = new Map<number, string>();
  for (const node of nodes) {
    const run = inlineText(node);
    if (run) runs.set(node.index, run);
  }
  const view = { runs, followers, nodes, children, groups, facts, urlMap };
  for (const group of groups.filter((candidate) => candidate.id.startsWith("scope-"))) {
    group.slots = group.slots.map((slot) => {
      const values = group.records
        .map((record) => readSlot(view, record, slot.key))
        .filter((node) => node !== undefined);
      return {
        ...slot,
        coverage: values.length / group.records.length,
        samples: values.slice(0, 3).map((node) => node.name),
        urlSamples: values
          .flatMap((node) => (urlMap[node.id] ? [urlMap[node.id]!] : []))
          .slice(0, 3),
      };
    });
  }
  return view;
}

export function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
}

/** Read the mapped slot exactly. An ancestor can contain unrelated field values. */
export function readSlot(
  view: DataView,
  record: OutlineNode,
  key: string,
): OutlineNode | undefined {
  if (key.endsWith(`/${FIRST_ITEM}`)) {
    const cell = readSlot(view, record, key.slice(0, -FIRST_ITEM.length - 1));
    return cell && firstLeaf(view.nodes, cell);
  }
  const follower = /^\+(\d+)(?:\/(.*))?$/.exec(key);
  if (follower) {
    const row = view.followers.get(record.index)?.[Number(follower[1]) - 1];
    return row ? readSlot(view, row, follower[2] || ".") : undefined;
  }
  const segments = key === "." ? [] : key.split("/");
  let current: OutlineNode | undefined = record;
  for (const segment of segments) {
    const match = /^(.+)\[(\d+)\]$/.exec(segment);
    if (!match || !current) return undefined;
    const [, role, ordinal] = match;
    const kids = view.children[current.index]!.map((i) => view.nodes[i]!).filter(
      (n) => n.role.toLowerCase() === role,
    );
    current = kids[Number(ordinal) - 1];
  }
  if (!current) return undefined;
  const run = !current.name.trim() ? view.runs.get(current.index) : undefined;
  return run ? { ...current, name: run } : current.name.trim() ? current : undefined;
}

export function recordText(view: DataView, record: OutlineNode, max = 160): string {
  const parts: string[] = [];
  for (let i = record.index; i < view.nodes.length; i++) {
    const node = view.nodes[i]!;
    if (i > record.index && node.depth <= record.depth) break;
    if (node.name.trim() && !parts.some((part) => part.includes(node.name)))
      parts.push(node.name.trim());
  }
  const rest = (view.followers.get(record.index) ?? []).map((row) => recordText(view, row, max));
  return clip([parts.join(" | "), ...rest].join(" | "), max);
}
