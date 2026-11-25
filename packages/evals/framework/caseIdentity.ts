import type { EvalInput } from "../types/evals.js";

export interface CaseLabel {
  id?: string;
  shortId?: string;
  domain?: string;
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

export function domainOf(site: string | undefined): string | undefined {
  if (!site) return undefined;
  try {
    const url = new URL(site.includes("://") ? site : `https://${site}`);
    return url.hostname.replace(/^www\./, "") || undefined;
  } catch {
    return site;
  }
}

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

export function caseDisplayName(input: Pick<EvalInput, "name" | "params">): string {
  const label = describeCase(input);
  if (!label.shortId && !label.domain) return input.name;
  return [label.shortId, label.domain].filter(Boolean).join(" ");
}

export function rowKey(input: EvalInput, trialIndex = 0): string {
  const toolSurface = typeof input.params?.toolSurface === "string" ? input.params.toolSurface : "";
  const { id } = describeCase(input);
  return [input.name, input.modelName, toolSurface, id ?? "", String(trialIndex)].join("|");
}
