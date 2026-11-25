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

const MAX_ITEMS = 200;

const MIN_ITEM_RESOLUTION = 0.7;

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

  let routes: Array<Step[] | undefined> | undefined;
  let exemplarValues: Array<JsonValue | undefined> = [];
  for (const exemplar of group.items.slice(0, 2)) {
    const inside = exemplar.flatMap((top) => [top, ...descendantsOf(nodes, top)]);
    const picks = await Promise.all(
      list.fields.map((field) =>
        pickInItem(forField(field), deps, field, inside, `${label}[].${field.path.join(".")}`),
      ),
    );
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
  let section = clip(precedingHeading(nodes, group.items[0]?.[0]) ?? "", 80);
  let previousEnd = -1;
  for (const item of group.items.slice(0, MAX_ITEMS)) {
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
      const found = route ? follow(nodes, item, route) : undefined;
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

const ITEM_NOT_WANTED = 0.5;

async function itemsAskedFor(
  ctx: AskContext,
  label: string,
  items: Array<{ text: string; section: string }>,
): Promise<boolean[]> {
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
