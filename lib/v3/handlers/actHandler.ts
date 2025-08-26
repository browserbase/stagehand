// lib/v3/handlers/actHandler.ts
import { ActHandlerParams } from "@/lib/v3/types";
import { captureHybridSnapshot } from "@/lib/v3/understudy/a11y/snapshot";
import fs from "fs";
import { observe } from "@/lib/inference";
import { LogLine } from "@/types/log";
import { LLMClient } from "@/lib/llm/LLMClient";
import { AvailableModel, ClientOptions } from "@/types/model";
import { performUnderstudyMethod } from "./handlerUtils/actHandlerUtils";
import type { Page } from "../understudy/page";
import { trimTrailingTextNode } from "@/lib/utils";
import { EncodedId } from "@/types/context";
import type { ObserveResult } from "@/types/stagehand";

export class ActHandler {
  private readonly logger: (logLine: LogLine) => void;
  private readonly llmClient: LLMClient;
  private readonly defaultModelName: AvailableModel;
  private readonly defaultClientOptions: ClientOptions;
  private readonly systemPrompt: string;
  private readonly logInferenceToFile: boolean;

  constructor(
    llmClient: LLMClient,
    defaultModelName: AvailableModel,
    defaultClientOptions: ClientOptions,
    logger: (logLine: LogLine) => void,
    systemPrompt?: string,
    logInferenceToFile?: boolean,
  ) {
    this.llmClient = llmClient;
    this.defaultModelName = defaultModelName;
    this.defaultClientOptions = defaultClientOptions;
    this.logger = logger;
    this.systemPrompt = systemPrompt ?? "";
    this.logInferenceToFile = logInferenceToFile ?? false;
  }

  async act(params: ActHandlerParams): Promise<void> {
    const { instruction, page, variables, domSettleTimeoutMs } = params;

    // Snapshot (gives text tree + xpath map)
    const snapshot = await captureHybridSnapshot(page as Page, {
      experimental: true,
      detectScrollable: true,
    });
    const combinedTree = snapshot.combinedTree;
    const combinedXpathMap = (snapshot.combinedXpathMap ?? {}) as Record<
      EncodedId,
      string
    >;

    try {
      fs.writeFileSync("snapshot.json", JSON.stringify(snapshot, null, 2));
      fs.writeFileSync("combinedtree.txt", combinedTree);
    } catch {
      /* ignore fs failures */
    }

    const requestId =
      (globalThis.crypto as Crypto | undefined)?.randomUUID?.() ??
      `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;

    // Always ask for an action
    const observation = await observe({
      instruction,
      domElements: combinedTree,
      llmClient: this.llmClient,
      requestId,
      userProvidedInstructions: this.systemPrompt,
      logger: this.logger,
      returnAction: true,
      logInferenceToFile: this.logInferenceToFile,
      fromAct: true,
    });

    // Normalize raw LLM elements → ObserveResult[] (reuse old type)
    const raw = (observation.elements ?? []) as Array<{
      elementId: string;
      description: string;
      method?: string;
      arguments?: string[];
    }>;

    const results: ObserveResult[] = raw
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
          } as ObserveResult;
        }
        // shadow-root path not supported here (match old behavior)
        return undefined;
      })
      .filter((v): v is ObserveResult => v !== undefined);

    if (results.length === 0) {
      this.logger({
        category: "action",
        message: "no actionable element returned by LLM",
        level: 1,
      });
      return;
    }

    // Use the first observed element (same as old actFromObserveResult)
    const chosen = results[0];

    // Substitute %vars% in args
    const args = chosen.arguments.map((arg: string) => {
      if (!variables) return arg;
      let out = arg;
      for (const [k, v] of Object.entries(variables)) {
        const token = `%${k}%`;
        out = out.split(token).join(String(v));
      }
      return out;
    });

    // Execute via CDP
    await performUnderstudyMethod(
      page as Page,
      (page as Page).mainFrame(),
      chosen.method,
      chosen.selector,
      args,
      this.logger,
      domSettleTimeoutMs,
    );
  }

  async actFromObserveResult(
    observe: ObserveResult,
    page: Page,
    domSettleTimeoutMs?: number,
  ): Promise<void> {
    const method = observe.method?.trim();
    if (!method || method === "not-supported") {
      this.logger({
        category: "action",
        message: "ObserveResult has no supported method",
        level: 0,
        auxiliary: {
          observe: { value: JSON.stringify(observe), type: "object" },
        },
      });
      throw new Error("ObserveResult must include a supported 'method'.");
    }

    const args = Array.isArray(observe.arguments) ? observe.arguments : [];

    await performUnderstudyMethod(
      page,
      page.mainFrame(),
      method,
      observe.selector,
      args,
      this.logger,
      domSettleTimeoutMs,
    );
  }
}
