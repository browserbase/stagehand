import { AgentAction, AgentExecuteOptions, AgentResult } from "@/types/agent";
import { LogLine } from "@/types/log";
import { StagehandPage } from "../StagehandPage";
import { LLMClient } from "../llm/LLMClient";
import { CoreMessage, wrapLanguageModel } from "ai";
import { LanguageModel } from "ai";
// Removed redundant preprocessor; ContextManager now handles all compression
import { createAgentTools } from "../agent/tools";
import { ToolSet } from "ai";
import { injectDropdownConverter } from "../utils/dropdownConverter";
import { ContextManager } from "./contextManager";
import { randomUUID } from "crypto";

export class StagehandAgentHandler {
  private stagehandPage: StagehandPage;
  private logger: (message: LogLine) => void;
  private llmClient: LLMClient;
  private executionModel?: string;
  private systemInstructions?: string;
  private mcpTools?: ToolSet;
  private contextManager: ContextManager;

  constructor(
    stagehandPage: StagehandPage,
    logger: (message: LogLine) => void,
    llmClient: LLMClient,
    executionModel?: string,
    systemInstructions?: string,
    mcpTools?: ToolSet,
  ) {
    this.stagehandPage = stagehandPage;
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
      const systemPrompt = this.buildSystemPrompt(
        options.instruction,
        this.systemInstructions,
      );
      const tools = this.createTools();
      const allTools = { ...tools, ...this.mcpTools };
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
      const baseModel: LanguageModel = this.llmClient.getLanguageModel();
      const wrappedModel = wrapLanguageModel({
        model: baseModel,
        middleware: {
          transformParams: async ({ params }) => {
            const processedPrompt = await this.contextManager.processMessages(
              params.prompt,
              sessionId,
              this.llmClient,
            );
            return { ...params, prompt: processedPrompt };
          },
        },
      });

      await injectDropdownConverter(this.stagehandPage.page);
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
          this.logger({
            category: "agent",
            message: `Step finished: ${event.finishReason}`,
            level: 2,
          });

          if (event.toolCalls && event.toolCalls.length > 0) {
            for (const toolCall of event.toolCalls) {
              const args = toolCall.args as Record<string, unknown>;
              this.logger({
                category: "agent",
                message: `tool call: ${toolCall.toolName} with args: ${JSON.stringify(args)}`,
                level: 1,
              });
              if (event.text.length > 0) {
                collectedReasoning.push(event.text);
                this.logger({
                  category: "agent",
                  message: `reasoning: ${event.text}`,
                  level: 1,
                });
              }

              if (toolCall.toolName === "close") {
                completed = true;
                if (args?.taskComplete) {
                  const closeReasoning = args.reasoning as string;
                  const allReasoning = collectedReasoning.join(" ");
                  finalMessage = closeReasoning
                    ? `${allReasoning} ${closeReasoning}`.trim()
                    : allReasoning || "Task completed successfully";
                }
              }

              const action: AgentAction = {
                type: toolCall.toolName,
                reasoning: event.text || undefined,
                taskCompleted:
                  toolCall.toolName === "close"
                    ? (args?.taskComplete as boolean)
                    : false,
                ...args,
              };

              actions.push(action);
            }
          }
        },
      });

      if (!finalMessage) {
        const allReasoning = collectedReasoning.join(" ").trim();
        finalMessage = allReasoning || result.text;
      }

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

  // in the future if we continue to describe tools in system prompt, we need to make sure to update them in here when new tools are added or removed. still tbd on whether we want to keep them in here long term.
  private buildSystemPrompt(
    executionInstruction: string,
    systemInstructions?: string,
  ): string {
    const localeDate = new Date().toLocaleDateString();
    const isoDate = new Date().toISOString();
    const cdata = (text: string) => `<![CDATA[${text}]]>`;

    if (systemInstructions) {
      return `<system>
  <identity>You are a web automation assistant using browser automation tools to accomplish the user's goal.</identity>
  <customInstructions>${cdata(systemInstructions)}</customInstructions>
  <task>
    <goal>${cdata(executionInstruction)}</goal>
    <date display="local" iso="${isoDate}">${localeDate}</date>
    <note>You may think the date is different due to knowledge cutoff, but this is the actual date.</note>
  </task>
  <mindset>
    <note>Be very intentional about your action. The initial instruction is very important, and slight variations of the actual goal can lead to failures.</note>
    <note>When the task is complete, do not seek more information; you have completed the task.</note>
  </mindset>
  <guidelines>
    <item>Always start by understanding the current page state</item>
    <item>Use the screenshot tool to verify page state when needed</item>
    <item>Use appropriate tools for each action</item>
    <item>When the task is complete, use the "close" tool with taskComplete: true</item>
    <item>If the task cannot be completed, use "close" with taskComplete: false</item>
  </guidelines>
  <page_understanding_protocol>
    <step_1>
      <title>UNDERSTAND THE PAGE</title>
      <primary_tool>
        <name>ariaTree</name>
        <usage>Get complete page context before taking actions</usage>
        <benefit>Eliminates the need to scroll and provides full accessible content</benefit>
      </primary_tool>
      <secondary_tool>
        <name>screenshot</name>
        <usage>Visual confirmation when needed. Ideally after navigating to a new page.</usage>
      </secondary_tool>
    </step_1>
  </page_understanding_protocol>
  <navigation>
    <rule>When first starting a task, check what page you are on before proceeding</rule>
    <rule>If you are not confident in the URL, use the search tool to find it.</rule
    <rule>If you are not confident in the URL, use the search tool to find it.</rule>
  </navigation>
  <tools>
    <tool name="screenshot">Take a compressed JPEG screenshot for quick visual context (use sparingly)</tool>
    <tool name="ariaTree">Get an accessibility (ARIA) hybrid tree for full page context (preferred for understanding layout and elements)</tool>
    <tool name="click">Click on an element (PREFERRED - more reliable when element is visible in viewport)</tool>
    <tool name="type">Type text into an element (PREFERRED - more reliable when element is visible in viewport)</tool>
    <tool name="act">Perform a specific atomic action (click, type, etc.) - ONLY use when element is in ariaTree but NOT visible in screenshot. Less reliable but can interact with out-of-viewport elements.</tool>
    <tool name="dragAndDrop">Drag and drop an element</tool>
    <tool name="keys">Press a keyboard key</tool>
    <tool name="fillForm">Fill out a form</tool>
    <tool name="think">Think about the task</tool>
    <tool name="extract">Extract structured data</tool>
    <tool name="goto">Navigate to a URL</tool>
    <tool name="wait|navback|refresh">Control timing and navigation</tool>
    <tool name="scroll">Scroll the page x pixels up or down</tool>
    <tool name="search">Perform a web search and return results. Prefer this over navigating to Google and searching within the page for reliability and efficiency.</tool>
  </tools>
  <strategy>
    <item>Always use ariaTree to understand the entire page very fast - it provides comprehensive context of all elements and their relationships.</item>
    <item>Use ariaTree to find elements on the page without scrolling - it shows all page content including elements below the fold.</item>
    <item>Only use scroll after checking ariaTree if you need to bring specific elements into view for interaction.</item>
    <item>Tool selection priority: Use specific tools (click, type) when elements are visible in viewport for maximum reliability. Only use act when element is in ariaTree but not visible in screenshot.</item>
    <item>Prefer ariaTree to understand the page before acting; use screenshot for quick confirmation.</item>
    <item>Keep actions atomic and verify outcomes before proceeding.</item>
    <item>For each action, provide clear reasoning about why you're taking that step.</item>
  </strategy>
  <roadblocks>
    <note>captchas, popups, etc.</note>
    <captcha>If you see a captcha, use the wait tool. It will automatically be solved by our internal solver.</captcha>
  </roadblocks>
  <completion>
    <note>When you complete the task, explain any information that was found that was relevant to the original task.</note>
    <examples>
      <example>If you were asked for specific flights, list the flights you found.</example>
      <example>If you were asked for information about a product, list the product information you were asked for.</example>
    </examples>
  </completion>
</system>`;
    }

    return `<system>
  <identity>You are a web automation assistant using browser automation tools to accomplish the user's goal.</identity>
  <task>
    <goal>${cdata(executionInstruction)}</goal>
    <date display="local" iso="${isoDate}">${localeDate}</date>
    <note>You may think the date is different due to knowledge cutoff, but this is the actual date.</note>
  </task>
   <mindset>
    <note>Be very intentional about your action. The initial instruction is very important, and slight variations of the actual goal can lead to failures.</note>
    <note>When the task is complete, do not seek more information; you have completed the task.</note>
  </mindset>
  <guidelines>
    <item>Always start by understanding the current page state</item>
    <item>Use the screenshot tool to verify page state when needed</item>
    <item>Use appropriate tools for each action</item>
    <item>When the task is complete, use the "close" tool with taskComplete: true</item>
    <item>If the task cannot be completed, use "close" with taskComplete: false</item>
  </guidelines>
  <page_understanding_protocol>
    <step_1>
      <title>UNDERSTAND THE PAGE</title>
      <primary_tool>
        <name>ariaTree</name>
        <usage>Get complete page context before taking actions</usage>
        <benefit>Eliminates the need to scroll and provides full accessible content</benefit>
      </primary_tool>
      <secondary_tool>
        <name>screenshot</name>
        <usage>Visual confirmation when needed. Ideally after navigating to a new page.</usage>
      </secondary_tool>
    </step_1>
  </page_understanding_protocol>
  <navigation>
    <rule>If you are confident in the URL, navigate directly to it.</rule>
    <rule>If you are not confident in the URL, use the search tool to find it.</rule>
  </navigation>
  <tools>
    <tool name="screenshot">Take a compressed JPEG screenshot for quick visual context (use sparingly)</tool>
    <tool name="ariaTree">Get an accessibility (ARIA) hybrid tree for full page context (preferred for understanding layout and elements)</tool>
    <tool name="click">Click on an element (PREFERRED - more reliable when element is visible in viewport)</tool>
    <tool name="type">Type text into an element (PREFERRED - more reliable when element is visible in viewport)</tool>
    <tool name="act">Perform a specific atomic action (click, type, etc.) - ONLY use when element is in ariaTree but NOT visible in screenshot. Less reliable but can interact with out-of-viewport elements.</tool>
    <tool name="dragAndDrop">Drag and drop an element</tool>
    <tool name="keys">Press a keyboard key</tool>
    <tool name="fillForm">Fill out a form</tool>
    <tool name="think">Think about the task</tool>
    <tool name="extract">Extract structured data</tool>
    <tool name="goto">Navigate to a URL</tool>
    <tool name="wait|navback|refresh">Control timing and navigation</tool>
    <tool name="scroll">Scroll the page x pixels up or down</tool>
    <tool name="search">Perform a web search and return results. Prefer this over navigating to Google and searching within the page for reliability and efficiency.</tool>
  </tools>
  <strategy>
    <item>Always use ariaTree to understand the entire page very fast - it provides comprehensive context of all elements and their relationships.</item>
    <item>Use ariaTree to find elements on the page without scrolling - it shows all page content including elements below the fold.</item>
    <item>Only use scroll after checking ariaTree if you need to bring specific elements into view for interaction.</item>
    <item>Tool selection priority: Use specific tools (click, type) when elements are visible in viewport for maximum reliability. Only use act when element is in ariaTree but not visible in screenshot.</item>
    <item>Prefer ariaTree to understand the page before acting; use screenshot for quick confirmation.</item>
    <item>Keep actions atomic and verify outcomes before proceeding.</item>
    <item>For each action, provide clear reasoning about why you're taking that step.</item>
  </strategy>
  <roadblocks>
    <note>captchas, popups, etc.</note>
    <captcha>If you see a captcha, use the wait tool. It will automatically be solved by our internal solver.</captcha>
  </roadblocks>
  <completion>
    <note>When you complete the task, explain any information that was found that was relevant to the original task.</note>
    <examples>
      <example>If you were asked for specific flights, list the flights you found.</example>
      <example>If you were asked for information about a product, list the product information you were asked for.</example>
    </examples>
  </completion>
</system>`;
  }

  private createTools() {
    return createAgentTools(this.stagehandPage, {
      executionModel: this.executionModel,
      logger: this.logger,
    });
  }
}
