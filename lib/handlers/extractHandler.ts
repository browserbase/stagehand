import { z, ZodTypeAny } from "zod";
import { LogLine } from "../../types/log";
import { ZodPathSegments } from "../../types/stagehand";
import { LLMClient } from "../llm/LLMClient";
import { transformSchema } from "../utils";
import { StagehandPage } from "../StagehandPage";
import { Stagehand, StagehandFunctionName } from "../index";
import { pageTextSchema } from "../../types/page";
// Removed direct accessibility tree imports - now handled by ContextManager
import { ContextManager } from "../context";

export class StagehandExtractHandler {
  private readonly stagehand: Stagehand;
  private readonly stagehandPage: StagehandPage;
  private readonly logger: (logLine: LogLine) => void;
  private readonly userProvidedInstructions?: string;
  private readonly contextManager: ContextManager;

  constructor({
    stagehand,
    logger,
    stagehandPage,
    userProvidedInstructions,
    contextManager,
  }: {
    stagehand: Stagehand;
    logger: (message: {
      category?: string;
      message: string;
      level?: number;
      auxiliary?: { [key: string]: { value: string; type: string } };
    }) => void;
    stagehandPage: StagehandPage;
    userProvidedInstructions?: string;
    contextManager: ContextManager;
  }) {
    this.stagehand = stagehand;
    this.logger = logger;
    this.stagehandPage = stagehandPage;
    this.userProvidedInstructions = userProvidedInstructions;
    this.contextManager = contextManager;
  }

  public async extract<T extends z.AnyZodObject>({
    instruction,
    schema,
    content = {},
    llmClient,
    requestId,
    domSettleTimeoutMs: _domSettleTimeoutMs, // eslint-disable-line @typescript-eslint/no-unused-vars
    useTextExtract,
    selector: _selector,
    iframes,
  }: {
    instruction?: string;
    schema?: T;
    content?: z.infer<T>;
    chunksSeen?: Array<number>;
    llmClient?: LLMClient;
    requestId?: string;
    domSettleTimeoutMs?: number;
    useTextExtract?: boolean;
    selector?: string;
    iframes?: boolean;
  } = {}): Promise<z.infer<T>> {
    const noArgsCalled = !instruction && !schema && !llmClient && !_selector;
    if (noArgsCalled) {
      this.logger({
        category: "extraction",
        message: "Extracting the entire page text.",
        level: 1,
      });
      return this.extractPageText();
    }

    if (useTextExtract !== undefined) {
      this.logger({
        category: "extraction",
        message:
          "Warning: the `useTextExtract` parameter has no effect in this version of Stagehand and will be removed in future versions.",
        level: 1,
      });
    }
    return this.domExtract({
      instruction,
      schema,
      content,
      requestId,
      iframes,
    });
  }

  private async extractPageText(): Promise<{ page_text?: string }> {
    // Use ContextManager to get accessibility tree
    const contextData = await this.contextManager.buildContext({
      method: "extract",
      instruction: "extract page text",
      takeScreenshot: false,
      includeAccessibilityTree: true,
      appendToHistory: false,
    });

    const outputString = contextData.optimizedElements;

    const result = { page_text: outputString };
    return pageTextSchema.parse(result);
  }

  private async domExtract<T extends z.AnyZodObject>({
    instruction,
    schema,
    requestId,
    iframes,
  }: {
    instruction: string;
    schema: T;
    content?: z.infer<T>;
    requestId?: string;
    iframes?: boolean;
  }): Promise<z.infer<T>> {
    this.logger({
      category: "extraction",
      message: "starting extraction using a11y tree",
      level: 1,
      auxiliary: {
        instruction: {
          value: instruction,
          type: "string",
        },
      },
    });

    // Use ContextManager to get accessibility tree with all the proper handling
    const contextData = await this.contextManager.buildContext({
      method: "extract",
      instruction,
      takeScreenshot: false,
      includeAccessibilityTree: true,
      appendToHistory: false,
      iframes,
    });

    const outputString = contextData.optimizedElements;
    // Note: idToUrlMapping will be handled internally by ContextManager during performExtract

    // Transform user defined schema to replace string().url() with .number()
    // Note: URL field transformation is now handled internally by ContextManager
    const [transformedSchema] = transformUrlStringsToNumericIds(schema);

    // Optimize DOM elements using ContextManager if available
    let optimizedDomElements = outputString;
    if (this.contextManager) {
      try {
        this.logger({
          category: "extraction",
          message:
            "Using ContextManager to optimize DOM elements for extraction",
          level: 1,
        });

        const contextData = await this.contextManager.buildContext({
          method: "extract",
          instruction,
          takeScreenshot: false,
          includeAccessibilityTree: false, // We already have the tree
          domElements: outputString,
          appendToHistory: false,
        });

        optimizedDomElements = contextData.optimizedElements || outputString;
      } catch (error) {
        this.logger({
          category: "extraction",
          message: `ContextManager optimization failed, using original DOM: ${error}`,
          level: 1,
        });
      }
    }

    // call extract inference with transformed schema
    const extractionResponse = await this.contextManager.performExtract({
      instruction,
      domElements: optimizedDomElements,
      schema: transformedSchema,
      chunksSeen: 1,
      chunksTotal: 1,
      requestId,
      userProvidedInstructions: this.userProvidedInstructions,
    });

    const {
      data: output,
      metadata: { completed },
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      inference_time_ms: inferenceTimeMs,
    } = extractionResponse;

    this.stagehand.updateMetrics(
      StagehandFunctionName.EXTRACT,
      promptTokens,
      completionTokens,
      inferenceTimeMs,
    );

    this.logger({
      category: "extraction",
      message: "received extraction response",
      auxiliary: {
        extraction_response: {
          value: JSON.stringify(extractionResponse),
          type: "object",
        },
      },
    });

    if (completed) {
      this.logger({
        category: "extraction",
        message: "extraction completed successfully",
        level: 1,
        auxiliary: {
          extraction_response: {
            value: JSON.stringify(extractionResponse),
            type: "object",
          },
        },
      });
    } else {
      this.logger({
        category: "extraction",
        message: "extraction incomplete after processing all data",
        level: 1,
        auxiliary: {
          extraction_response: {
            value: JSON.stringify(extractionResponse),
            type: "object",
          },
        },
      });
    }

    // URL mapping is now handled internally by ContextManager during performExtract

    return output as z.infer<T>;
  }
}

/**
 * Scans the provided Zod schema for any `z.string().url()` fields and
 * replaces them with `z.number()`.
 *
 * @param schema - The Zod object schema to transform.
 * @returns A tuple containing:
 *   1. The transformed schema (or the original schema if no changes were needed).
 *   2. An array of {@link ZodPathSegments} objects representing all the replaced URL fields,
 *      with each path segment showing where in the schema the replacement occurred.
 */
export function transformUrlStringsToNumericIds<
  T extends z.ZodObject<z.ZodRawShape>,
>(schema: T): [T, ZodPathSegments[]] {
  const shape = schema._def.shape();
  const newShape: Record<string, ZodTypeAny> = {};
  const urlPaths: ZodPathSegments[] = [];
  let changed = false;

  for (const [key, value] of Object.entries(shape)) {
    const [childTransformed, childPaths] = transformSchema(value, [key]);
    newShape[key] = childTransformed;
    if (childTransformed !== value) {
      changed = true;
    }
    if (childPaths.length > 0) {
      childPaths.forEach((cp) => {
        urlPaths.push({ segments: [key, ...cp.segments] });
      });
    }
  }

  const finalSchema = changed ? z.object(newShape) : schema;
  return [finalSchema as T, urlPaths];
}
