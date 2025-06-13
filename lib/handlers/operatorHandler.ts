import { AgentAction, AgentExecuteOptions, AgentResult } from "@/types/agent";
import { LogLine } from "@/types/log";
import {
  OperatorResponse,
  operatorResponseSchema,
  OperatorSummary,
  operatorSummarySchema,
} from "@/types/operator";
import { LLMParsedResponse } from "../inference";
import { ChatMessage, LLMClient } from "../llm/LLMClient";
import { buildOperatorSystemPrompt } from "../prompt";
import { StagehandPage } from "../StagehandPage";
import { ObserveResult } from "@/types/stagehand";
import {
  StagehandError,
  StagehandMissingArgumentError,
} from "@/types/stagehandErrors";

export class StagehandOperatorHandler {
  private stagehandPage: StagehandPage;
  private logger: (message: LogLine) => void;
  private llmClient: LLMClient;
  private messages: ChatMessage[];

  constructor(
    stagehandPage: StagehandPage,
    logger: (message: LogLine) => void,
    llmClient: LLMClient,
  ) {
    this.stagehandPage = stagehandPage;
    this.logger = logger;
    this.llmClient = llmClient;
  }

  public async execute(
    instructionOrOptions: string | AgentExecuteOptions,
  ): Promise<AgentResult> {
    const options =
      typeof instructionOrOptions === "string"
        ? { instruction: instructionOrOptions }
        : instructionOrOptions;

    this.messages = [buildOperatorSystemPrompt(options.instruction)];
    let completed = false;
    let currentStep = 0;
    const maxSteps = options.maxSteps || 10;
    const actions: AgentAction[] = [];

    while (!completed && currentStep < maxSteps) {
      const url = this.stagehandPage.page.url();

      if (!url || url === "about:blank") {
        this.messages.push({
          role: "user",
          content: [
            {
              type: "text",
              text: "No page is currently loaded. The first step should be a 'goto' action to navigate to a URL.",
            },
          ],
        });
      } else {
        const screenshot = await this.stagehandPage.page.screenshot({
          type: "png",
          fullPage: false,
        });

        const base64Image = screenshot.toString("base64");

        let messageText = `Here is a screenshot of the current page (URL: ${url}):`;

        messageText = `Previous actions were: ${actions
          .map((action) => {
            let result: string = "";
            if (action.type === "act") {
              const args = action.playwrightArguments as ObserveResult;
              result = `Performed a "${args.method}" action ${args.arguments.length > 0 ? `with arguments: ${args.arguments.map((arg) => `"${arg}"`).join(", ")}` : ""} on "${args.description}"`;
            } else if (action.type === "extract") {
              result = `Extracted data: ${action.extractionResult}`;
            }
            return `[${action.type}] ${action.reasoning}. Result: ${result}`;
          })
          .join("\n")}\n\n${messageText}`;

        this.messages.push({
          role: "user",
          content: [
            {
              type: "text",
              text: messageText,
            },
            this.llmClient.type === "anthropic"
              ? {
                  type: "image",
                  source: {
                    type: "base64",
                    media_type: "image/png",
                    data: base64Image,
                  },
                  text: "the screenshot of the current page",
                }
              : {
                  type: "image_url",
                  image_url: { url: `data:image/png;base64,${base64Image}` },
                },
          ],
        });
      }

      const result = await this.getNextStep(currentStep);

      if (result.method === "close") {
        completed = true;
      }

      let playwrightArguments: ObserveResult | undefined;
      if (result.method === "act") {
        [playwrightArguments] = await this.stagehandPage.page.observe(
          result.parameters,
        );
      }
      let extractionResult: unknown | undefined;
      if (result.method === "extract") {
        if (result.parameters === null || result.parameters === undefined) {
          const extractionResultObj = await this.stagehandPage.page.extract();
          extractionResult = extractionResultObj.page_text;
        } else {
          extractionResult = await this.stagehandPage.page.extract(
            result.parameters,
          );
        }
      }

      await this.executeAction(result, playwrightArguments, extractionResult);

      actions.push({
        type: result.method,
        reasoning: result.reasoning,
        taskCompleted: result.taskComplete,
        parameters: result.parameters,
        playwrightArguments,
        extractionResult,
      });

      currentStep++;
    }

    return {
      success: true,
      message: await this.getSummary(options.instruction),
      actions,
      completed: actions[actions.length - 1].taskCompleted as boolean,
    };
  }

  private async getNextStep(currentStep: number): Promise<OperatorResponse> {
    const { data: response } =
      (await this.llmClient.createChatCompletion<OperatorResponse>({
        options: {
          messages: this.messages,
          response_model: {
            name: "operatorResponseSchema",
            schema: operatorResponseSchema,
          },
          requestId: `operator-step-${currentStep}`,
        },
        logger: this.logger,
      })) as LLMParsedResponse<OperatorResponse>;

    return response;
  }

  private async getSummary(goal: string): Promise<string> {
    const { data: response } =
      (await this.llmClient.createChatCompletion<OperatorSummary>({
        options: {
          messages: [
            ...this.messages,
            {
              role: "user",
              content: [
                {
                  type: "text",
                  text: `Now use the steps taken to answer the original instruction of ${goal}.`,
                },
              ],
            },
          ],
          response_model: {
            name: "operatorSummarySchema",
            schema: operatorSummarySchema,
          },
          requestId: "operator-summary",
        },
        logger: this.logger,
      })) as LLMParsedResponse<OperatorSummary>;

    return response.answer;
  }
  private async executeAction(
    action: OperatorResponse,
    playwrightArguments?: ObserveResult,
    extractionResult?: unknown,
  ): Promise<unknown> {
    const { method, parameters } = action;
    const page = this.stagehandPage.page;

    if (method === "close") {
      return;
    }

    switch (method) {
      case "act":
        if (!playwrightArguments) {
          throw new StagehandMissingArgumentError(
            "No arguments provided to `act()`. " +
              "Please ensure that all required arguments are passed in.",
          );
        }
        await page.act(playwrightArguments);
        break;
      case "extract":
        if (!extractionResult) {
          throw new StagehandError(
            "Error in OperatorHandler: Cannot complete extraction. No extractionResult provided.",
          );
        }
        return extractionResult;
      case "goto":
        await page.goto(parameters, { waitUntil: "load" });
        break;
      case "wait":
        await page.waitForTimeout(parseInt(parameters));
        break;
      case "navback":
        await page.goBack();
        break;
      case "refresh":
        await page.reload();
        break;
      default:
        throw new StagehandError(
          `Error in OperatorHandler: Cannot execute unknown action: ${method}`,
        );
    }
  }
}
