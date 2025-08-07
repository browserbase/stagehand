import { LLMParsedResponse, LLMTool } from "@/types/llm";
import { LogLine } from "@/types/log";
import { z } from "zod";
import { StagehandPage } from "./StagehandPage";
import {
  AccessibilityNode,
  ContextManagerConstructor,
  BuildContextOptions,
  BuildContextResult,
  PerformExtractOptions,
  PerformExtractResult,
  PerformObserveOptions,
  PerformObserveResult,
} from "../types/context";
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
import { StagehandFunctionName } from "@/types/stagehand";

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
      content: [
        {
          type: "text",
          text: `You are an intelligent browser automation assistant that helps users interact with web pages through extraction, observation, and action.
      
      You will be given different types of tasks:
      1. EXTRACT: Extract specific information from the page
      2. OBSERVE: Find and identify elements on the page
      3. ACT: Determine the best action to perform on an element
      
      Always provide accurate, precise responses based on the accessibility tree and any screenshots provided.`,
        },
      ],
    });
  }

  private appendMessage(message: ChatMessage) {
    this.messages.push(message);
  }

  public async buildContext({
    method,
    instruction,
    takeScreenshot = false,
    includeAccessibilityTree = true,
    tools,
    appendToHistory = false,
    iframes = false,
    dynamic = false,
  }: BuildContextOptions): Promise<BuildContextResult> {
    this.logger({
      category: "context",
      message: `Building context for ${method} operation: "${instruction}"`,
      level: 1,
    });

    // If dynamic mode is enabled, use LLM to determine optimal context
    if (dynamic) {
      try {
        const dynamicContextDecision = await this.determineDynamicContext({
          method,
          instruction,
          tools,
        });

        // Override the parameters based on LLM decision
        takeScreenshot = dynamicContextDecision.takeScreenshot;
        includeAccessibilityTree =
          dynamicContextDecision.includeAccessibilityTree;
        iframes = dynamicContextDecision.handleIframes;

        // Filter tools if recommended
        if (tools && dynamicContextDecision.filteredTools) {
          tools = dynamicContextDecision.filteredTools;
        }

        this.logger({
          category: "context",
          message: `Dynamic context analysis completed - screenshot: ${takeScreenshot}, a11y: ${includeAccessibilityTree}, iframes: ${iframes}, tools: ${Object.keys(tools || {}).length}`,
          level: 1,
        });
      } catch (error) {
        this.logger({
          category: "context",
          message: `Dynamic context analysis failed, falling back to defaults: ${error.message}`,
          level: 1,
        });
        // Continue with the original parameter values
      }
    }

    const contentParts: (ChatMessageTextContent | ChatMessageImageContent)[] =
      [];
    let combinedUrlMap: Record<string, string> | undefined = undefined;
    let xpathMap: Record<string, string> | undefined = undefined;
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
            ({ combinedTree, combinedUrlMap, combinedXpathMap }) => ({
              combinedTree,
              discoveredIframes: [] as AccessibilityNode[],
              combinedUrlMap,
              xpathMap: combinedXpathMap,
            }),
          )
        : getAccessibilityTree(this.stagehandPage, this.logger).then(
            ({ simplified, iframes: frameNodes, idToUrl, xpathMap }) => ({
              combinedTree: simplified,
              discoveredIframes: frameNodes,
              combinedUrlMap: idToUrl,
              xpathMap,
            }),
          ));

      const { combinedTree, discoveredIframes } = result;
      combinedUrlMap = result.combinedUrlMap;
      xpathMap = result.xpathMap;

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

    if (method === StagehandFunctionName.EXTRACT) {
      contentParts.push({
        type: "text",
        text: `Use all the information provided to you to extract the information requested by the user.

Here is the user's instruction: "${instruction}"`,
      });
    } else if (method === StagehandFunctionName.OBSERVE) {
      contentParts.push({
        type: "text",
        text: `Use all the information provided to you to find and return all elements that match the user's instruction.

Here is the user's instruction: "${instruction}"`,
      });
    } else if (method === StagehandFunctionName.ACT) {
      contentParts.push({
        type: "text",
        text: `Use all the information provided to you to determine the best way to perform the user's requested action.

Here is the user's instruction: "${instruction}"`,
      });
    } else {
      contentParts.push({
        type: "text",
        text: `Here is the user's instruction: "${instruction}"`,
      });
    }

    const contextMessage: ChatMessage = {
      role: "user",
      content: contentParts,
    };

    if (appendToHistory) {
      this.appendMessage(contextMessage);
    }

    return {
      contextMessage,
      allMessages: appendToHistory
        ? [...this.messages]
        : [...this.messages, contextMessage],
      optimizedElements: accessibilityTreeContent,
      urlMapping: includeAccessibilityTree ? combinedUrlMap : undefined,
      xpathMap: includeAccessibilityTree ? xpathMap : undefined,
    };
  }

  public getMessages(): ChatMessage[] {
    return [...this.messages];
  }

  public addMessage(message: ChatMessage): void {
    this.appendMessage(message);
  }

  public async performExtract<T extends z.ZodObject<z.ZodRawShape>>({
    instruction,
    schema,
    chunksSeen = 1,
    chunksTotal = 1,
    requestId,
    userProvidedInstructions,
    iframes = false,
    dynamic = false,
  }: PerformExtractOptions<T>): Promise<PerformExtractResult<T>> {
    this.logger({
      category: "context",
      message: "Performing extraction with ContextManager",
      level: 1,
    });

    // Build context internally - instruction is only passed once here
    const contextData = await this.buildContext({
      method: StagehandFunctionName.EXTRACT,
      instruction,
      takeScreenshot: false,
      includeAccessibilityTree: true,
      appendToHistory: false,
      iframes,
      dynamic,
    });

    // Add Anthropic-specific instructions if using Anthropic
    const isUsingAnthropic = this.llmClient.type === "anthropic";
    const userMessage = { ...contextData.contextMessage };

    if (isUsingAnthropic && Array.isArray(userMessage.content)) {
      // Add Anthropic-specific instruction to the last text content part
      const lastTextPart = userMessage.content[userMessage.content.length - 1];
      if (lastTextPart.type === "text") {
        lastTextPart.text += `

ONLY print the content using the print_extracted_data tool provided.
ONLY print the content using the print_extracted_data tool provided.`;
      }
    }

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
        content: [
          {
            type: "text",
            text: extractSystemContent,
          },
        ],
      },
      userMessage,
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

    // We'll build this after the metadata call is complete

    // Get URL mapping from passed contextData if available
    let urlMapping: Record<string, string> | undefined = undefined;
    if (urlFieldPaths.length > 0) {
      urlMapping = contextData.urlMapping;
    }

    // Build metadata system message
    const metadataSystemContent = `You are an AI assistant tasked with evaluating the progress and completion status of an extraction task.
Analyze the extraction response and determine if the task is completed or if more information is needed.
Strictly abide by the following criteria:
1. Once the extraction has satisfied the requirements, ALWAYS set completion status to true and stop processing, regardless of remaining chunks.
2. Only set completion status to false if BOTH of these conditions are true:
   - The extraction requirements have not been satisfied yet
   - There are still chunks left to process (chunksTotal > chunksSeen)`;

    const metadataCallMessages: ChatMessage[] = [
      {
        role: "system",
        content: [
          {
            type: "text",
            text: metadataSystemContent,
          },
        ],
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `Extracted content: ${JSON.stringify(extractedData, null, 2)}
chunksSeen: ${chunksSeen}
chunksTotal: ${chunksTotal}`,
          },
        ],
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

    // Complete prompt data capture with both calls
    const promptData = {
      calls: [
        {
          type: "extraction",
          messages: extractCallMessages,
          system: extractSystemContent,
          schema: transformedSchema,
          config: {
            temperature: 0.1,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
          },
          usage: {
            prompt_tokens: extractUsage?.prompt_tokens ?? 0,
            completion_tokens: extractUsage?.completion_tokens ?? 0,
          },
        },
        {
          type: "metadata",
          messages: metadataCallMessages,
          system: metadataSystemContent,
          schema: metadataSchema,
          config: {
            temperature: 0.1,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
          },
          usage: {
            prompt_tokens: metadataUsage?.prompt_tokens ?? 0,
            completion_tokens: metadataUsage?.completion_tokens ?? 0,
          },
        },
      ],
      requestId,
    };

    return {
      data: extractedData,
      metadata: {
        completed: metadataData.completed,
        progress: metadataData.progress,
      },
      prompt_tokens: totalPromptTokens,
      completion_tokens: totalCompletionTokens,
      inference_time_ms: totalInferenceTimeMs,
      promptData,
    };
  }

  public async performObserve({
    instruction,
    requestId,
    userProvidedInstructions,
    returnAction = false,
    iframes = false,
    dynamic = false,
  }: PerformObserveOptions): Promise<PerformObserveResult> {
    this.logger({
      category: "context",
      message: "Performing observation with ContextManager",
      level: 1,
    });

    // Build context internally - instruction is only passed once here
    const contextData = await this.buildContext({
      method: StagehandFunctionName.OBSERVE,
      instruction,
      takeScreenshot: false,
      includeAccessibilityTree: true,
      appendToHistory: false,
      iframes,
      dynamic,
    });

    const xpathMapping = contextData.xpathMap || {};

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
        content: [
          {
            type: "text",
            text: observeSystemContent,
          },
        ],
      },
      contextData.contextMessage,
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

    // Capture prompt data for inference logging
    const promptData = {
      calls: [
        {
          type: "observe",
          messages,
          system: observeSystemContent,
          schema: observeSchema,
          config: {
            temperature: 0.1,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
          },
          usage: {
            prompt_tokens: observeUsage?.prompt_tokens ?? 0,
            completion_tokens: observeUsage?.completion_tokens ?? 0,
          },
        },
      ],
      requestId,
    };
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
      xpathMapping: xpathMapping,
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      inference_time_ms: usageTimeMs,
      promptData,
    };
  }

  private async determineDynamicContext({
    method,
    instruction,
    tools,
  }: {
    method: StagehandFunctionName;
    instruction: string;
    tools?: Record<string, LLMTool>;
  }): Promise<{
    takeScreenshot: boolean;
    includeAccessibilityTree: boolean;
    handleIframes: boolean;
    filteredTools?: Record<string, LLMTool>;
  }> {
    this.logger({
      category: "context",
      message: "Analyzing page properties for dynamic context selection",
      level: 1,
    });

    // Extract page properties to help LLM make informed decisions
    const pageProperties = await this.extractPageProperties();

    // Define schema for LLM response
    const contextDecisionSchema = z.object({
      takeScreenshot: z
        .boolean()
        .describe(
          "Whether to take a screenshot. Useful for visual layouts, complex forms, or when user instruction refers to visual elements",
        ),
      includeAccessibilityTree: z
        .boolean()
        .describe(
          "Whether to include the accessibility tree. Essential for most interactions but can be skipped for simple page analysis",
        ),
      handleIframes: z
        .boolean()
        .describe(
          "Whether to handle iframes. Enable if the page likely contains embedded content or the instruction suggests interaction within frames",
        ),
      toolsToKeep: z
        .array(z.string())
        .optional()
        .describe(
          "Array of tool names to keep. Only include tools that are relevant to the current instruction. If not provided, all tools will be kept",
        ),
      reasoning: z.string().describe("Brief explanation of the decisions made"),
    });

    type ContextDecisionResponse = z.infer<typeof contextDecisionSchema>;

    const systemMessage = `You are an expert at analyzing web pages and user instructions to determine the optimal context needed for browser automation tasks.

Your goal is to decide what context information to include based on:
1. The user's instruction and what they want to accomplish
2. Properties of the current page
3. The type of operation being performed (${method})

INSTRUCTION ANALYSIS - Enable features based on instruction patterns:

Screenshots should be enabled when the instruction mentions:
- Visual elements: "button", "link", "image", "icon", "color", "appearance"
- Layout references: "top", "bottom", "left", "right", "center", "corner", "sidebar"
- Visual descriptions: "red button", "large text", "highlighted", "visible", "display"
- Complex UI: "dropdown", "menu", "modal", "popup", "overlay"
- Spatial relationships: "next to", "above", "below", "beside"

Accessibility trees should be enabled for:
- Most interactions: "click", "type", "fill", "select", "choose", "press"
- Element targeting: "find", "locate", "identify", "search for"
- Form operations: "submit", "input", "checkbox", "radio", "textarea"
- Navigation: "go to", "navigate", "scroll", "page"
- Content extraction where DOM structure matters

iFrames should be enabled when instruction mentions:
- Embedded content: "video", "advertisement", "embed", "frame", "widget"
- Third-party content: "social media", "payment", "login form", "chat"
- Cross-domain interactions: "external", "different domain"
- Page properties show hasFrames: true

Tool filtering should consider:
- Extract operations: keep only extraction-related tools
- Navigation tasks: keep only navigation/action tools  
- Form interactions: keep form-related tools
- Data analysis: keep analysis/processing tools

CONTEXT PRIORITIZATION:
- For EXTRACT: Prioritize accessibility tree, consider screenshots for visual data
- For OBSERVE: Always use accessibility tree, add screenshots for visual targeting
- For ACT: Use accessibility tree, add screenshots for complex visual interactions

Be decisive and practical. Prefer minimal context that still accomplishes the task effectively.`;

    const userMessage = `Operation: ${method}
User Instruction: "${instruction}"

INSTRUCTION ANALYSIS:
Analyze the instruction for these patterns:
- Visual keywords: ${this.extractKeywordMatches(instruction, ["button", "link", "image", "icon", "color", "red", "blue", "green", "visible", "display", "appearance", "highlighted"])}
- Layout keywords: ${this.extractKeywordMatches(instruction, ["top", "bottom", "left", "right", "center", "corner", "sidebar", "next to", "above", "below", "beside"])}
- Interaction keywords: ${this.extractKeywordMatches(instruction, ["click", "type", "fill", "select", "choose", "press", "submit", "input", "checkbox", "radio"])}
- Content keywords: ${this.extractKeywordMatches(instruction, ["extract", "find", "locate", "identify", "search", "get", "retrieve"])}
- Iframe keywords: ${this.extractKeywordMatches(instruction, ["video", "advertisement", "embed", "frame", "widget", "social media", "payment", "login form", "chat"])}

Page Properties:
${JSON.stringify(pageProperties, null, 2)}

Available Tools: ${
      tools
        ? Object.keys(tools)
            .map((name) => `${name}: ${tools[name].description}`)
            .join("\n")
        : "None"
    }

Based on the instruction analysis, page properties, and operation type, determine the optimal context configuration.`;

    const messages: ChatMessage[] = [
      {
        role: "system",
        content: systemMessage,
      },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: userMessage,
          },
        ],
      },
    ];

    try {
      const response =
        await this.llmClient.createChatCompletion<ContextDecisionResponse>({
          options: {
            messages,
            response_model: {
              schema: contextDecisionSchema,
              name: "ContextDecision",
            },
            temperature: 0.1,
            top_p: 1,
            frequency_penalty: 0,
            presence_penalty: 0,
          },
          logger: this.logger,
        });

      const { data: decision } =
        response as LLMParsedResponse<ContextDecisionResponse>;

      this.logger({
        category: "context",
        message: `Dynamic context decision: ${decision.reasoning}`,
        level: 1,
      });

      let filteredTools: Record<string, LLMTool> | undefined = undefined;
      if (tools && decision.toolsToKeep && decision.toolsToKeep.length > 0) {
        filteredTools = {};
        for (const toolName of decision.toolsToKeep) {
          if (tools[toolName]) {
            filteredTools[toolName] = tools[toolName];
          }
        }
      }

      return {
        takeScreenshot: decision.takeScreenshot,
        includeAccessibilityTree: decision.includeAccessibilityTree,
        handleIframes: decision.handleIframes,
        filteredTools,
      };
    } catch (error) {
      this.logger({
        category: "context",
        message: `Error in dynamic context analysis, falling back to defaults: ${error}`,
        level: 2,
      });

      // Fallback to reasonable defaults
      return {
        takeScreenshot: false,
        includeAccessibilityTree: true,
        handleIframes: false,
      };
    }
  }

  private async extractPageProperties(): Promise<{
    url: string;
    title: string;
    hasFrames: boolean;
    viewportSize: { width: number; height: number };
    documentReadyState: string;
    bodyTag: string | null;
    metaDescription: string | null;
    headingsCount: { h1: number; h2: number; h3: number };
    formsCount: number;
    buttonsCount: number;
    linksCount: number;
    imagesCount: number;
  }> {
    const page = this.stagehandPage.page;

    const properties = await page.evaluate(() => {
      const headings = {
        h1: document.querySelectorAll("h1").length,
        h2: document.querySelectorAll("h2").length,
        h3: document.querySelectorAll("h3").length,
      };

      const metaDescription =
        document
          .querySelector('meta[name="description"]')
          ?.getAttribute("content") || null;
      const bodyTag = document.body
        ? document.body.tagName.toLowerCase()
        : null;

      return {
        url: window.location.href,
        title: document.title,
        hasFrames: window.frames.length > 0,
        documentReadyState: document.readyState,
        bodyTag,
        metaDescription,
        headingsCount: headings,
        formsCount: document.querySelectorAll("form").length,
        buttonsCount: document.querySelectorAll(
          'button, input[type="button"], input[type="submit"]',
        ).length,
        linksCount: document.querySelectorAll("a[href]").length,
        imagesCount: document.querySelectorAll("img").length,
      };
    });

    const viewportSize = page.viewportSize() || { width: 0, height: 0 };

    return {
      ...properties,
      viewportSize,
    };
  }

  private extractKeywordMatches(text: string, keywords: string[]): string {
    const lowerText = text.toLowerCase();
    const matches = keywords.filter((keyword) =>
      lowerText.includes(keyword.toLowerCase()),
    );
    return matches.length > 0 ? matches.join(", ") : "none";
  }
}
