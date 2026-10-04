import { choiceAnswer, type JsonValue } from "../client.js";
import { annotate, ask, type AskContext, NONE, pickCandidate, round } from "../pick.js";
import { buildView, type OutlineNode, textOf } from "../tree.js";
import { usableCandidates } from "./leaves.js";
import type { Leaf, ListPlan } from "./plan.js";
import type { DecisionsExtractDeps, Group, Item, Step } from "./types.js";
import { childrenOf, clip, descendantsOf, itemText } from "./values.js";

/** Repeating structure: find the container of items, and a field's position inside one item. */

export function fieldSummary(list: ListPlan): string {
  return `a list; each item has: ${list.fields.map((field) => field.path.join(".") + (field.description ? ` (${field.description})` : "")).join(", ")}`;
}

const MAX_GROUPS = 24;

export async function pickGroup(
  ctx: AskContext,
  deps: DecisionsExtractDeps,
  label: string,
  list: ListPlan,
): Promise<Group | undefined> {
  const nodes = deps.snap.nodes;
  const wanted = new Set(
    `${deps.instruction} ${fieldSummary(list)}`.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) ?? [],
  );
  const relevance = (group: Group) => {
    const text = group.items
      .slice(0, 3)
      .map((item) => itemText(nodes, item))
      .join(" ")
      .toLowerCase();
    return (text.match(/[\p{L}\p{N}]{3,}/gu) ?? []).filter((word) => wanted.has(word)).length;
  };
  const groups = findGroups(nodes)
    .map((group) => ({ group, score: relevance(group) * 3 + Math.min(group.items.length, 30) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_GROUPS)
    .map((entry) => entry.group);
  if (groups.length === 0) {
    ctx.trace.push({ node: `list:${label}:group`, ms: 0, options: 0 });
    return undefined;
  }

  const criteria = Object.fromEntries(
    groups.map((group, index) => [
      `group_${index}`,
      {
        repeated_element: group.kind === "flat" ? `run starting with ${group.role}` : group.role,
        item_count: group.items.length,
        first_item: clip(itemText(nodes, group.items[0]!), 220),
        second_item: clip(itemText(nodes, group.items[1]!), 140),
        inside: group.parent.name
          ? `${group.parent.role}: ${clip(group.parent.name, 60)}`
          : group.parent.role,
      },
    ]),
  );
  const question =
    "Which group of repeated elements is the list of items the instruction asks for? One option per group; each shows how many items it has and its first two items.";
  const response = await ask(
    ctx,
    `list:${label}:group`,
    { instruction: ctx.instruction },
    {
      strict: {
        type: "choice",
        instructions: question,
        criteria: { ...criteria, [NONE]: "None of these groups is that list" },
      },
      best: { type: "choice", instructions: question, criteria },
    },
  );
  const best = choiceAnswer(response, "best");
  const none = round(choiceAnswer(response, "strict").probabilities[NONE] ?? 0);
  // Nested groups (a table's rows, its row groups) split the vote between
  // near-equivalent answers: a clear leader is enough.
  const [leader = 0, second = 0] = Object.values(best.probabilities).sort((a, b) => b - a);
  const accepted =
    (best.confidence >= ctx.threshold && none <= 0.9) ||
    (leader >= 0.4 && leader >= 2 * second && none <= 0.6);
  annotate(ctx.trace, {
    options: groups.length,
    choice: best.choice,
    best: round(best.confidence),
    none,
    accepted,
  });
  return accepted ? groups[Number(best.choice.slice("group_".length))] : undefined;
}

/** Same-role siblings, and flat runs where an anchor role (a heading) starts each item. */
export function findGroups(nodes: OutlineNode[]): Group[] {
  const groups: Group[] = [];
  for (const parent of nodes) {
    const children = childrenOf(nodes, parent);
    if (children.length < 2) continue;
    const byRole = new Map<string, OutlineNode[]>();
    for (const child of children)
      byRole.set(child.role, [...(byRole.get(child.role) ?? []), child]);

    for (const [role, members] of byRole) {
      const withText = members.filter(
        (member) => textOf(nodes, member).length > 0 && !isHeaderRow(nodes, member),
      );
      if (withText.length < 2) continue;
      const rich =
        withText.filter((member) => descendantsOf(nodes, member).length > 0).length >=
        withText.length / 2;
      if (rich || role.toLowerCase() !== "statictext") {
        groups.push({ kind: "siblings", role, parent, items: withText.map((member) => [member]) });
      }

      // Flat run: h3, date, p, h3, date, p … — each anchor plus what follows it.
      if (members.length >= 3 && children.length >= members.length * 2 && !rich) {
        const items: Item[] = members.map((anchor, index) => {
          const from = children.indexOf(anchor);
          const to =
            index + 1 < members.length ? children.indexOf(members[index + 1]!) : children.length;
          return children.slice(from, to);
        });
        const sizes = items.map((item) => item.length);
        const mode = [...sizes].sort(
          (a, b) => sizes.filter((v) => v === b).length - sizes.filter((v) => v === a).length,
        )[0]!;
        const regular = sizes.filter((size) => size === mode).length / sizes.length;
        if (mode >= 2 && regular >= 0.6) {
          // The trailing item often swallows the footer: cut it to the usual size.
          groups.push({
            kind: "flat",
            role,
            parent,
            items: items.map((item) => item.slice(0, mode)),
          });
        }
      }
    }
  }
  return groups;
}

function isHeaderRow(nodes: OutlineNode[], node: OutlineNode): boolean {
  const cells = childrenOf(nodes, node);
  return cells.length > 0 && cells.every((cell) => /columnheader/i.test(cell.role));
}

export async function pickInItem(
  ctx: AskContext,
  deps: DecisionsExtractDeps,
  leaf: Leaf,
  inside: OutlineNode[],
  label: string,
): Promise<OutlineNode | undefined> {
  const allowed = new Set(inside.map((node) => node.id));
  const inItem = buildView(deps.snap.nodes, leaf.kind === "url" ? "link" : "text").filter((node) =>
    allowed.has(node.id),
  );
  const usable = usableCandidates(deps, leaf, inItem);
  const candidates = inItem.filter((node) => usable.has(node.id));
  // Even a lone candidate is confirmed (one yes/no): the first "item" of a
  // group is often a category header whose only text is not the field at all.
  if (candidates.length === 0) return undefined;
  const pick = await pickCandidate(
    ctx,
    `field:${label}`,
    deps.snap,
    candidates.slice(0, 60),
    leaf.kind === "url"
      ? "Within this one list item, which link is the one this field asks for?"
      : "Within this one list item, which element's own text IS the value of this field (not its label)?",
    false,
  );
  if (pick.picked && pick.accepted) return pick.picked;
  // Inside a single item a clear leader is enough: the alternatives are the
  // item's other fields, not other items.
  const [first, second] = pick.ranked;
  if (first && first.p >= 0.5 && first.p >= 2 * (second?.p ?? 0) && pick.none <= 0.5) {
    return deps.snap.nodes.find((node) => node.id === first.id);
  }
  return undefined;
}

/** Path from an item's top-level nodes down to `target`, as (role, ordinal among same-role siblings). */
export function routeTo(nodes: OutlineNode[], item: Item, target: OutlineNode): Step[] | undefined {
  const tops = new Set(item.map((node) => node.index));
  const steps: Step[] = [];
  for (let at: OutlineNode = target; ; ) {
    if (tops.has(at.index)) {
      const sameRole = item.filter((node) => node.role === at.role);
      steps.unshift({ role: at.role, nth: sameRole.indexOf(at) });
      return steps;
    }
    if (at.parent === undefined) return undefined;
    const parent = nodes[at.parent]!;
    const sameRole = childrenOf(nodes, parent).filter((child) => child.role === at.role);
    steps.unshift({ role: at.role, nth: sameRole.indexOf(at) });
    at = parent;
  }
}

/** The nearest heading above a node, in document order. */
export function precedingHeading(
  nodes: OutlineNode[],
  first: OutlineNode | undefined,
): string | undefined {
  if (!first) return undefined;
  for (let i = first.index - 1; i >= 0 && first.index - i <= 40; i--) {
    const node = nodes[i];
    if (node && /heading/i.test(node.role) && node.name) return node.name;
  }
  return undefined;
}

/** The node at the exemplar's exact position, or (when the item has none) the same-role nodes nearest to it. */
export function follow(
  nodes: OutlineNode[],
  item: Item,
  route: Step[],
): { exact?: OutlineNode; neighbours: OutlineNode[] } | undefined {
  let level: OutlineNode[] = item;
  let exact = true;
  let at: OutlineNode | undefined;
  let last: OutlineNode[] = [];
  for (const step of route) {
    const sameRole = level.filter((node) => node.role === step.role);
    at = sameRole[step.nth];
    if (!at) {
      exact = false;
      at = sameRole[sameRole.length - 1];
    }
    if (!at) return undefined;
    last = sameRole;
    level = childrenOf(nodes, at);
  }
  const neighbours = [...last].reverse();
  return exact && at ? { exact: at, neighbours } : { neighbours };
}

/** Coarse "same kind of value": both carry digits or neither does, and a comparable length. */
export function looksAlike(
  value: JsonValue | undefined,
  exemplar: JsonValue | undefined,
  digitsMatter = true,
): boolean {
  if (value === undefined || exemplar === undefined) return false;
  if (typeof value !== typeof exemplar) return false;
  if (typeof value !== "string" || typeof exemplar !== "string") return true;
  const digits = (text: string) => /\d/.test(text);
  const ratio = value.length / Math.max(1, exemplar.length);
  return (!digitsMatter || digits(value) === digits(exemplar)) && ratio >= 0.25 && ratio <= 4;
}
