import { type JsonValue, noulAnswer } from "../client.js";
import { annotate, ask, type AskContext, round, type TraceEntry } from "../pick.js";
import { type OutlineNode, textOf } from "../tree.js";
import {
  fieldSummary,
  follow,
  looksAlike,
  pickGroup,
  pickInItem,
  precedingHeading,
  routeTo,
} from "./groups.js";
import type { Leaf, ListPlan } from "./plan.js";
import type { DecisionsExtractDeps, Step } from "./types.js";
import { clip, descendantsOf, itemText, requestedCount, setPath, valueOf } from "./values.js";

/** List fields: induce every item from one exemplar, then keep the items that were asked for. */

const MAX_ITEMS = 200;

const MIN_ITEM_RESOLUTION = 0.7;

/**
 * Lists, item-first. Code finds the groups of repeated siblings on the page
 * (rows, cards, list items, and flat heading/text/paragraph runs), the decision model says
 * which group is the list, then picks each field inside the FIRST item only:
 * a handful of candidates that are guaranteed to belong together. The same
 * relative positions are then read from every other item.
 */
export async function readList(
  list: ListPlan,
  deps: DecisionsExtractDeps,
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
  // A list introduced by a heading ("Economy") is in that section from its
  // first item on, before any header shows up between items.
  let section = clip(precedingHeading(nodes, group.items[0]?.[0]) ?? "", 80);
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
      // An inserted or removed same-role element before the field shifts the
      // ordinal: an exact position whose value does not resemble the exemplar's
      // (a badge cell where a name should be) is a shifted route, and the
      // same-role neighbours are read instead.
      const found = route ? follow(nodes, item, route) : undefined;
      // The exact position is trusted on a lenient check for strings (length
      // only: "AirPods Max" next to an exemplar "Sony WH-1000XM5" is the same
      // kind of value, digits or not). A neighbour substituted for a shifted
      // route must match strictly, so a header's text between rows never does.
      const lenient = field.kind === "string" || field.kind === "enum";
      const exactValue = found?.exact ? valueOf(deps, field, found.exact) : undefined;
      const value =
        exactValue !== undefined && looksAlike(exactValue, exemplarValues[index], !lenient)
          ? exactValue
          : found?.neighbours
              .filter((node) => node !== found.exact)
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
  const considered = Math.min(group.items.length, MAX_ITEMS);
  if (items.length === 0 || items.length / considered < MIN_ITEM_RESOLUTION) return undefined;
  if (filtered.length === 0) return undefined;
  return limit ? filtered.slice(0, limit) : filtered;
}

const ITEM_BATCH = 60;

/** With section headers present, an item the decision model doubts belongs to the asked-for section is left out. */
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
