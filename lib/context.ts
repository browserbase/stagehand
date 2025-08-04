import { LLMTool } from "@/types/llm";
import { LogLine } from "@/types/log";
import { z } from "zod";
import { StagehandPage } from "./StagehandPage";
import { AccessibilityNode } from "../types/context";
import { injectUrls } from "./utils";
import { transformUrlStringsToNumericIds } from "./handlers/extractHandler";
import {
  getAccessibilityTree,
  getAccessibilityTreeWithFrames,
} from "./a11y/utils";
import {
  ChatMessage,
  ChatMessageImageContent,
  ChatMessageTextContent,
  LLMClient,
} from "./llm/LLMClient";

export interface LLMUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface LLMParsedResponse<T> {
  data: T;
  usage?: LLMUsage;
}

export interface ContextManagerConstructor {
  logger: (message: LogLine) => void;
  page: StagehandPage;
  llmClient: LLMClient;
}

export class ContextManager {
  private logger: (message: LogLine) => void;
  private stagehandPage: StagehandPage;
  private llmClient: LLMClient;
  private messages: ChatMessage[] = [];

  constructor({ logger, page, llmClient }: ContextManagerConstructor) {
    this.logger = logger;
    this.stagehandPage = page;
    this.llmClient = llmClient;

    this.appendMessage({
      role: "system",
      content: `You are an intelligent browser automation assistant that helps users interact with web pages through extraction, observation, and action.
      
      You will be given different types of tasks:
      1. EXTRACT: Extract specific information from the page
      2. OBSERVE: Find and identify elements on the page
      3. ACT: Determine the best action to perform on an element
      
      Always provide accurate, precise responses based on the accessibility tree and any screenshots provided.`,
    });
  }

  private appendMessage(message: ChatMessage) {
    this.messages.push(message);
  }

  public async buildContext({
    method,
    instruction,
    takeScreenshot = false,
    includeAccessibilityTree = false,
    domElements,
    tools,
    appendToHistory = false,
    iframes = false,
  }: {
    method: "extract" | "observe" | "act" | "observe-act";
    instruction: string;
    takeScreenshot?: boolean;
    includeAccessibilityTree?: boolean;
    domElements?: string;
    tools?: Record<string, LLMTool>;
    appendToHistory?: boolean;
    iframes?: boolean;
  }): Promise<{
    contextMessage: ChatMessage;
    allMessages: ChatMessage[];
    optimizedElements?: string;
    urlMapping?: Record<string, string>;
  }> {
    this.logger({
      category: "context",
      message: `Building context for ${method} operation: "${instruction}"`,
      level: 1,
    });

    const contentParts: (ChatMessageTextContent | ChatMessageImageContent)[] =
      [];
    let combinedUrlMap: Record<string, string> | undefined = undefined;
    let accessibilityTreeContent: string | undefined = undefined;

    if (takeScreenshot) {
      const screenshot = await this.stagehandPage.page.screenshot();

      contentParts.push(
        {
          type: "text",
          text: "Here is a screenshot of the page. This is only what's visible on the current viewport, however the page may have more content that is not visible.",
        },
        {
          type: "image",
          source: {
            type: "base64",
            media_type: "image/png",
            data: screenshot.toString("base64"),
          },
        },
      );
    }

    if (includeAccessibilityTree) {
      const result = await (iframes
        ? getAccessibilityTreeWithFrames(this.stagehandPage, this.logger).then(
            ({ combinedTree, combinedUrlMap }) => ({
              combinedTree,
              discoveredIframes: [] as AccessibilityNode[],
              combinedUrlMap,
            }),
          )
        : getAccessibilityTree(this.stagehandPage, this.logger).then(
            ({ simplified, iframes: frameNodes, idToUrl }) => ({
              combinedTree: simplified,
              discoveredIframes: frameNodes,
              combinedUrlMap: idToUrl,
            }),
          ));

      const { combinedTree, discoveredIframes } = result;
      combinedUrlMap = result.combinedUrlMap;
      accessibilityTreeContent = combinedTree;

      if (discoveredIframes !== undefined && discoveredIframes.length > 0) {
        this.logger({
          category: "context",
          message: `Warning: found ${discoveredIframes.length} iframe(s) on the page. If you wish to interact with iframe content, please make sure you are setting iframes: true`,
          level: 1,
        });
      }

      contentParts.push(
        {
          type: "text",
          text: "Here is the accessibility tree of the page. This is a tree of the page's DOM nodes, with each node representing a part of the page.",
        },
        {
          type: "text",
          text: combinedTree,
        },
      );
    }

    if (domElements) {
      contentParts.push({
        type: "text",
        text: `Here are the current DOM elements:\n${domElements}`,
      });
    }

    if (tools) {
      contentParts.push({
        type: "text",
        text: `You have the following tools available to you: ${Object.entries(
          tools,
        )
          .map(([name, tool]) => `${name}: ${tool.description}`)
          .join("\n")}`,
      });
    }

    contentParts.push({
      type: "text",
      text: domElements ? `Instruction: ${instruction}` : instruction,
    });

    const contextMessage: ChatMessage = {
      role: "user",
      content: contentParts,
    };

    if (appendToHistory) {
      this.appendMessage(contextMessage);
    }

    this.logger({
      category: "context",
      message: `Completed ${method} operation with context built`,
      level: 1,
    });

    return {
      contextMessage,
      allMessages: appendToHistory
        ? [...this.messages]
        : [...this.messages, contextMessage],
      optimizedElements: accessibilityTreeContent || domElements,
      urlMapping: includeAccessibilityTree ? combinedUrlMap : undefined,
    };
  }

  public getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  public addMessage(message: ChatMessage): void {
    this.appendMessage(message);
  }

  // INFERENCE METHODS (replacing inference.ts)

  public async performExtract<T extends z.ZodObject<z.ZodRawShape>>({
    instruction,
    domElements,
    schema,
    chunksSeen = 1,
    chunksTotal = 1,
    requestId,
    userProvidedInstructions,
  }: {
    instruction: string;
    domElements: string;
    schema: T;
    chunksSeen?: number;
    chunksTotal?: number;
    requestId: string;
    userProvidedInstructions?: string;
  }): Promise<{
    data: z.infer<T>;
    metadata: {
      completed: boolean;
      progress: string;
    };
    prompt_tokens: number;
    completion_tokens: number;
    inference_time_ms: number;
  }> {
    this.logger({
      category: "context",
      message: "Performing extraction with ContextManager",
      level: 1,
    });

    // Transform user defined schema to replace string().url() with .number() (same as extractHandler)
    const [transformedSchema, urlFieldPaths] =
      transformUrlStringsToNumericIds(schema);

    const metadataSchema = z.object({
      progress: z
        .string()
        .describe(
          "progress of what has been extracted so far, as concise as possible",
        ),
      completed: z
        .boolean()
        .describe(
          "true if the goal is now accomplished. Use this conservatively, only when sure that the goal has been completed.",
        ),
    });

    type ExtractionResponse = z.infer<T>;
    type MetadataResponse = z.infer<typeof metadataSchema>;

    const isUsingAnthropic = this.llmClient.type === "anthropic";

    // Build extract system message
    const extractSystemContent =
      `You are extracting content on behalf of a user.
    If a user asks you to extract a 'list' of information, or 'all' information, 
    YOU MUST EXTRACT ALL OF THE INFORMATION THAT THE USER REQUESTS.
     
    You will be given:
  1. An instruction
  2. A list of DOM elements to extract from.

  Print the exact text from the DOM elements with all symbols, characters, and endlines as is.
  Print null or an empty string if no new information is found.
    
  If a user is attempting to extract links or URLs, you MUST respond with ONLY the IDs of the link elements. 
  Do not attempt to extract links directly from the text unless absolutely necessary.${
    userProvidedInstructions
      ? `\n\n# Custom Instructions Provided by the User
      
Please keep the user's instructions in mind when performing actions. If the user's instructions are not relevant to the current task, ignore them.

User Instructions:
${userProvidedInstructions}`
      : ""
  }`.replace(/\s+/g, " ");

    const extractCallMessages: ChatMessage[] = [
      {
        role: "system",
        content: extractSystemContent,
      },
      {
        role: "user",
        content: `Instruction: ${instruction}
DOM: ${domElements}${
          isUsingAnthropic
            ? `
ONLY print the content using the print_extracted_data tool provided.
ONLY print the content using the print_extracted_data tool provided.`
            : ""
        }`,
      },
    ];

    const extractStartTime = Date.now();
    const extractionResponse =
      await this.llmClient.createChatCompletion<ExtractionResponse>({
        options: {
          messages: extractCallMessages,
          response_model: {
            schema: transformedSchema,
            name: "Extraction",
          },
          temperature: 0.1,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
          requestId,
        },
        logger: this.logger,
      });
    const extractEndTime = Date.now();

    const { data: extractedData, usage: extractUsage } =
      extractionResponse as LLMParsedResponse<ExtractionResponse>;

    // Get URL mapping from buildContext if available
    let urlMapping: Record<string, string> | undefined = undefined;
    if (urlFieldPaths.length > 0) {
      // Build context to get URL mapping
      const contextData = await this.buildContext({
        method: "extract",
        instruction,
        takeScreenshot: false,
        includeAccessibilityTree: true, // Need this to get URL mapping
        domElements,
        appendToHistory: false,
      });
      urlMapping = contextData.urlMapping;
    }

    // Build metadata system message
    const metadataSystemContent = `You are an AI assistant tasked with evaluating the progress and completion status of an extraction task.
Analyze the extraction response and determine if the task is completed or if more information is needed.
Strictly abide by the following criteria:
1. Once the instruction has been satisfied by the current extraction response, ALWAYS set completion status to true and stop processing, regardless of remaining chunks.
2. Only set completion status to false if BOTH of these conditions are true:
   - The instruction has not been satisfied yet
   - There are still chunks left to process (chunksTotal > chunksSeen)`;

    const metadataCallMessages: ChatMessage[] = [
      {
        role: "system",
        content: metadataSystemContent,
      },
      {
        role: "user",
        content: `Instruction: ${instruction}
Extracted content: ${JSON.stringify(extractedData, null, 2)}
chunksSeen: ${chunksSeen}
chunksTotal: ${chunksTotal}`,
      },
    ];

    const metadataStartTime = Date.now();
    const metadataResponse =
      await this.llmClient.createChatCompletion<MetadataResponse>({
        options: {
          messages: metadataCallMessages,
          response_model: {
            name: "Metadata",
            schema: metadataSchema,
          },
          temperature: 0.1,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
          requestId,
        },
        logger: this.logger,
      });
    const metadataEndTime = Date.now();

    const { data: metadataData, usage: metadataUsage } =
      metadataResponse as LLMParsedResponse<MetadataResponse>;

    const totalPromptTokens =
      (extractUsage?.prompt_tokens ?? 0) + (metadataUsage?.prompt_tokens ?? 0);
    const totalCompletionTokens =
      (extractUsage?.completion_tokens ?? 0) +
      (metadataUsage?.completion_tokens ?? 0);
    const totalInferenceTimeMs =
      extractEndTime - extractStartTime + (metadataEndTime - metadataStartTime);

    // Revert to original schema and populate with URLs (same as extractHandler)
    if (urlMapping && urlFieldPaths.length > 0) {
      for (const { segments } of urlFieldPaths) {
        injectUrls(extractedData, segments, urlMapping);
      }
    }

    return {
      data: extractedData,
      metadata: {
        completed: metadataData.completed,
        progress: metadataData.progress,
      },
      prompt_tokens: totalPromptTokens,
      completion_tokens: totalCompletionTokens,
      inference_time_ms: totalInferenceTimeMs,
    };
  }

  public async performObserve({
    instruction,
    domElements,
    requestId,
    userProvidedInstructions,
    returnAction = false,
  }: {
    instruction: string;
    domElements: string;
    requestId: string;
    userProvidedInstructions?: string;
    returnAction?: boolean;
  }): Promise<{
    elements: Array<{
      elementId: string;
      description: string;
      method?: string;
      arguments?: string[];
    }>;
    prompt_tokens: number;
    completion_tokens: number;
    inference_time_ms: number;
  }> {
    this.logger({
      category: "context",
      message: "Performing observation with ContextManager",
      level: 1,
    });

    const observeSchema = z.object({
      elements: z
        .array(
          z.object({
            elementId: z
              .string()
              .describe(
                "the ID string associated with the element. Never include surrounding square brackets. This field must follow the format of 'number-number'.",
              ),
            description: z
              .string()
              .describe(
                "a description of the accessible element and its purpose",
              ),
            ...(returnAction
              ? {
                  method: z
                    .string()
                    .describe(
                      "the candidate method/action to interact with the element. Select one of the available Playwright interaction methods.",
                    ),
                  arguments: z.array(
                    z
                      .string()
                      .describe(
                        "the arguments to pass to the method. For example, for a click, the arguments are empty, but for a fill, the arguments are the value to fill in.",
                      ),
                  ),
                }
              : {}),
          }),
        )
        .describe("an array of accessible elements that match the instruction"),
    });

    type ObserveResponse = z.infer<typeof observeSchema>;

    // Build observe system message
    const observeSystemContent = `
You are helping the user automate the browser by finding elements based on what the user wants to observe in the page.

You will be given:
1. a instruction of elements to observe
2. a hierarchical accessibility tree showing the semantic structure of the page. The tree is a hybrid of the DOM and the accessibility tree.

Return an array of elements that match the instruction if they exist, otherwise return an empty array.${
      userProvidedInstructions
        ? `

# Custom Instructions Provided by the User
      
Please keep the user's instructions in mind when performing actions. If the user's instructions are not relevant to the current task, ignore them.

User Instructions:
${userProvidedInstructions}`
        : ""
    }`.replace(/\s+/g, " ");

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: observeSystemContent,
      },
      {
        role: "user",
        content: `instruction: ${instruction}
Accessibility Tree: \n${domElements}`,
      },
    ];

    const start = Date.now();
    const rawResponse =
      await this.llmClient.createChatCompletion<ObserveResponse>({
        options: {
          messages,
          response_model: {
            schema: observeSchema,
            name: "Observation",
          },
          temperature: 0.1,
          top_p: 1,
          frequency_penalty: 0,
          presence_penalty: 0,
          requestId,
        },
        logger: this.logger,
      });
    const end = Date.now();
    const usageTimeMs = end - start;

    const { data: observeData, usage: observeUsage } =
      rawResponse as LLMParsedResponse<ObserveResponse>;
    const promptTokens = observeUsage?.prompt_tokens ?? 0;
    const completionTokens = observeUsage?.completion_tokens ?? 0;

    const parsedElements =
      observeData.elements?.map((el) => {
        const base = {
          elementId: el.elementId,
          description: String(el.description),
        };
        if (returnAction) {
          return {
            ...base,
            method: String(el.method),
            arguments: el.arguments,
          };
        }
        return base;
      }) ?? [];

    return {
      elements: parsedElements,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      inference_time_ms: usageTimeMs,
    };
  }
}
