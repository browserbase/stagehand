// lib/v3/handlers/actHandler.ts
import { act as actInference } from "../../inference.js";
import { buildActPrompt, buildStepTwoPrompt } from "../../prompt.js";
import { trimTrailingTextNode } from "../../utils.js";
import { v3Logger } from "../logger.js";
import { ActHandlerParams } from "../types/private/handlers.js";
import { ActResult, Action, V3FunctionName } from "../types/public/methods.js";
import { ActTimeoutError } from "../types/public/sdkErrors.js";
import {
  captureHybridSnapshot,
  diffCombinedTrees,
} from "../understudy/a11y/snapshot/index.js";
import { LLMClient } from "../llm/LLMClient.js";
import { SupportedUnderstudyAction } from "../types/private/index.js";
import { EncodedId } from "../types/private/internal.js";
import {
  AvailableModel,
  ClientOptions,
  ModelConfiguration,
} from "../types/public/model.js";
import type { Variables } from "../types/public/agent.js";
import type { Page } from "../understudy/page.js";
import {
  performUnderstudyMethod,
  waitForDomNetworkQuiet,
} from "./handlerUtils/actHandlerUtils.js";
import { createTimeoutGuard } from "./handlerUtils/timeoutGuard.js";
import { resolveVariableValue } from "../agent/utils/variables.js";

type ActInferenceElement = {
  elementId?: string;
  description: string;
  method?: string;
  arguments?: string[];
};

type ActInferenceResponse = Awaited<ReturnType<typeof actInference>>;

export class ActHandler {
  private readonly llmClient: LLMClient;
  private readonly defaultModelName: AvailableModel;
  private readonly defaultClientOptions: ClientOptions;
  private readonly resolveLlmClient: (model?: ModelConfiguration) => LLMClient;
  private readonly systemPrompt: string;
  private readonly logInferenceToFile: boolean;
  private readonly selfHeal: boolean;
  private readonly onMetrics?: (
    functionName: V3FunctionName,
    promptTokens: number,
    completionTokens: number,
    reasoningTokens: number,
    cachedInputTokens: number,
    inferenceTimeMs: number,
  ) => void;
  private readonly defaultDomSettleTimeoutMs?: number;

  constructor(
    llmClient: LLMClient,
    defaultModelName: AvailableModel,
    defaultClientOptions: ClientOptions,
    resolveLlmClient: (model?: ModelConfiguration) => LLMClient,
    systemPrompt?: string,
    logInferenceToFile?: boolean,
    selfHeal?: boolean,
    onMetrics?: (
      functionName: V3FunctionName,
      promptTokens: number,
      completionTokens: number,
      reasoningTokens: number,
      cachedInputTokens: number,
      inferenceTimeMs: number,
    ) => void,
    defaultDomSettleTimeoutMs?: number,
  ) {
    this.llmClient = llmClient;
    this.defaultModelName = defaultModelName;
    this.defaultClientOptions = defaultClientOptions;
    this.resolveLlmClient = resolveLlmClient;
    this.systemPrompt = systemPrompt ?? "";
    this.logInferenceToFile = logInferenceToFile ?? false;
    this.selfHeal = !!selfHeal;
    this.onMetrics = onMetrics;
    this.defaultDomSettleTimeoutMs = defaultDomSettleTimeoutMs;
  }

  private recordActMetrics(response: ActInferenceResponse): void {
    this.onMetrics?.(
      V3FunctionName.ACT,
      response.prompt_tokens ?? 0,
      response.completion_tokens ?? 0,
      response.reasoning_tokens ?? 0,
      response.cached_input_tokens ?? 0,
      response.inference_time_ms ?? 0,
    );
  }

  private async getActionFromLLM({
    instruction,
    domElements,
    xpathMap,
    llmClient,
    requireMethodAndArguments = true,
  }: {
    instruction: string;
    domElements: string;
    xpathMap: Record<string, string>;
    llmClient: LLMClient;
    requireMethodAndArguments?: boolean;
  }): Promise<{ action?: Action; response: ActInferenceResponse }> {
    const response = await actInference({
      instruction,
      domElements,
      llmClient,
      userProvidedInstructions: this.systemPrompt,
      logger: v3Logger,
      logInferenceToFile: this.logInferenceToFile,
    });

    this.recordActMetrics(response);

    const normalized = normalizeActInferenceElement(
      response.element as ActInferenceElement | undefined,
      xpathMap,
      requireMethodAndArguments,
    );

    if (!normalized) {
      return { response };
    }

    return {
      action: { ...normalized } as Action,
      response,
    };
  }

  async act(params: ActHandlerParams): Promise<ActResult> {
    const { instruction, page, variables, timeout, model } = params;

    const llmClient = this.resolveLlmClient(model);
    const effectiveTimeoutMs =
      typeof timeout === "number" && timeout > 0 ? timeout : undefined;

    const ensureTimeRemaining = createTimeoutGuard(
      effectiveTimeoutMs,
      (ms) => new ActTimeoutError(ms),
    );

    ensureTimeRemaining();
    await waitForDomNetworkQuiet(
      page.mainFrame(),
      this.defaultDomSettleTimeoutMs,
    );
    ensureTimeRemaining();
    const { combinedTree, combinedXpathMap } = await captureHybridSnapshot(
      page,
      { experimental: true },
    );

    const actInstruction = buildActPrompt(
      instruction,
      Object.values(SupportedUnderstudyAction),
      variables,
    );

    ensureTimeRemaining();
    const { action: firstAction, response: actInferenceResponse } =
      await this.getActionFromLLM({
        instruction: actInstruction,
        domElements: combinedTree,
        xpathMap: combinedXpathMap,
        llmClient,
      });

    if (!firstAction) {
      v3Logger({
        category: "action",
        message: "no actionable element returned by LLM",
        level: 1,
      });
      return {
        success: false,
        message: "Failed to perform act: No action found",
        actionDescription: instruction,
        actions: [],
      };
    }

    // First action (self-heal aware path)
    ensureTimeRemaining();
    const firstResult = await this.takeDeterministicAction(
      firstAction,
      page,
      this.defaultDomSettleTimeoutMs,
      llmClient,
      ensureTimeRemaining,
      variables,
    );

    // If not two-step, return the first action result
    if (actInferenceResponse?.twoStep !== true) {
      return firstResult;
    }

    // Take a new focused snapshot and observe again
    ensureTimeRemaining();
    const { combinedTree: combinedTree2, combinedXpathMap: combinedXpathMap2 } =
      await captureHybridSnapshot(page, {
        experimental: true,
      });

    let diffedTree = diffCombinedTrees(combinedTree, combinedTree2);
    if (!diffedTree.trim()) {
      // Fallback: if no diff detected, use the fresh tree to avoid empty context
      diffedTree = combinedTree2;
    }

    const previousAction = `method: ${firstAction.method}, description: ${firstAction.description}, arguments: ${firstAction.arguments}`;

    const stepTwoInstructions = buildStepTwoPrompt(
      instruction,
      previousAction,
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
    const { action: secondAction } = await this.getActionFromLLM({
      instruction: stepTwoInstructions,
      domElements: diffedTree,
      xpathMap: combinedXpathMap2,
      llmClient,
    });

    if (!secondAction) {
      // No second action found — return first result as-is
      return firstResult;
    }

    ensureTimeRemaining();
    const secondResult = await this.takeDeterministicAction(
      secondAction,
      page,
      this.defaultDomSettleTimeoutMs,
      llmClient,
      ensureTimeRemaining,
      variables,
    );

    // Combine results
    return {
      success: firstResult.success && secondResult.success,
      message: secondResult.success
        ? `${firstResult.message} → ${secondResult.message}`
        : `${firstResult.message} → ${secondResult.message}`,
      actionDescription: firstResult.actionDescription,
      actions: [
        ...(firstResult.actions || []),
        ...(secondResult.actions || []),
      ],
    };
  }

  async takeDeterministicAction(
    action: Action,
    page: Page,
    domSettleTimeoutMs?: number,
    llmClientOverride?: LLMClient,
    ensureTimeRemaining?: () => void,
    variables?: Variables,
  ): Promise<ActResult> {
    ensureTimeRemaining?.();
    const settleTimeout = domSettleTimeoutMs ?? this.defaultDomSettleTimeoutMs;
    const effectiveClient = llmClientOverride ?? this.llmClient;
    const method = action.method?.trim();
    if (!method || method === "not-supported") {
      v3Logger({
        category: "action",
        message: "action has no supported method",
        level: 0,
        auxiliary: {
          act: { value: JSON.stringify(action), type: "object" },
        },
      });
      return {
        success: false,
        message: `Unable to perform action: The method '${method ?? ""}' is not supported in Action. Please use a supported Playwright locator method.`,
        actionDescription:
          action.description || `Action (${method ?? "unknown"})`,
        actions: [],
      };
    }

    const placeholderArgs = Array.isArray(action.arguments)
      ? [...action.arguments]
      : [];
    const resolvedArgs =
      substituteVariablesInArguments(action.arguments, variables) ?? [];

    try {
      ensureTimeRemaining?.();
      await performUnderstudyMethod(
        page,
        page.mainFrame(),
        method,
        action.selector,
        resolvedArgs,
        settleTimeout,
      );
      return {
        success: true,
        message: `Action [${method}] performed successfully on selector: ${action.selector}`,
        actionDescription: action.description || `action (${method})`,
        actions: [
          {
            selector: action.selector,
            description: action.description || `action (${method})`,
            method,
            arguments: placeholderArgs,
          },
        ],
      };
    } catch (err) {
      if (err instanceof ActTimeoutError) {
        throw err;
      }
      const msg = err instanceof Error ? err.message : String(err);

      // Attempt self-heal: rerun actInference and retry with updated selector
      if (this.selfHeal) {
        v3Logger({
          category: "action",
          message:
            "Error performing action. Reprocessing the page and trying again",
          level: 1,
          auxiliary: {
            error: { value: msg, type: "string" },
            action: {
              value: JSON.stringify(action),
              type: "object",
            },
          },
        });

        try {
          // Build an instruction combining method + description, avoiding duplication
          const actCommand = action.description
            ? action.description.toLowerCase().startsWith(method.toLowerCase())
              ? action.description
              : `${method} ${action.description}`
            : method;

          // Take a fresh snapshot and ask for a new actionable element
          ensureTimeRemaining?.();
          const { combinedTree, combinedXpathMap } =
            await captureHybridSnapshot(page, {
              experimental: true,
            });

          const instruction = buildActPrompt(
            actCommand,
            Object.values(SupportedUnderstudyAction),
            {},
          );

          ensureTimeRemaining?.();
          const { action: fallbackAction, response: fallbackResponse } =
            await this.getActionFromLLM({
              instruction,
              domElements: combinedTree,
              xpathMap: combinedXpathMap,
              llmClient: effectiveClient,
              requireMethodAndArguments: false,
            });

          const fallbackElement = fallbackResponse.element;
          if (!fallbackElement) {
            return {
              success: false,
              message:
                "Failed to self-heal act: No observe results found for action",
              actionDescription: actCommand,
              actions: [],
            };
          }

          // Retry with original method/args but new selector from fallback
          let newSelector = action.selector;
          if (fallbackAction?.selector) {
            newSelector = fallbackAction.selector;
          }

          ensureTimeRemaining?.();
          await performUnderstudyMethod(
            page,
            page.mainFrame(),
            method,
            newSelector,
            resolvedArgs,
            settleTimeout,
          );

          return {
            success: true,
            message: `Action [${method}] performed successfully on selector: ${newSelector}`,
            actionDescription: action.description || `action (${method})`,
            actions: [
              {
                selector: newSelector,
                description: action.description || `action (${method})`,
                method,
                arguments: placeholderArgs,
              },
            ],
          };
        } catch (retryErr) {
          if (retryErr instanceof ActTimeoutError) {
            throw retryErr;
          }
          const retryMsg =
            retryErr instanceof Error ? retryErr.message : String(retryErr);
          return {
            success: false,
            message: `Failed to perform act after self-heal: ${retryMsg}`,
            actionDescription: action.description || `action (${method})`,
            actions: [],
          };
        }
      }

      return {
        success: false,
        message: `Failed to perform act: ${msg}`,
        actionDescription: action.description || `action (${method})`,
        actions: [],
      };
    }
  }
}

function normalizeActInferenceElement(
  element: ActInferenceElement | undefined,
  xpathMap: Record<string, string>,
  requireMethodAndArguments = true,
): Action | undefined {
  if (!element) {
    return undefined;
  }
  const { elementId, description, method, arguments: args } = element;
  const hasArgs = Array.isArray(args);

  if (
    requireMethodAndArguments &&
    (!method || method === "not-supported" || !hasArgs)
  ) {
    return undefined;
  }

  if (typeof elementId !== "string" || !elementId.includes("-")) {
    return undefined;
  }

  const xp = xpathMap[elementId as EncodedId];
  const trimmed = trimTrailingTextNode(xp);
  if (!trimmed) {
    return undefined;
  }

  // For dragAndDrop, convert element ID in arguments to xpath (target element)
  let resolvedArgs = hasArgs ? args : undefined;
  if (method === "dragAndDrop" && hasArgs && args.length > 0) {
    const targetArg = args[0];
    // Check if argument looks like an element ID (e.g., "1-67")
    if (typeof targetArg === "string" && /^\d+-\d+$/.test(targetArg)) {
      const argXpath = xpathMap[targetArg as EncodedId];
      const trimmedArgXpath = trimTrailingTextNode(argXpath);
      if (trimmedArgXpath) {
        resolvedArgs = [`xpath=${trimmedArgXpath}`, ...args.slice(1)];
      } else {
        // Target element lookup failed, filter out this action
        v3Logger({
          category: "action",
          message: "dragAndDrop target element lookup failed",
          level: 1,
          auxiliary: {
            targetElementId: { value: targetArg, type: "string" },
            sourceElementId: { value: elementId, type: "string" },
          },
        });
        return undefined;
      }
    } else {
      v3Logger({
        category: "action",
        message: "dragAndDrop target element invalid ID format",
        level: 0,
        auxiliary: {
          targetElementId: { value: String(targetArg), type: "string" },
          sourceElementId: { value: elementId, type: "string" },
        },
      });
      return undefined;
    }
  }

  return {
    description,
    method,
    arguments: resolvedArgs,
    selector: `xpath=${trimmed}`,
  } as Action;
}

function substituteVariablesInArguments(
  args: string[] | undefined,
  variables?: Variables,
): string[] | undefined {
  if (!variables || !Array.isArray(args)) {
    return args;
  }

  return args.map((arg: string) => {
    let out = arg;
    for (const [key, v] of Object.entries(variables)) {
      const token = `%${key}%`;
      out = out.split(token).join(resolveVariableValue(v));
    }
    return out;
  });
}
