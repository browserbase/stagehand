// lib/v3/handlers/actHandler.ts
import { ActHandlerParams, V3FunctionName } from "@/lib/v3/types";
import { captureHybridSnapshot } from "@/lib/v3/understudy/a11y/snapshot";
import { observe } from "@/lib/inference";
import { v3Logger } from "@/lib/v3/logger";
import { LLMClient } from "../llm/LLMClient";
import { AvailableModel, ClientOptions } from "../types/model";
import { performUnderstudyMethod } from "./handlerUtils/actHandlerUtils";
import type { Page } from "../understudy/page";
import { trimTrailingTextNode } from "@/lib/utils";
import { EncodedId } from "../types/context";
import type { Action, ActResult } from "../types/stagehand";
import { buildActObservePrompt } from "@/lib/prompt";
import { SupportedPlaywrightAction } from "../types/act";

export class ActHandler {
  private readonly llmClient: LLMClient;
  private readonly defaultModelName: AvailableModel;
  private readonly defaultClientOptions: ClientOptions;
  private readonly systemPrompt: string;
  private readonly logInferenceToFile: boolean;
  private readonly selfHeal: boolean;
  private readonly onMetrics?: (
    functionName: V3FunctionName,
    promptTokens: number,
    completionTokens: number,
    inferenceTimeMs: number,
  ) => void;

  constructor(
    llmClient: LLMClient,
    defaultModelName: AvailableModel,
    defaultClientOptions: ClientOptions,
    systemPrompt?: string,
    logInferenceToFile?: boolean,
    selfHeal?: boolean,
    onMetrics?: (
      functionName: V3FunctionName,
      promptTokens: number,
      completionTokens: number,
      inferenceTimeMs: number,
    ) => void,
  ) {
    this.llmClient = llmClient;
    this.defaultModelName = defaultModelName;
    this.defaultClientOptions = defaultClientOptions;
    this.systemPrompt = systemPrompt ?? "";
    this.logInferenceToFile = logInferenceToFile ?? false;
    this.selfHeal = !!selfHeal;
    this.onMetrics = onMetrics;
  }

  async act(params: ActHandlerParams): Promise<ActResult> {
    const { instruction, page, variables, domSettleTimeoutMs, timeoutMs } =
      params;

    const doObserveAndAct = async (): Promise<ActResult> => {
      const snapshot = await captureHybridSnapshot(page as Page, {
        experimental: true,
      });
      const combinedTree = snapshot.combinedTree;
      const combinedXpathMap = (snapshot.combinedXpathMap ?? {}) as Record<
        EncodedId,
        string
      >;

      const observeActInstruction = buildActObservePrompt(
        instruction,
        Object.values(SupportedPlaywrightAction),
        variables,
      );

      const requestId =
        (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ??
        `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

      // Always ask for an action
      const observation = await observe({
        instruction: observeActInstruction,
        domElements: combinedTree,
        llmClient: this.llmClient,
        requestId,
        userProvidedInstructions: this.systemPrompt,
        logger: v3Logger,
        returnAction: true,
        logInferenceToFile: this.logInferenceToFile,
        fromAct: true,
      });

      // Update ACT metrics from the LLM observation call
      const actPromptTokens = observation.prompt_tokens ?? 0;
      const actCompletionTokens = observation.completion_tokens ?? 0;
      const actInferenceTimeMs = observation.inference_time_ms ?? 0;
      this.onMetrics?.(
        V3FunctionName.ACT,
        actPromptTokens,
        actCompletionTokens,
        actInferenceTimeMs,
      );

      // Normalize raw LLM elements → ObserveResult[] (reuse old type)
      const raw = (observation.elements ?? []) as Array<{
        elementId: string;
        description: string;
        method?: string;
        arguments?: string[];
      }>;

      const results: Action[] = raw
        .map((e) => {
          if (
            !e.method ||
            e.method === "not-supported" ||
            !Array.isArray(e.arguments)
          ) {
            return undefined;
          }
          // build selector from encoded id
          if (typeof e.elementId === "string" && e.elementId.includes("-")) {
            const xp = combinedXpathMap[e.elementId as EncodedId];
            const trimmed = trimTrailingTextNode(xp);
            if (!trimmed) return undefined;
            return {
              description: e.description,
              method: e.method,
              arguments: e.arguments,
              selector: `xpath=${trimmed}`,
            } as Action;
          }
          // shadow-root path not supported here (match old behavior)
          return undefined;
        })
        .filter((v): v is Action => v !== undefined);

      if (results.length === 0) {
        v3Logger({
          category: "action",
          message: "no actionable element returned by LLM",
          level: 1,
        });
        return {
          success: false,
          message: "Failed to perform act: No observe results found for action",
          actionDescription: instruction,
          actions: [],
        };
      }

      // Use the first observed element and substitute variables
      const chosen: Action = { ...results[0] } as Action;
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

      // Reuse self-heal aware path
      return this.actFromObserveResult(
        chosen,
        page as Page,
        domSettleTimeoutMs,
      );
    };

    // Hard timeout for entire act() call → reject on timeout (align with extract/observe)
    if (!timeoutMs) {
      return doObserveAndAct();
    }

    return await Promise.race([
      doObserveAndAct(),
      new Promise<ActResult>((_, reject) => {
        setTimeout(
          () => reject(new Error(`act() timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  }

  async actFromObserveResult(
    observeResult: Action,
    page: Page,
    domSettleTimeoutMs?: number,
  ): Promise<ActResult> {
    const method = observeResult.method?.trim();
    if (!method || method === "not-supported") {
      v3Logger({
        category: "action",
        message: "ObserveResult has no supported method",
        level: 0,
        auxiliary: {
          observe: { value: JSON.stringify(observeResult), type: "object" },
        },
      });
      return {
        success: false,
        message: `Unable to perform action: The method '${method ?? ""}' is not supported in ObserveResult. Please use a supported Playwright locator method.`,
        actionDescription:
          observeResult.description ||
          `ObserveResult action (${method ?? "unknown"})`,
        actions: [],
      };
    }

    const args = Array.isArray(observeResult.arguments)
      ? observeResult.arguments
      : [];

    try {
      await performUnderstudyMethod(
        page,
        page.mainFrame(),
        method,
        observeResult.selector,
        args,
        domSettleTimeoutMs,
      );
      return {
        success: true,
        message: `Action [${method}] performed successfully on selector: ${observeResult.selector}`,
        actionDescription:
          observeResult.description || `ObserveResult action (${method})`,
        actions: [
          {
            selector: observeResult.selector,
            description:
              observeResult.description || `ObserveResult action (${method})`,
            method,
            arguments: args,
          },
        ],
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // Attempt self-heal: re-observe and retry with updated selector
      if (this.selfHeal) {
        v3Logger({
          category: "action",
          message:
            "Error performing act from an ObserveResult. Reprocessing the page and trying again",
          level: 1,
          auxiliary: {
            error: { value: msg, type: "string" },
            observeResult: {
              value: JSON.stringify(observeResult),
              type: "object",
            },
          },
        });

        try {
          // Build an instruction combining method + description, avoiding duplication
          const actCommand = observeResult.description
            ? observeResult.description
                .toLowerCase()
                .startsWith(method.toLowerCase())
              ? observeResult.description
              : `${method} ${observeResult.description}`
            : method;

          // Take a fresh snapshot and ask for a new actionable element
          const snapshot = await captureHybridSnapshot(page as Page, {
            experimental: true,
          });
          const combinedTree = snapshot.combinedTree;

          const instruction = buildActObservePrompt(
            actCommand,
            Object.values(SupportedPlaywrightAction),
            {},
          );

          const requestId =
            (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ??
            `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

          const reobserve = await observe({
            instruction,
            domElements: combinedTree,
            llmClient: this.llmClient,
            requestId,
            userProvidedInstructions: this.systemPrompt,
            logger: v3Logger,
            returnAction: true,
            logInferenceToFile: this.logInferenceToFile,
            fromAct: true,
          });

          // Update ACT metrics with the retry observation
          this.onMetrics?.(
            V3FunctionName.ACT,
            reobserve.prompt_tokens ?? 0,
            reobserve.completion_tokens ?? 0,
            reobserve.inference_time_ms ?? 0,
          );

          const fallback = (reobserve.elements ?? [])[0];
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
          let newSelector = observeResult.selector;
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
            domSettleTimeoutMs,
          );

          return {
            success: true,
            message: `Action [${method}] performed successfully on selector: ${newSelector}`,
            actionDescription:
              observeResult.description || `ObserveResult action (${method})`,
            actions: [
              {
                selector: newSelector,
                description:
                  observeResult.description ||
                  `ObserveResult action (${method})`,
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
            actionDescription:
              observeResult.description || `ObserveResult action (${method})`,
            actions: [],
          };
        }
      }

      return {
        success: false,
        message: `Failed to perform act: ${msg}`,
        actionDescription:
          observeResult.description || `ObserveResult action (${method})`,
        actions: [],
      };
    }
  }
}
