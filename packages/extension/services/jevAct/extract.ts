import type { StagehandLogger } from "../../logger.js";
import { extractionCompleted } from "./extractCheck.js";
import {
  NONE,
  annotate,
  ask,
  pickCandidate,
  pickTarget,
  round,
  type AskContext,
  type Snapshot,
  type TraceEntry,
} from "./pick.js";
import { buildView, pageDigest, textOf, type OutlineNode } from "./tree.js";
import { choiceAnswer, noulAnswer, type JevConfig, type JsonValue } from "./typesafeClient.js";

/**
 * Experimental extract() on Jev: pick-and-copy. Jev cannot write text, but an
 * extraction rarely needs writing: the values are on the page. For every
 * field of the schema Jev picks the element that holds the value and code
 * copies that element's text (or link URL), parsing numbers. Lists are
 * induced from one exemplar item: Jev picks each field in the FIRST item, code
 * finds the repeating container and reads the same relative position in every
 * sibling. Booleans and enums, which are judgments rather than copies, are
 * asked directly. Anything the schema or the page does not fit goes to the LLM.
 */

export type JsonSchema = {
  type?: string | string[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  items?: JsonSchema;
  enum?: JsonValue[];
  format?: string;
  description?: string;
  anyOf?: JsonSchema[];
  oneOf?: JsonSchema[];
};

export type JevExtractDeps = {
  logger: StagehandLogger;
  instruction: string;
  schema: JsonSchema;
  snap: Snapshot;
  urlMap: Record<string, string>;
  ensureTimeRemaining: () => void;
  /** Gate the result with the completion yes/no. False returns whatever was copied. */
  gate: boolean;
};

export type JevExtractOutcome =
  | { kind: "done"; data: JsonValue; completed: boolean }
  | { kind: "fallback"; reason: string };

type Leaf = {
  path: string[];
  kind: "string" | "number" | "integer" | "boolean" | "url" | "enum";
  description: string;
  options?: string[];
  required: boolean;
};
type ListPlan = { path: string[]; fields: Leaf[]; primitive: boolean; required: boolean };
type Plan = { leaves: Leaf[]; lists: ListPlan[] };

class Unsupported extends Error {}

const MAX_FIELDS = 24;
const MAX_ITEMS = 200;
const MIN_ITEM_RESOLUTION = 0.7;
const EXTRACT_CONFIDENCE = 0.45;

export async function runJevExtract(
  config: JevConfig & { actConfidence?: number },
  deps: JevExtractDeps,
): Promise<JevExtractOutcome> {
  const trace: TraceEntry[] = [];
  const finish = (outcome: JevExtractOutcome): JevExtractOutcome => {
    deps.logger.info("Jev extract pipeline finished", {
      category: "jev",
      instruction: deps.instruction,
      outcome: outcome.kind,
      reason: outcome.kind === "fallback" ? outcome.reason : "",
      trace: JSON.stringify(trace),
    });
    return outcome;
  };

  let plan: Plan;
  try {
    plan = planSchema(deps.schema);
  } catch (error) {
    if (error instanceof Unsupported)
      return finish({ kind: "fallback", reason: `schema:${error.message}` });
    throw error;
  }
  const fieldCount =
    plan.leaves.length + plan.lists.reduce((sum, list) => sum + list.fields.length, 0);
  if (fieldCount === 0 || fieldCount > MAX_FIELDS) {
    return finish({ kind: "fallback", reason: `schema:${fieldCount}_fields` });
  }

  const base = {
    config,
    trace,
    // Lower than act()'s 0.7: a wrong copy is caught by the schema, the list
    // structure and the completion gate, and nothing on the page is touched.
    threshold: EXTRACT_CONFIDENCE,
    logger: deps.logger,
    ensureTimeRemaining: deps.ensureTimeRemaining,
  };
  // Each field is its own question; the field's name and description steer
  // both the lexical pruning and Jev.
  const forField = (leaf: Leaf, note = ""): AskContext => ({
    ...base,
    instruction: `${deps.instruction}\nField to find: ${leaf.path.join(".")}${leaf.description ? ` (${leaf.description})` : ""}${note}`,
  });

  const data: Record<string, JsonValue> = {};
  const missing: string[] = [];

  // Scalars and list exemplars are independent: ask them all at once.
  const [scalars, lists] = await Promise.all([
    Promise.all(plan.leaves.map((leaf) => readLeaf(forField(leaf), deps, leaf))),
    Promise.all(plan.lists.map((list) => readList(list, deps, forField, trace))),
  ]);

  plan.leaves.forEach((leaf, index) => {
    const value = scalars[index];
    if (value === undefined) {
      if (leaf.required) missing.push(leaf.path.join("."));
      return;
    }
    setPath(data, leaf.path, value);
  });
  plan.lists.forEach((list, index) => {
    const items = lists[index];
    if (items === undefined) {
      if (list.required) missing.push(list.path.join("."));
      return;
    }
    setPath(data, list.path, items);
  });

  if (missing.length > 0)
    return finish({ kind: "fallback", reason: `unresolved:${missing.slice(0, 5).join(",")}` });

  let completed = true;
  if (deps.gate) {
    const verdict = await extractionCompleted({ ...base, instruction: deps.instruction }, data);
    completed = verdict.completed;
    if (!completed) return finish({ kind: "fallback", reason: `incomplete@${verdict.score}` });
  }
  return finish({ kind: "done", data, completed });
}

async function readLeaf(
  ctx: AskContext,
  deps: JevExtractDeps,
  leaf: Leaf,
): Promise<JsonValue | undefined> {
  if (leaf.kind === "boolean" || leaf.kind === "enum") return await judgeLeaf(ctx, deps, leaf);
  const node = await pickValueNode(ctx, deps, leaf, leaf.path.join("."));
  return node ? valueOf(deps, leaf, node) : undefined;
}

async function pickValueNode(
  ctx: AskContext,
  deps: JevExtractDeps,
  leaf: Leaf,
  label: string,
): Promise<OutlineNode | undefined> {
  const usable = usableCandidates(
    deps,
    leaf,
    buildView(deps.snap.nodes, leaf.kind === "url" ? "link" : "text"),
  );
  const picked = await pickTarget(
    ctx,
    `field:${label}`,
    deps.snap,
    [leaf.kind === "url" ? "link" : "text"],
    leaf.kind === "url"
      ? "Which link is the one this field asks for?"
      : "Which element's own text IS the value of this field (not its label)?",
    { quotedTargets: [], filter: (node) => usable.has(node.id) },
  );
  if (picked.target) return picked.target;

  // Pages repeat a value (a star count in the header and in the sidebar). A
  // vote split between copies of the same text is not doubt about the value.
  const [first, second] = picked.ranked;
  const node = (id: string | undefined) => deps.snap.nodes.find((candidate) => candidate.id === id);
  const a = node(first?.id);
  const b = node(second?.id);
  if (
    a &&
    b &&
    picked.none <= 0.5 &&
    first!.p + second!.p >= ctx.threshold &&
    sameValue(valueOf(deps, leaf, a), valueOf(deps, leaf, b))
  ) {
    ctx.trace.push({ node: `field:${label}:same_value`, ms: 0, choice: a.id });
    return a;
  }
  return undefined;
}

/**
 * Only candidates that can yield a value of the field's type (a number field
 * cannot be copied from the label "Stars"), and one node per distinct value:
 * copies of the same text would only split Jev's vote over an identical result.
 */
function usableCandidates(
  deps: JevExtractDeps,
  leaf: Leaf,
  candidates: OutlineNode[],
): Set<string> {
  const seen = new Set<string>();
  const keep = new Set<string>();
  for (const node of candidates) {
    // A column header names a value; it is never the value.
    if (/columnheader/i.test(node.role)) continue;
    const value = valueOf(deps, leaf, node);
    if (value === undefined) continue;
    const key = JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    keep.add(node.id);
  }
  return keep;
}

/** Equal, or numbers within 2% ("250.5k" in the sidebar, "251k" in the header). */
function sameValue(a: JsonValue | undefined, b: JsonValue | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  if (typeof a === "number" && typeof b === "number") {
    return Math.abs(a - b) <= 0.02 * Math.max(Math.abs(a), Math.abs(b));
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Booleans and enums are judgments about the page, not text to copy. */
async function judgeLeaf(
  ctx: AskContext,
  deps: JevExtractDeps,
  leaf: Leaf,
): Promise<JsonValue | undefined> {
  const state = { instruction: ctx.instruction, page: pageDigest(deps.snap.nodes, 80) };
  if (leaf.kind === "boolean") {
    const response = await ask(ctx, `field:${leaf.path.join(".")}`, state, {
      value: {
        type: "noul",
        instructions: `Is this true of the page: ${leaf.description || leaf.path.join(" ")}?`,
      },
    });
    const score = round(noulAnswer(response, "value").noul);
    annotate(ctx.trace, { noul: score });
    return score >= 0.5;
  }
  const options = leaf.options ?? [];
  const response = await ask(ctx, `field:${leaf.path.join(".")}`, state, {
    value: {
      type: "choice",
      instructions: `Which value does the page show for: ${leaf.description || leaf.path.join(" ")}?`,
      criteria: {
        ...Object.fromEntries(options.map((option, index) => [`option_${index}`, option])),
        [NONE]: "The page does not say",
      },
    },
  });
  const answer = choiceAnswer(response, "value");
  annotate(ctx.trace, { choice: answer.choice, confidence: answer.confidence });
  if (answer.choice === NONE || answer.confidence < ctx.threshold) return undefined;
  return options[Number(answer.choice.slice("option_".length))];
}

/**
 * Lists, item-first. Code finds the groups of repeated siblings on the page
 * (rows, cards, list items, and flat heading/text/paragraph runs), Jev says
 * which group is the list, then picks each field inside the FIRST item only:
 * a handful of candidates that are guaranteed to belong together. The same
 * relative positions are then read from every other item.
 */
async function readList(
  list: ListPlan,
  deps: JevExtractDeps,
  forField: (leaf: Leaf, note?: string) => AskContext,
  trace: TraceEntry[],
): Promise<JsonValue[] | undefined> {
  const nodes = deps.snap.nodes;
  const label = list.path.join(".");
  if (list.fields.some((field) => field.kind === "boolean" || field.kind === "enum"))
    return undefined;

  const listCtx = forField({
    path: list.path,
    kind: "string",
    description: fieldSummary(list),
    required: true,
  });
  const group = await pickGroup(listCtx, deps, label, list);
  if (!group) return undefined;

  // Field picks inside one item. If the first item lacks a required field
  // (a sponsored card, a header), the second item gets a try.
  let routes: Array<Step[] | undefined> | undefined;
  let exemplarValues: Array<JsonValue | undefined> = [];
  for (const exemplar of group.items.slice(0, 2)) {
    const inside = exemplar.flatMap((top) => [top, ...descendantsOf(nodes, top)]);
    const picks = await Promise.all(
      list.fields.map((field) =>
        pickInItem(forField(field), deps, field, inside, `${label}[].${field.path.join(".")}`),
      ),
    );
    // Two fields landing on the same element means at least one pick is wrong
    // ("area" and "area code" both on the Area cell): not an exemplar to trust.
    const ids = picks
      .filter((node): node is OutlineNode => node !== undefined)
      .map((node) => node.id);
    if (new Set(ids).size !== ids.length) {
      trace.push({ node: `list:${label}`, ms: 0, reason: "fields_share_an_element" });
      continue;
    }
    if (list.fields.every((field, index) => !field.required || picks[index])) {
      routes = picks.map((node) => (node ? routeTo(nodes, exemplar, node) : undefined));
      exemplarValues = picks.map((node, index) =>
        node ? valueOf(deps, list.fields[index]!, node) : undefined,
      );
      // A list of plain values whose items each say one thing: read the item
      // itself, so items wrapped slightly differently (a link here, bare text
      // there) still resolve.
      if (
        list.primitive &&
        list.fields[0]!.kind !== "url" &&
        new Set(inside.map((node) => textOf(nodes, node)).filter(Boolean)).size === 1
      ) {
        routes = [[{ role: exemplar[0]!.role, nth: 0 }]];
      }
      break;
    }
  }
  if (!routes) {
    trace.push({ node: `list:${label}`, ms: 0, items: 0, reason: "fields_not_found_in_item" });
    return undefined;
  }

  const items: JsonValue[] = [];
  const kept: Array<{ text: string; section: string }> = [];
  // The nearest preceding item that did not resolve is usually a section
  // header ("Economy", "Daily Driver") and says which section an item is in.
  let section = "";
  let previousEnd = -1;
  for (const item of group.items.slice(0, MAX_ITEMS)) {
    // Text sitting BETWEEN two items (a "Premium" band that is not itself an
    // item of the group) is a section header too.
    const start = item[0]!.index;
    if (previousEnd >= 0) {
      const between = nodes
        .slice(previousEnd + 1, start)
        .filter((node) => node.name)
        .map((node) => node.name);
      if (between.length > 0) section = clip([...new Set(between)].join(" "), 80);
    }
    const lastTop = item[item.length - 1]!;
    previousEnd = lastTop.index + descendantsOf(nodes, lastTop).length;
    const record: Record<string, JsonValue> = {};
    let complete = true;
    list.fields.forEach((field, index) => {
      const route = routes![index];
      // The exemplar's position first; in an item shaped a little differently
      // (an extra badge cell, a missing photo) the same-role neighbours are
      // tried too. Whatever is read must look like the exemplar's value, so a
      // category header between rows contributes nothing.
      // The exemplar's exact position is trusted as is. Only when an item has
      // no such position (an extra badge, a missing photo, a section header)
      // are same-role neighbours read, and then the value must look like the
      // exemplar's, so a header between rows contributes nothing.
      const found = route ? follow(nodes, item, route) : undefined;
      const value = found?.exact
        ? valueOf(deps, field, found.exact)
        : found?.neighbours
            .map((node) => valueOf(deps, field, node))
            .find((candidate) => looksAlike(candidate, exemplarValues[index]));
      if (value === undefined) {
        if (field.required) complete = false;
        return;
      }
      setPath(record, field.path, value);
    });
    if (!complete) {
      section = clip(itemText(nodes, item), 80);
      continue;
    }
    items.push(list.primitive ? (record[list.fields[0]!.path[0]!] ?? null) : record);
    kept.push({ text: clip(itemText(nodes, item), 200), section });
  }

  // The group is structural; the instruction may want only some of it ("in the
  // 'economy' category"). One yes/no per item, all in one request.
  const wanted = await itemsAskedFor(
    forField({ path: list.path, kind: "string", description: "", required: true }),
    label,
    kept,
  );
  const filtered = items.filter((_, index) => wanted[index]);

  const limit = requestedCount(deps.instruction);
  trace.push({
    node: `list:${label}`,
    ms: 0,
    group: group.kind,
    item_role: group.role,
    candidates: group.items.length,
    items: items.length,
    kept: filtered.length,
    limit: limit ?? null,
  });
  if (items.length === 0 || items.length / group.items.length < MIN_ITEM_RESOLUTION)
    return undefined;
  if (filtered.length === 0) return undefined;
  return limit ? filtered.slice(0, limit) : filtered;
}

const ITEM_BATCH = 60;
/** With section headers present, an item Jev doubts belongs to the asked-for section is left out. */
const ITEM_NOT_WANTED = 0.5;

async function itemsAskedFor(
  ctx: AskContext,
  label: string,
  items: Array<{ text: string; section: string }>,
): Promise<boolean[]> {
  // Without sections there is nothing structural to filter on, and a list of
  // plain siblings is what the group choice already answered.
  if (!items.some((item) => item.section)) return items.map(() => true);
  const verdicts: boolean[] = [];
  for (let at = 0; at < items.length; at += ITEM_BATCH) {
    const batch = items.slice(at, at + ITEM_BATCH);
    const response = await ask(
      ctx,
      `list:${label}:items`,
      { instruction: ctx.instruction },
      Object.fromEntries(
        batch.map((item, index) => [
          `item_${at + index}`,
          {
            type: "noul" as const,
            instructions: {
              question: "Is this item one of the items the instruction asks for?",
              item: item.text,
              ...(item.section ? { listed_under: item.section } : {}),
            },
          },
        ]),
      ),
    );
    const scores = batch.map((_, index) => round(noulAnswer(response, `item_${at + index}`).noul));
    annotate(ctx.trace, { scores });
    scores.forEach((score) => verdicts.push(score >= ITEM_NOT_WANTED));
  }
  return verdicts;
}

function fieldSummary(list: ListPlan): string {
  return `a list; each item has: ${list.fields.map((field) => field.path.join(".") + (field.description ? ` (${field.description})` : "")).join(", ")}`;
}

/** An item is one or more adjacent top-level nodes (several for flat runs). */
type Item = OutlineNode[];
type Group = { kind: "siblings" | "flat"; role: string; parent: OutlineNode; items: Item[] };

const MAX_GROUPS = 24;

async function pickGroup(
  ctx: AskContext,
  deps: JevExtractDeps,
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

async function pickInItem(
  ctx: AskContext,
  deps: JevExtractDeps,
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

type Step = { role: string; nth: number };

/** Path from an item's top-level nodes down to `target`, as (role, ordinal among same-role siblings). */
function routeTo(nodes: OutlineNode[], item: Item, target: OutlineNode): Step[] | undefined {
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

/** The node at the exemplar's exact position, or (when the item has none) the same-role nodes nearest to it. */
function follow(
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
  return exact && at ? { exact: at, neighbours: [] } : { neighbours: [...last].reverse() };
}

/** Coarse "same kind of value": both carry digits or neither does, and a comparable length. */
function looksAlike(value: JsonValue | undefined, exemplar: JsonValue | undefined): boolean {
  if (value === undefined || exemplar === undefined) return false;
  if (typeof value !== typeof exemplar) return false;
  if (typeof value !== "string" || typeof exemplar !== "string") return true;
  const digits = (text: string) => /\d/.test(text);
  const ratio = value.length / Math.max(1, exemplar.length);
  return digits(value) === digits(exemplar) && ratio >= 0.25 && ratio <= 4;
}

function childrenOf(nodes: OutlineNode[], parent: OutlineNode): OutlineNode[] {
  const children: OutlineNode[] = [];
  for (let i = parent.index + 1; i < nodes.length && nodes[i]!.depth > parent.depth; i++) {
    if (nodes[i]!.parent === parent.index) children.push(nodes[i]!);
  }
  return children;
}

function descendantsOf(nodes: OutlineNode[], root: OutlineNode): OutlineNode[] {
  const out: OutlineNode[] = [];
  for (let i = root.index + 1; i < nodes.length && nodes[i]!.depth > root.depth; i++)
    out.push(nodes[i]!);
  return out;
}

function itemText(nodes: OutlineNode[], item: Item | undefined): string {
  return (item ?? [])
    .map((node) => textOf(nodes, node))
    .filter(Boolean)
    .join(" · ");
}

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function valueOf(deps: JevExtractDeps, leaf: Leaf, node: OutlineNode): JsonValue | undefined {
  if (leaf.kind === "url") {
    const direct = deps.urlMap[node.id];
    if (direct) return direct;
    // The picked text may sit inside the link.
    for (let at = node.parent; at !== undefined; at = deps.snap.nodes[at]!.parent) {
      const url = deps.urlMap[deps.snap.nodes[at]!.id];
      if (url) return url;
    }
    return undefined;
  }
  const text = stripLabel(textOf(deps.snap.nodes, node), leaf);
  if (!text) return undefined;
  if (leaf.kind === "string") return text;
  const match = /(-?\d[\d,]*(?:\.\d+)?)(?:([kKmMbB])(?![\w]))?/.exec(text.replace(/\s/g, ""));
  if (!match) return undefined;
  const scale = { k: 1e3, m: 1e6, b: 1e9 }[match[2]?.toLowerCase() ?? ""] ?? 1;
  const number = Number(match[1]!.replace(/,/g, "")) * scale;
  if (!Number.isFinite(number)) return undefined;
  return leaf.kind === "integer" ? Math.round(number) : number;
}

/** "Price: $20" picked for the field `price` → "$20". */
function stripLabel(text: string, leaf: Leaf): string {
  const match = /^([^:]{1,40}):\s+(.+)$/s.exec(text.trim());
  if (!match) return text.trim();
  const words = new Set(
    `${leaf.path.join(" ")} ${leaf.description}`.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [],
  );
  const label = match[1]!.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return label.some((word) => words.has(word)) ? match[2]!.trim() : text.trim();
}

function requestedCount(instruction: string): number | undefined {
  const match = /\b(?:top|first)\s+(\d{1,3})\b/i.exec(instruction);
  return match ? Number(match[1]) : undefined;
}

function setPath(target: Record<string, JsonValue>, path: string[], value: JsonValue): void {
  let at = target;
  for (const key of path.slice(0, -1)) {
    if (typeof at[key] !== "object" || at[key] === null || Array.isArray(at[key])) at[key] = {};
    at = at[key] as Record<string, JsonValue>;
  }
  at[path[path.length - 1]!] = value;
}

/** Flattens the JSON schema into copyable leaves and lists; throws Unsupported otherwise. */
export function planSchema(schema: JsonSchema): Plan {
  const plan: Plan = { leaves: [], lists: [] };
  const walk = (
    node: JsonSchema,
    path: string[],
    required: boolean,
    into: Leaf[] | undefined,
  ): void => {
    const resolved = unwrapNullable(node);
    const optional = resolved !== node;
    const type = Array.isArray(resolved.type)
      ? resolved.type.find((entry) => entry !== "null")
      : resolved.type;
    const description = resolved.description ?? node.description ?? "";

    if (type === "object" && resolved.properties) {
      for (const [key, child] of Object.entries(resolved.properties)) {
        walk(
          child,
          [...path, key],
          required && !optional && (resolved.required ?? []).includes(key),
          into,
        );
      }
      return;
    }
    if (type === "array" && resolved.items) {
      if (into) throw new Unsupported("nested_array");
      const items = unwrapNullable(resolved.items);
      const fields: Leaf[] = [];
      const itemType = Array.isArray(items.type) ? items.type[0] : items.type;
      if (itemType === "object") {
        walk(items, [], true, fields);
        plan.lists.push({ path, fields, primitive: false, required: required && !optional });
      } else {
        walk({ ...items, description: items.description ?? description }, ["value"], true, fields);
        plan.lists.push({ path, fields, primitive: true, required: required && !optional });
      }
      return;
    }
    const leaf = (kind: Leaf["kind"], options?: string[]): void => {
      (into ?? plan.leaves).push({
        path,
        kind,
        description,
        required: required && !optional,
        ...(options ? { options } : {}),
      });
    };
    if (resolved.enum && resolved.enum.every((entry) => typeof entry === "string")) {
      return leaf("enum", resolved.enum as string[]);
    }
    if (type === "string")
      return leaf(resolved.format === "uri" || resolved.format === "url" ? "url" : "string");
    if (type === "number" || type === "integer" || type === "boolean") return leaf(type);
    throw new Unsupported(`type_${String(type ?? "unknown")}`);
  };
  const root = unwrapNullable(schema);
  if ((Array.isArray(root.type) ? root.type[0] : root.type) !== "object")
    throw new Unsupported("root_not_object");
  walk(schema, [], true, undefined);
  return plan;
}

function unwrapNullable(node: JsonSchema): JsonSchema {
  const variants = node.anyOf ?? node.oneOf;
  if (!variants) return node;
  const real = variants.filter((variant) => variant.type !== "null");
  if (real.length !== 1) throw new Unsupported("union");
  return real[0]!;
}
