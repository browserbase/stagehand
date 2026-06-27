import { generateText } from "ai";
import type { ClawBenchJudgeVerdict, ClawBenchModelConfig } from "./types.js";
import { getClawBenchLanguageModel } from "./languageModel.js";

const LENIENT_SYSTEM = `You are a lenient evaluator for a web-agent benchmark.

A user gave a natural-language INSTRUCTION to an autonomous browser agent.
The agent navigated a real website and finally produced a single HTTP request
(URL + method + body) that we INTERCEPTED before it was sent to the server.

You decide whether this intercepted request ALIGNS with the user's instruction.

# Rubric (CRITICAL — read carefully)

match = TRUE if there is NO EXPLICIT CONTRADICTION between the request and
the instruction. The default verdict is TRUE.

match = FALSE only if the request EXPLICITLY contradicts a field the user
EXPLICITLY specified in the instruction. Examples of contradiction:
- Instruction says "red shirt", request body shows "color: blue"
- Instruction says "quantity 2", request body shows "qty: 5"
- Instruction says "deliver to home", request body shows "deliver to work"
- Instruction asks to enroll in CS50, request enrolls in CS61

# What is NOT a contradiction (default to match = TRUE)

- Instruction did not specify a field, request omits or has any value for it
  → MATCH (the user did not constrain it)
- Instruction said "3pm", request body has no time field at all
  → MATCH (info absent, not contradicted)
- PDF resume left blank where instruction did not require content
  → MATCH
- Cosmetic differences (timestamps, session IDs, affiliate codes, currency
  symbols, formatting) → MATCH
- Ambiguous wording where multiple interpretations work → MATCH
- Agent picked a reasonable default for unspecified options → MATCH
- Color, size, time, quantity not mentioned in instruction → MATCH

# Output

Reply with ONLY a single-line JSON object, no markdown fences, no extra prose:
{"match": true|false, "reason": "<one short sentence>"}

Default is true. Only return false when you can name a SPECIFIC explicit
field from the instruction that the request EXPLICITLY contradicts.
`;

const STRICT_SYSTEM = `You are a strict evaluator for a web-agent benchmark.

A user gave a natural-language INSTRUCTION to an autonomous browser agent.
The agent navigated a real website and finally produced a single HTTP request
(URL + method + body) that we INTERCEPTED before it was sent to the server.

Decide whether this intercepted request, if it had been sent, would correctly
fulfill the user's instruction.

Rules:
- Match = the request would do what the user asked (right item, right action,
  right target, right quantity). Cosmetic differences (timestamps, session IDs,
  affiliate codes, etc.) are OK.
- Mismatch = the request does the wrong thing (wrong item, wrong action,
  wrong target, wrong quantity, missing required field per instruction).
- If the request is ambiguous or only partially correct, mark as mismatch.

Reply with ONLY a single-line JSON object, no markdown fences, no extra prose:
{"match": true|false, "reason": "<one short sentence>"}
`;

function contextText(judgeContext?: Record<string, unknown>): string {
  if (!judgeContext) return "";
  const parts: string[] = [];
  const rubric = judgeContext.rubric;
  if (typeof rubric === "string" && rubric.trim()) {
    parts.push(`Rubric:\n${rubric.trim().slice(0, 6000)}`);
  }
  const reference = judgeContext.reference_solution;
  if (typeof reference === "string" && reference.trim()) {
    parts.push(`Reference solution:\n${reference.trim().slice(0, 6000)}`);
  }
  const source = judgeContext.source_task_yaml;
  if (typeof source === "string" && source.trim()) {
    parts.push(`Source task YAML:\n${source.trim().slice(0, 6000)}`);
  }
  if (parts.length === 0) return "";
  return (
    "\n\nHIDDEN JUDGE CONTEXT (not shown to the agent; use only for grading):\n" +
    parts.join("\n\n")
  );
}

function buildUserMessage(
  instruction: string,
  interception: Record<string, unknown>,
  judgeContext?: Record<string, unknown>,
  rubric: "lenient" | "strict" = "lenient",
): string {
  const req =
    interception.request &&
    typeof interception.request === "object" &&
    !Array.isArray(interception.request)
      ? (interception.request as Record<string, unknown>)
      : {};
  const body = req.body;
  const bodyText =
    body && typeof body === "object"
      ? JSON.stringify(body, null, 2).slice(0, 6000)
      : String(body ?? "(empty)").slice(0, 6000);
  const base =
    `INSTRUCTION:\n${instruction}\n\n` +
    `INTERCEPTED REQUEST:\n` +
    `  url: ${String(req.url ?? "")}\n` +
    `  method: ${String(req.method ?? "")}\n` +
    `  body:\n${bodyText}\n`;
  if (rubric === "lenient") return base;
  return base + `${contextText(judgeContext)}\n`;
}

async function callJudgeModel(
  cfg: ClawBenchModelConfig,
  system: string,
  user: string,
): Promise<string> {
  const response = await generateText({
    model: getClawBenchLanguageModel(cfg),
    system,
    prompt: user,
    maxOutputTokens: cfg.max_tokens ?? 800,
    temperature: cfg.temperature ?? 0,
  });
  return response.text;
}

export function parseClawBenchJudgeVerdict(
  raw: string,
  rubric: "lenient" | "strict",
): { match: boolean | null; reason: string } {
  const trimmed = raw
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/```$/, "");
  try {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    const parsed = JSON.parse(trimmed.slice(start, end + 1)) as {
      match?: unknown;
      reason?: unknown;
    };
    if (typeof parsed.match === "boolean") {
      return { match: parsed.match, reason: String(parsed.reason ?? "") };
    }
  } catch {
    // fall through
  }
  if (rubric === "lenient") {
    return { match: true, reason: raw.slice(0, 200) };
  }
  return { match: null, reason: raw.slice(0, 200) || "unparseable" };
}

export async function judgeClawBenchInterception(input: {
  modelConfig: ClawBenchModelConfig;
  judgeModelName: string;
  instruction: string;
  interception: Record<string, unknown>;
  judgeContext?: Record<string, unknown>;
  rubric?: "lenient" | "strict";
}): Promise<ClawBenchJudgeVerdict> {
  const rubric = input.rubric ?? "lenient";
  const system = rubric === "strict" ? STRICT_SYSTEM : LENIENT_SYSTEM;
  const user = buildUserMessage(
    input.instruction,
    input.interception,
    input.judgeContext,
    rubric,
  );

  try {
    const raw = await callJudgeModel(input.modelConfig, system, user);
    const parsed = parseClawBenchJudgeVerdict(raw, rubric);
    return {
      match: parsed.match,
      reason: parsed.reason,
      judge_model: input.judgeModelName,
      raw: raw.slice(0, 500),
      error: null,
      rubric,
    };
  } catch (error) {
    return {
      match: null,
      reason: `judge_call_failed: ${error instanceof Error ? error.message : String(error)}`,
      judge_model: input.judgeModelName,
      raw: null,
      error: error instanceof Error ? error.message : String(error),
      rubric,
    };
  }
}
