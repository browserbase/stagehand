/**
 * Which case a row is, for display and for keying live progress.
 *
 * Every benchmark suite names its testcases after the suite
 * (`agent/hardbenchmark`) and keeps the case identity in `params`, so
 * anything keyed or labelled by `input.name` alone collapses a whole run into
 * one entry. The suites agree on three fields, under two spellings each:
 *
 *   id        `id` (hardbenchmark, webtailbench, webvoyager) or `task_id`
 *             (onlineMind2Web, odysseysbench)
 *   site      `web` or `website` (a URL or a bare host)
 *   question  `ques` or `confirmed_task`
 *
 * Plain tasks (no params) are identified by their name.
 */

import type { EvalInput } from "../types/evals.js";

export interface CaseLabel {
  /** Dataset case id, when the row comes from a suite. */
  id?: string;
  /** Short form of `id` for display (hash ids are 32 hex chars). */
  shortId?: string;
  /** Host of the case's start URL, without `www.`. */
  domain?: string;
  /** The task the agent was given. */
  question?: string;
}

const SHORT_ID_LENGTH = 8;

function readString(params: Record<string, unknown> | undefined, ...keys: string[]) {
  for (const key of keys) {
    const value = params?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number") return String(value);
  }
  return undefined;
}

/** `https://www.recreation.gov/x` → `recreation.gov`; bare hosts pass through. */
export function domainOf(site: string | undefined): string | undefined {
  if (!site) return undefined;
  try {
    const url = new URL(site.includes("://") ? site : `https://${site}`);
    return url.hostname.replace(/^www\./, "") || undefined;
  } catch {
    return site;
  }
}

/**
 * Hash-like ids are cut to 8 chars; readable ids (`heb_comparison_shopping_1`)
 * are kept whole, since cutting them loses the part that tells cases apart.
 */
export function shortCaseId(id: string): string {
  return /^[0-9a-f]{16,}$/i.test(id) ? id.slice(0, SHORT_ID_LENGTH) : id;
}

export function describeCase(input: Pick<EvalInput, "params">): CaseLabel {
  const params = input.params as Record<string, unknown> | undefined;
  const id = readString(params, "id", "task_id");
  const domain = domainOf(readString(params, "web", "website"));
  const question = readString(params, "ques", "confirmed_task");
  return {
    ...(id && { id, shortId: shortCaseId(id) }),
    ...(domain && { domain }),
    ...(question && { question }),
  };
}

/** One-line name for a row: `47e314cc recreation.gov` for suite cases, the task name otherwise. */
export function caseDisplayName(input: Pick<EvalInput, "name" | "params">): string {
  const label = describeCase(input);
  if (!label.shortId && !label.domain) return input.name;
  return [label.shortId, label.domain].filter(Boolean).join(" ");
}

/**
 * Stable key for one execution: cell (task, model, tool surface) + case + trial.
 * Two trials of the same case, or the same case on two models, never share a key.
 */
export function rowKey(input: EvalInput, trialIndex = 0): string {
  const toolSurface = typeof input.params?.toolSurface === "string" ? input.params.toolSurface : "";
  const { id } = describeCase(input);
  return [input.name, input.modelName, toolSurface, id ?? "", String(trialIndex)].join("|");
}
