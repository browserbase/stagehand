import { AgentAction, AgentExecuteOptions, AgentResult } from "@/types/agent";
import { LogLine } from "@/types/log";
import { LLMClient } from "../llm/LLMClient";
import { CoreMessage } from "ai";
import { createAgentTools, type AgentTools } from "../agent/tools";
import { buildSystemPrompt } from "../agent/utils/systemPrompt";
import {
  finalizeAgentMessage,
  processStepFinishEvent,
} from "../agent/utils/processStepFinish";
import { ToolSet } from "ai";
//import { injectDropdownConverter } from "../agent/utils/dropdownConverter";
import { ContextManager } from "../agent/contextManager";
import { modelWrapper } from "../agent/utils/modelWrapper";
import { randomUUID } from "crypto";
import { Stagehand } from "../index";

export class StagehandAgentHandler {
  private stagehand: Stagehand;
  private logger: (message: LogLine) => void;
  private llmClient: LLMClient;
  private executionModel?: string;
  private systemInstructions?: string;
  private mcpTools?: ToolSet;
  private contextManager: ContextManager;

  constructor(
    stagehand: Stagehand,
    logger: (message: LogLine) => void,
    llmClient: LLMClient,
    executionModel?: string,
    systemInstructions?: string,
    mcpTools?: ToolSet,
  ) {
    this.stagehand = stagehand;
    this.logger = logger;
    this.llmClient = llmClient;
    this.executionModel = executionModel;
    this.systemInstructions = systemInstructions;
    this.mcpTools = mcpTools;
    this.contextManager = new ContextManager(logger);
  }

  public async execute(
    instructionOrOptions: string | AgentExecuteOptions,
  ): Promise<AgentResult> {
    const startTime = Date.now();
    const sessionId = randomUUID();
    const options =
      typeof instructionOrOptions === "string"
        ? { instruction: instructionOrOptions }
        : instructionOrOptions;

    const maxSteps = options.maxSteps || 10;
    const actions: AgentAction[] = [];
    let finalMessage = "";
    let completed = false;
    const collectedReasoning: string[] = [];

    try {
      const systemPrompt = buildSystemPrompt(
        this.stagehand.page.url(),
        this.llmClient?.modelName as string,
        options.instruction,
        this.systemInstructions,
      );
      const tools = this.createTools();
      const allTools: ToolSet = { ...tools, ...this.mcpTools };
      const messages: CoreMessage[] = [
        {
          role: "user",
          content: options.instruction,
        },
      ];

      if (!this.llmClient) {
        throw new Error(
          "LLM client is not initialized. Please ensure you have the required API keys set (e.g., OPENAI_API_KEY) and that the model configuration is correct.",
        );
      }

      if (!this.llmClient.getLanguageModel) {
        throw new Error(
          "StagehandAgentHandler requires an AISDK-backed LLM client. Ensure your model is configured like 'openai/gpt-4.1-mini' in the provider/model format.",
        );
      }
      const wrappedModel = modelWrapper(
        this.llmClient,
        this.contextManager,
        sessionId,
      );

      //await injectDropdownConverter(this.stagehand.page);
      this.logger({
        category: "agent",
        message: "Injected dropdown converter script",
        level: 2,
      });

      const result = await this.llmClient.generateText({
        model: wrappedModel,
        system: systemPrompt,
        messages,
        tools: allTools,
        maxSteps,
        temperature: 1,
        toolChoice: "auto",
        onStepFinish: async (event) => {
          const processed = processStepFinishEvent(
            event,
            this.logger,
            collectedReasoning,
          );
          actions.push(...processed.actionsAppended);
          if (processed.completed) completed = true;
          if (processed.finalMessage) finalMessage = processed.finalMessage;
        },
      });

      finalMessage = finalizeAgentMessage(
        finalMessage,
        collectedReasoning,
        result.text,
      );

      const endTime = Date.now();
      const inferenceTimeMs = endTime - startTime;

      this.contextManager.clearSession(sessionId);

      return {
        success: completed,
        message: finalMessage || "Task execution completed",
        actions,
        completed,
        usage: result.usage
          ? {
              input_tokens: result.usage.promptTokens || 0,
              output_tokens: result.usage.completionTokens || 0,
              inference_time_ms: inferenceTimeMs,
            }
          : undefined,
      };
    } catch (error) {
      this.contextManager.clearSession(sessionId);
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger({
        category: "agent",
        message: `Error executing agent task: ${errorMessage}`,
        level: 0,
      });

      return {
        success: false,
        actions,
        message: `Failed to execute task: ${errorMessage}`,
        completed: false,
      };
    }
  }

  private createTools(): AgentTools {
    return createAgentTools(this.stagehand, {
      executionModel: this.executionModel,
      mainModel: (this.llmClient?.modelName as string) || undefined,
      logger: this.logger,
    });
  }
}
