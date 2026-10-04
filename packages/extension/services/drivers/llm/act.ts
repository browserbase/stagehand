import type { Action } from "@browserbasehq/stagehand-protocol/types";
import * as inference from "../../../inference.js";
import type { StagehandLogger } from "../../../logger.js";
import { buildActPrompt, buildStepTwoPrompt } from "../../../prompt.js";
import { SupportedUnderstudyAction } from "../../../types/private/handlers.js";
import type { EncodedId } from "../../../types/private/internal.js";
import { diffCombinedTrees } from "../../../understudy/a11y/snapshot/index.js";
import { trimTrailingTextNode } from "../../../utils.js";
import type { ActDriver, ActRequest, ActResolution, LlmPort } from "../types.js";

type ActInferenceResponse = Awaited<ReturnType<typeof inference.act>>;
type ActInferenceElement = NonNullable<ActInferenceResponse["element"]>;

// Set high on purpose: on ordinary pages a shortlist cost accuracy (the model lost the context
// that disambiguates), so it is reserved for huge trees where the full-page call is slow and
// expensive.
const FOCUS_MIN_TREE_CHARS = 120_000;

/**
 * act() by language model: one inference over the page outline picks the element and method,
 * and a second one finishes two-step widgets (open the dropdown, then choose).
 */
export function llmActDriver(): ActDriver {
  return {
    name: "llm",
    startsBeforeSettle: false,
    async resolve(request, handoff) {
      const { instruction, variables, page, snapshotOptions, ensureTimeRemaining, logger } =
        request;
      await request.settled;
      const { combinedTree, combinedXpathMap } = await page.captureSnapshot(snapshotOptions);
      const prompt = buildActPrompt(
        instruction,
        Object.values(SupportedUnderstudyAction),
        variables,
      );

      // An earlier driver shortlisted a handful of elements on a big page: look at those (with
      // ancestors and subtrees) first, and only pay for the whole tree if nothing is found.
      let first: InferredAction | undefined;
      const focused =
        handoff?.focus && combinedTree.length > FOCUS_MIN_TREE_CHARS
          ? handoff.focus(combinedTree)
          : "";
      if (focused.trim() && focused.length < combinedTree.length / 2) {
        ensureTimeRemaining();
        const attempt = await inferAction(request, prompt, focused, combinedXpathMap);
        logger.info("Act inference over the handed-over shortlist", {
          category: "action",
          focusedChars: focused.length,
          fullChars: combinedTree.length,
          found: Boolean(attempt.action),
        });
        if (attempt.action) first = attempt;
      }

      ensureTimeRemaining();
      first ??= await inferAction(request, prompt, combinedTree, combinedXpathMap);
      if (!first.action) {
        logger.info("No actionable element returned by the LLM", { category: "action" });
        return resolved({
          success: false,
          message: "Failed to perform act: No action found",
          actionDescription: instruction,
          actions: [],
        });
      }

      ensureTimeRemaining();
      const firstResult = await request.runAction(first.action);
      if (!first.response.twoStep) return resolved(firstResult);

      ensureTimeRemaining();
      const { combinedTree: nextTree, combinedXpathMap: nextXpathMap } =
        await page.captureSnapshot(snapshotOptions);
      const changedTree = diffCombinedTrees(combinedTree, nextTree);
      const secondPrompt = buildStepTwoPrompt(
        instruction,
        describeAction(first.action),
        Object.values(SupportedUnderstudyAction).filter(
          (
            action,
          ): action is Exclude<
            SupportedUnderstudyAction,
            SupportedUnderstudyAction.SELECT_OPTION_FROM_DROPDOWN
          > => action !== SupportedUnderstudyAction.SELECT_OPTION_FROM_DROPDOWN,
        ),
        variables,
      );

      ensureTimeRemaining();
      const second = await inferAction(
        request,
        secondPrompt,
        changedTree.trim() ? changedTree : nextTree,
        nextXpathMap,
      );
      if (!second.action) return resolved(firstResult);

      ensureTimeRemaining();
      const secondResult = await request.runAction(second.action);
      return resolved({
        success: firstResult.success && secondResult.success,
        message: `${firstResult.message} → ${secondResult.message}`,
        actionDescription: firstResult.actionDescription,
        actions: [...firstResult.actions, ...secondResult.actions],
      });
    },
  };
}

type InferredAction = { action?: Action; response: ActInferenceResponse };

/** One act inference over `domElements`, resolved to an action the page can perform. */
export async function inferAction(
  context: { llm: LlmPort; logger: StagehandLogger },
  instruction: string,
  domElements: string,
  xpathMap: Record<string, string>,
): Promise<InferredAction> {
  const response = await inference.act({
    instruction,
    domElements,
    generate: (input) => context.llm.generate(input),
    userProvidedInstructions: context.llm.systemPrompt,
  });
  context.llm.record(response);

  context.logger.info("Act inference completed", {
    category: "action",
    promptTokens: response.prompt_tokens,
    completionTokens: response.completion_tokens,
    reasoningTokens: response.reasoning_tokens,
    cachedInputTokens: response.cached_input_tokens,
    inferenceTimeMs: response.inference_time_ms,
  });

  const action = response.element
    ? actionFromElement(response.element, xpathMap, context.logger)
    : undefined;
  return action ? { action, response } : { response };
}

function resolved(result: ActRequestResult): ActResolution {
  return { kind: "resolved", result, path: "llm", cacheable: true };
}

type ActRequestResult = Awaited<ReturnType<ActRequest["runAction"]>>;

function actionFromElement(
  element: ActInferenceElement,
  xpathMap: Record<string, string>,
  logger: StagehandLogger,
): Action | undefined {
  const xpath = trimTrailingTextNode(xpathMap[element.elementId as EncodedId]);
  if (!xpath) return undefined;

  let args = element.arguments;
  if (element.method === SupportedUnderstudyAction.DRAG_AND_DROP && args.length > 0) {
    const targetElementId = args[0];
    if (!targetElementId || !/^\d+-\d+$/.test(targetElementId)) {
      logger.error("Drag-and-drop target element has an invalid ID format", {
        category: "action",
        targetElementId: targetElementId ?? "",
        sourceElementId: element.elementId,
      });
      return undefined;
    }

    const targetXpath = trimTrailingTextNode(xpathMap[targetElementId as EncodedId]);
    if (!targetXpath) {
      logger.debug("Drag-and-drop target element lookup failed", {
        category: "action",
        targetElementId,
        sourceElementId: element.elementId,
      });
      return undefined;
    }
    args = [`xpath=${targetXpath}`, ...args.slice(1)];
  }

  return {
    selector: `xpath=${xpath}`,
    description: element.description,
    method: element.method,
    arguments: args,
  };
}

function describeAction(action: Action): string {
  return `method: ${action.method}, description: ${action.description}, arguments: ${action.arguments?.join(", ") ?? ""}`;
}
