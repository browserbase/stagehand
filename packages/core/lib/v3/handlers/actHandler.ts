// lib/v3/handlers/actHandler.ts
import { act as actInference } from "../../inference";
import { buildActPrompt, buildStepTwoPrompt } from "../../prompt";
import { trimTrailingTextNode } from "../../utils";
import { v3Logger } from "../logger";
import { ActHandlerParams } from "../types/private/handlers";
import { ActResult, Action, V3FunctionName } from "../types/public/methods";
import {
  captureHybridSnapshot,
  diffCombinedTrees,
} from "../understudy/a11y/snapshot";
import { LLMClient } from "../llm/LLMClient";
import { SupportedPlaywrightAction } from "../types/private";
import { EncodedId } from "../types/private/internal";
import {
  AvailableModel,
  ClientOptions,
  ModelConfiguration,
} from "../types/public/model";
import type { Page } from "../understudy/page";
import {
  performUnderstudyMethod,
  waitForDomNetworkQuiet,
} from "./handlerUtils/actHandlerUtils";

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

  async act(params: ActHandlerParams): Promise<ActResult> {
    const { instruction, page, variables, timeout, model } = params;

    const llmClient = this.resolveLlmClient(model);

    const doObserveAndAct = async (): Promise<ActResult> => {
      await waitForDomNetworkQuiet(
        page.mainFrame(),
        this.defaultDomSettleTimeoutMs,
      );
      const snapshot = await captureHybridSnapshot(page as Page, {
        experimental: true,
      });
      const combinedTree = snapshot.combinedTree;
      const combinedXpathMap = (snapshot.combinedXpathMap ?? {}) as Record<
        EncodedId,
        string
      >;

      const observeActInstruction = buildActPrompt(
        instruction,
        Object.values(SupportedPlaywrightAction),
        variables,
      );

      // Always ask for an action
      const actInferenceResponse = await actInference({
        instruction: observeActInstruction,
        domElements: combinedTree,
        llmClient,
        userProvidedInstructions: this.systemPrompt,
        logger: v3Logger,
        logInferenceToFile: this.logInferenceToFile,
      });

      // Update ACT metrics from the LLM observation call
      const actPromptTokens = actInferenceResponse.prompt_tokens ?? 0;
      const actCompletionTokens = actInferenceResponse.completion_tokens ?? 0;
      const actReasoningTokens = actInferenceResponse.reasoning_tokens ?? 0;
      const actCachedInputTokens =
        actInferenceResponse.cached_input_tokens ?? 0;
      const actInferenceTimeMs = actInferenceResponse.inference_time_ms ?? 0;
      this.onMetrics?.(
        V3FunctionName.ACT,
        actPromptTokens,
        actCompletionTokens,
        actReasoningTokens,
        actCachedInputTokens,
        actInferenceTimeMs,
      );

      // Normalize single LLM element → Action
      const raw = actInferenceResponse.element as
        | {
            elementId: string;
            description: string;
            method: string;
            arguments: string[];
          }
        | undefined;

      const result: Action | undefined = (() => {
        if (!raw) return undefined;
        const { elementId, description, method, arguments: args } = raw;
        if (!method || method === "not-supported" || !Array.isArray(args)) {
          return undefined;
        }
        if (typeof elementId === "string" && elementId.includes("-")) {
          const xp = combinedXpathMap[elementId as EncodedId];
          const trimmed = trimTrailingTextNode(xp);
          if (!trimmed) return undefined;
          return {
            description,
            method,
            arguments: args,
            selector: `xpath=${trimmed}`,
          } as Action;
        }
        // shadow-root path not supported here (match old behavior)
        return undefined;
      })();

      if (!result) {
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

      // Use the first observed element and substitute variables
      const chosen: Action = { ...result } as Action;
      if (variables && Array.isArray(chosen.arguments)) {
        chosen.arguments = chosen.arguments.map((arg: string) => {
          let out = arg;
          for (const [k, v] of Object.entries(variables)) {
            const token = `%${k}%`;
            out = out.split(token).join(String(v));
          }
          return out;
        });
      }

      // First action (self-heal aware path)
      const firstResult = await this.actFromObserveResult(
        chosen,
        page as Page,
        this.defaultDomSettleTimeoutMs,
        llmClient,
      );

      // If not two-step, return the first action result
      const twoStep = !!(
        actInferenceResponse as unknown as { twoStep?: boolean }
      ).twoStep;
      if (!twoStep) {
        return firstResult;
      }

      // Take a new focused snapshot and observe again
      const secondSnapshot = await captureHybridSnapshot(page as Page, {
        experimental: true,
      });
      const combinedTree2 = secondSnapshot.combinedTree;

      let diffedTree = diffCombinedTrees(combinedTree, combinedTree2);
      if (!diffedTree.trim()) {
        // Fallback: if no diff detected, use the fresh tree to avoid empty context
        diffedTree = combinedTree2;
      }

      const combinedXpathMap2 = (secondSnapshot.combinedXpathMap ??
        {}) as Record<EncodedId, string>;

      const previousAction = `method: ${chosen.method}, description: ${chosen.description}, arguments: ${chosen.arguments}`;

      const stepTwoInstructions = buildStepTwoPrompt(
        instruction,
        previousAction,
        Object.values(SupportedPlaywrightAction).filter(
          (
            action,
          ): action is Exclude<
            SupportedPlaywrightAction,
            SupportedPlaywrightAction.SELECT_OPTION_FROM_DROPDOWN
          > => action !== SupportedPlaywrightAction.SELECT_OPTION_FROM_DROPDOWN,
        ),
        variables,
      );

      const action2 = await actInference({
        instruction: stepTwoInstructions,
        domElements: diffedTree,
        llmClient,
        userProvidedInstructions: this.systemPrompt,
        logger: v3Logger,
        logInferenceToFile: this.logInferenceToFile,
      });
      // Update ACT metrics for the second observation call
      this.onMetrics?.(
        V3FunctionName.ACT,
        action2.prompt_tokens ?? 0,
        action2.completion_tokens ?? 0,
        action2.reasoning_tokens ?? 0,
        action2.cached_input_tokens ?? 0,
        action2.inference_time_ms ?? 0,
      );

      const raw2 = action2.element as
        | {
            elementId: string;
            description: string;
            method?: string;
            arguments?: string[];
          }
        | undefined;

      const result2: Action | undefined = (() => {
        if (!raw2) return undefined;
        const { elementId, description, method, arguments: args } = raw2;
        if (!method || method === "not-supported" || !Array.isArray(args)) {
          return undefined;
        }
        if (typeof elementId === "string" && elementId.includes("-")) {
          const xp = combinedXpathMap2[elementId as EncodedId];
          const trimmed = trimTrailingTextNode(xp);
          if (!trimmed) return undefined;
          return {
            description,
            method,
            arguments: args,
            selector: `xpath=${trimmed}`,
          } as Action;
        }
        return undefined;
      })();

      if (!result2) {
        // No second action found — return first result as-is
        return firstResult;
      }

      const chosen2: Action = { ...result2 } as Action;
      // Carry forward variables substitution for step 2 as well
      if (variables && Array.isArray(chosen2.arguments)) {
        chosen2.arguments = chosen2.arguments.map((arg: string) => {
          let out = arg;
          for (const [k, v] of Object.entries(variables)) {
            const token = `%${k}%`;
            out = out.split(token).join(String(v));
          }
          return out;
        });
      }

      const secondResult = await this.actFromObserveResult(
        chosen2,
        page as Page,
        this.defaultDomSettleTimeoutMs,
        llmClient,
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
    };

    // Hard timeout for entire act() call → reject on timeout (align with extract/observe)
    if (!timeout) {
      return doObserveAndAct();
    }

    return await Promise.race([
      doObserveAndAct(),
      new Promise<ActResult>((_, reject) => {
        setTimeout(
          () => reject(new Error(`act() timed out after ${timeout}ms`)),
          timeout,
        );
      }),
    ]);
  }

  async actFromObserveResult(
    action: Action,
    page: Page,
    domSettleTimeoutMs?: number,
    llmClientOverride?: LLMClient,
  ): Promise<ActResult> {
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

    const args = Array.isArray(action.arguments) ? action.arguments : [];

    try {
      await performUnderstudyMethod(
        page,
        page.mainFrame(),
        method,
        action.selector,
        args,
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
            arguments: args,
          },
        ],
      };
    } catch (err) {
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
          const snapshot = await captureHybridSnapshot(page as Page, {
            experimental: true,
          });
          const combinedTree = snapshot.combinedTree;

          const instruction = buildActPrompt(
            actCommand,
            Object.values(SupportedPlaywrightAction),
            {},
          );

          const actInferenceResponse = await actInference({
            instruction,
            domElements: combinedTree,
            llmClient: effectiveClient,
            userProvidedInstructions: this.systemPrompt,
            logger: v3Logger,
            logInferenceToFile: this.logInferenceToFile,
          });

          // Update ACT metrics with the retry observation
          this.onMetrics?.(
            V3FunctionName.ACT,
            actInferenceResponse.prompt_tokens ?? 0,
            actInferenceResponse.completion_tokens ?? 0,
            actInferenceResponse.reasoning_tokens ?? 0,
            actInferenceResponse.cached_input_tokens ?? 0,
            actInferenceResponse.inference_time_ms ?? 0,
          );

          const fallback = actInferenceResponse.element;
          if (!fallback) {
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
          if (typeof fallback.elementId === "string") {
            const enc = fallback.elementId as EncodedId;
            const rawXp = (snapshot.combinedXpathMap ?? {})[enc];
            const trimmed = trimTrailingTextNode(rawXp);
            if (trimmed) newSelector = `xpath=${trimmed}`;
          }

          await performUnderstudyMethod(
            page,
            page.mainFrame(),
            method,
            newSelector,
            args,
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
                arguments: args,
              },
            ],
          };
        } catch (retryErr) {
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
