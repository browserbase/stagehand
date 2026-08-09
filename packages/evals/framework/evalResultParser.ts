/**
 * Shared EVAL_RESULT parsing for the bare-loop / cursor_sdk runners. All four
 * ask the agent for the same trailing marker line + JSON schema
 * ({success, summary, finalAnswer}) that claudeCodeRunner/codexRunner also
 * use, so the parsing logic is centralized here instead of re-forked four
 * times. This self-report only backstops the non-verifier path
 * (`gradeExternalTrajectory` overrides `_success` whenever a verifier runs).
 *
 * TODO(STG-2516): consolidate claudeCodeRunner.parseClaudeCodeResult and
 * codexRunner.parseCodexResult onto this module.
 */
export interface ParsedEvalResult {
  success: boolean;
  summary?: string;
  finalAnswer?: string;
  raw: string;
}

const EVAL_RESULT_MARKER = "EVAL_RESULT:";

export function buildEvalResultInstructions(): string {
  return [
    "At the end, print exactly one line beginning with EVAL_RESULT: followed by compact JSON.",
    'The JSON schema is: {"success": boolean, "summary": string, "finalAnswer": string}.',
  ].join("\n");
}

export function parseEvalResultText(raw: string): ParsedEvalResult {
  // Anchor to the last LINE that begins with the marker (the requested output
  // shape) so a summary/finalAnswer containing the literal "EVAL_RESULT:"
  // inside the JSON payload cannot hijack which text gets parsed.
  const lines = raw.split(/\r?\n/);
  let markerLine = -1;
  for (let i = lines.length - 1; i >= 0; i--) {
    if (lines[i].trimStart().startsWith(EVAL_RESULT_MARKER)) {
      markerLine = i;
      break;
    }
  }
  let candidates: Array<string | undefined>;
  if (markerLine >= 0) {
    const tail = lines.slice(markerLine).join("\n");
    const afterMarker = tail
      .slice(tail.indexOf(EVAL_RESULT_MARKER) + EVAL_RESULT_MARKER.length)
      .trim();
    candidates = [afterMarker, afterMarker.split(/\r?\n/, 1)[0]?.trim()];
  } else {
    candidates = [raw.trim()];
  }

  for (const candidate of candidates) {
    if (!candidate) continue;
    const parsed = tryParseEvalResultJson(candidate);
    if (parsed) return { ...parsed, raw };
  }

  return { success: false, raw };
}

function tryParseEvalResultJson(
  candidate: string,
): Omit<ParsedEvalResult, "raw"> | undefined {
  try {
    const parsed = JSON.parse(candidate) as {
      success?: unknown;
      summary?: unknown;
      finalAnswer?: unknown;
    };
    return {
      success: parsed.success === true,
      summary: typeof parsed.summary === "string" ? parsed.summary : undefined,
      finalAnswer:
        typeof parsed.finalAnswer === "string" ? parsed.finalAnswer : undefined,
    };
  } catch {
    return undefined;
  }
}
