import type { Action } from "@browserbasehq/stagehand-protocol/types";
import { diffCombinedTrees } from "../../../understudy/a11y/snapshot/index.js";
import { groundedSpan, quotedStrings } from "../args.js";
import { noulAnswer } from "../client.js";
import { blockingSignal, readPageState } from "../pageState.js";
import { annotate, ask, type Snapshot, type TargetResult } from "../pick.js";
import type { OutlineNode } from "../tree.js";
import { readInputValue } from "./domHints.js";
import { failure, fallback, focusIds } from "./outcomes.js";
import { snapshot, withoutQuery } from "./page.js";
import { isPointer, waitForClickable } from "./readiness.js";
import type { DecisionsActOutcome, Done, Fallback, PipelineContext } from "./types.js";
import { SCROLL_METHODS } from "./vocabulary.js";

/**
 * Performing the picked action and judging what happened: the pre-act guard, deterministic
 * checks, the effect probe behind the no-effect retry, and what to do when no target fits.
 */

const DIFF_BUDGET = 6000;

const PAGE_STATE_NONE = 0.5;

/** Text to type into a filter-as-you-type combobox: the quoted option, else an argument-only LLM call. */
export async function optionText(
  ctx: PipelineContext,
  control: OutlineNode,
): Promise<string | undefined> {
  const quoted = quotedStrings(ctx.instruction).filter(
    (value) => value.toLowerCase() !== control.name.toLowerCase(),
  );
  if (quoted.length === 1) return quoted[0];
  return (await extractText(ctx)) ?? undefined;
}

export function extractText(ctx: PipelineContext): Promise<string | null> | undefined {
  const extract = ctx.config.argumentLlm === false ? undefined : ctx.deps.extractText;
  if (!extract) return undefined;
  const startedAt = Date.now();
  return extract(ctx.instruction)
    .then((text) => {
      const span =
        text === null ? undefined : groundedSpan(text, ctx.instruction, ctx.deps.variables);
      ctx.trace.push({
        node: "extract_text_llm",
        ms: Date.now() - startedAt,
        found: text !== null,
        grounded: span !== undefined,
        recased: span !== undefined && span !== text?.trim(),
      });
      return span ?? null;
    })
    .catch((error: unknown) => {
      ctx.trace.push({
        node: "extract_text_llm",
        ms: Date.now() - startedAt,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    });
}

/**
 * No target was accepted. Before paying for the LLM, ask what kind of page
 * this is: on a bot wall nobody will find the element.
 */
export async function rejected(
  ctx: PipelineContext,
  snap: Snapshot,
  label: string,
  picked: TargetResult,
): Promise<DecisionsActOutcome> {
  let suffix = "";
  // Only when the decision model leaned toward "not on this page". A split between plausible
  // candidates is not a page problem, and the LLM should not wait for this.
  if (ctx.config.pageState !== false && picked.none >= PAGE_STATE_NONE) {
    try {
      const state = await readPageState(ctx, snap.nodes, withoutQuery(ctx.deps.page.url()));
      const blocked = blockingSignal(state);
      if (blocked) {
        return failure(
          ctx.instruction,
          `Failed to perform act: the page is blocked (${blocked.replace("_", " ")}), so the element cannot be reached`,
        );
      }
      const notable = Object.entries(state)
        .filter(([, score]) => score >= 0.7)
        .map(([signal]) => signal);
      if (notable.length > 0) suffix = `|page=${notable.join("+")}`;
    } catch (error) {
      ctx.trace.push({
        node: "page_state",
        ms: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return fallback(`${label}:${picked.reason}${suffix}`, undefined, focusIds(picked));
}

export async function act(
  ctx: PipelineContext,
  action: Action,
  options: { before?: Snapshot; expectedValue?: string; target?: OutlineNode } = {},
): Promise<Done | Fallback> {
  // Press and whole-page scroll get here without ever taking a snapshot.
  if (!ctx.ready) await ctx.deps.settled;
  // The settle wait is about the network, not about what a click would hit:
  // a consent overlay that arrives after load covers the target the pick
  // found. Re-validate right before input and give the cover a moment to go.
  if (ctx.config.targetReadiness && options.before && options.target && isPointer(action)) {
    await waitForClickable(ctx, options.before, options.target);
  }
  const urlBefore = ctx.deps.page.url();
  const pagesBefore = ctx.deps.openPageCount?.();
  ctx.deps.ensureTimeRemaining();
  const startedAt = Date.now();
  const result = await ctx.deps.takeAction(action);
  ctx.trace.push({
    node: "act",
    ms: Date.now() - startedAt,
    method: action.method ?? "",
    success: result.success,
  });
  if (!result.success) {
    return fallback(`action_failed:${(ctx.redact ?? ((text: string) => text))(result.message)}`);
  }
  ctx.performed.push(...result.actions);
  if (ctx.config.verify === "off") return { kind: "done", result };

  if (options.expectedValue !== undefined) {
    const readback = await readInputValue(ctx.deps, action.selector);
    ctx.trace.push({ node: "verify_readback", ms: 0, match: readback === options.expectedValue });
    if (readback !== undefined && readback !== options.expectedValue) {
      return fallback("fill_readback_mismatch");
    }
    return { kind: "done", result };
  }

  // Scroll position never shows up in the accessibility tree diff.
  const scrolls = Object.values(SCROLL_METHODS).includes(action.method ?? "");
  if (ctx.config.verify === "full" && options.before && !scrolls) {
    await verifyByDiff(ctx, options.before, action, urlBefore, pagesBefore);
  }
  return { kind: "done", result };
}

/**
 * Deterministic "nothing happened": same URL, same tab count, and an outline
 * identical in both directions (diffCombinedTrees alone only sees additions,
 * so a closed modal or a deleted row would look like no effect).
 */
export function beginEffectProbe(ctx: PipelineContext) {
  const urlBefore = ctx.deps.page.url();
  const pagesBefore = ctx.deps.openPageCount?.();
  return {
    /** The fresh snapshot when nothing changed, else undefined. */
    async unchanged(before: Snapshot): Promise<Snapshot | undefined> {
      try {
        if (ctx.deps.page.url() !== urlBefore) return undefined;
        if (pagesBefore !== undefined && ctx.deps.openPageCount?.() !== pagesBefore)
          return undefined;
        const after = await snapshot(ctx.deps);
        const same = normalizeTree(before.tree) === normalizeTree(after.tree);
        ctx.trace.push({ node: "effect_probe", ms: 0, changed: !same });
        return same ? after : undefined;
      } catch {
        // Out of time or the page went away: the action stands.
        return undefined;
      }
    },
  };
}

function normalizeTree(tree: string): string {
  return tree
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Logged only (verify: "full"): records the Noul so runs can measure its
 * calibration against the eval's own outcome, without changing the act result.
 */
async function verifyByDiff(
  ctx: PipelineContext,
  before: Snapshot,
  action: Action,
  urlBefore: string,
  pagesBefore: number | undefined,
): Promise<void> {
  try {
    // The action already succeeded; running out of time here must not undo that.
    try {
      ctx.deps.ensureTimeRemaining();
    } catch {
      ctx.trace.push({ node: "verify", ms: 0, skipped: "no_time_remaining" });
      return;
    }
    const after = await ctx.deps.page.captureSnapshot(ctx.deps.snapshotOptions);
    const changes = diffCombinedTrees(before.tree, after.combinedTree).slice(0, DIFF_BUDGET);
    const response = await ask(
      ctx,
      "verify",
      {
        instruction: ctx.instruction,
        action: `${action.method} ${action.description}`,
        url_before: withoutQuery(urlBefore),
        url_after: withoutQuery(ctx.deps.page.url()),
        new_tabs_opened:
          pagesBefore === undefined
            ? null
            : Math.max(0, (ctx.deps.openPageCount?.() ?? 0) - pagesBefore),
        page_changes: changes.trim() ? changes : "(no accessibility tree changes)",
      },
      {
        succeeded: {
          type: "noul",
          instructions:
            "After the action was performed, did the page change in the way the instruction intended?",
        },
      },
    );
    annotate(ctx.trace, { noul: noulAnswer(response, "succeeded").noul });
  } catch (error) {
    ctx.trace.push({
      node: "verify",
      ms: 0,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
