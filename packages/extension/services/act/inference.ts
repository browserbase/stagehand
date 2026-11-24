import type {
  Action,
  ClientModelReference,
  ModelConfig,
} from "@browserbasehq/stagehand-protocol/types";
import * as inference from "../../inference.js";
import type { ClientLlmRequest } from "../../llm/clientLlmClient.js";
import type { GatewayContext } from "../../llm/gatewayClient.js";
import type { StagehandLogger } from "../../logger.js";
import { SupportedUnderstudyAction } from "../../types/private/handlers.js";
import type { EncodedId } from "../../types/private/internal.js";
import type { HybridSnapshot } from "../../types/private/snapshot.js";
import type { Page } from "../../understudy/page.js";
import type { Progress } from "../../understudy/progress.js";
import { trimTrailingTextNode } from "../../utils.js";
import type { DecisionsConfig } from "../decisions/config.js";
import { fallbackTargets } from "../decisions/fallbackTargets.js";
import * as llmService from "../llmService.js";

export type ActInferenceResponse = Awaited<ReturnType<typeof inference.act>>;
type ActInferenceElement = NonNullable<ActInferenceResponse["element"]>;

export type ActInferenceContext = {
  page: Page;
  model: ModelConfig | ClientModelReference | undefined;
  clientLLMGenerate: ClientLlmRequest;
  logger: StagehandLogger;
  systemPrompt: string;
  progress: Progress;
  gateway?: GatewayContext;
  decisions?: DecisionsConfig;
  recordUsage: (response: ActInferenceResponse) => void;
};

export async function getActionFromLLM({
  instruction,
  domElements,
  snapshot,
  context,
  checkPreviousAction,
}: {
  checkPreviousAction?: boolean;
  instruction: string;
  domElements: string;
  snapshot: HybridSnapshot;
  context: ActInferenceContext;
}): Promise<{
  action?: Action;
  expectedElementId?: string;
  expectedDestinationElementId?: string;
  response: ActInferenceResponse;
}> {
  const xpathMap = snapshot.combinedXpathMap;
  const targets = context.decisions
    ? fallbackTargets(domElements, snapshot, context.page, context.progress)
    : undefined;
  const facts = targets
    ? await context.progress.run("reading fallback action evidence", () =>
        targets.read(targets.physicalIds.values()),
      )
    : undefined;
  const response = await context.progress.run("waiting for act inference", () =>
    inference.act({
      instruction,
      domElements,
      checkPreviousAction,
      generate: (input) => {
        context.progress.throwIfStopped();
        return llmService.generate(
          context.model,
          input,
          context.clientLLMGenerate,
          context.gateway,
        );
      },
      userProvidedInstructions: context.systemPrompt,
    }),
  );
  context.recordUsage(response);

  context.logger.info("Act inference completed", {
    category: "action",
    promptTokens: response.prompt_tokens,
    completionTokens: response.completion_tokens,
    reasoningTokens: response.reasoning_tokens,
    cachedInputTokens: response.cached_input_tokens,
    inferenceTimeMs: response.inference_time_ms,
  });

  if (response.previousActionCompletedRequest) return { response };
  const action = response.element
    ? normalizeActInferenceElement(
        response.element,
        targets?.offeredPaths ?? xpathMap,
        context.logger,
      )
    : undefined;
  if (!action || !response.element) return { response };
  if (!targets || !facts) return { action, response };
  const expectedElementId = targets.physicalIds.get(response.element.elementId);
  const isDrag = action.method === SupportedUnderstudyAction.DRAG_AND_DROP;
  const expectedDestinationElementId = isDrag
    ? targets.physicalIds.get(response.element.arguments[0] ?? "")
    : undefined;
  if (!expectedElementId || (isDrag && !expectedDestinationElementId)) return { response };
  const ids = expectedDestinationElementId
    ? [expectedElementId, expectedDestinationElementId]
    : [expectedElementId];
  if (ids.some((id) => !facts[id])) return { response };
  const current = await context.progress.run("revalidating fallback action evidence", () =>
    targets.read(ids),
  );
  if (ids.some((id) => JSON.stringify(current[id]) !== JSON.stringify(facts[id])))
    return { response };
  return { action, expectedElementId, expectedDestinationElementId, response };
}

function normalizeActInferenceElement(
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
