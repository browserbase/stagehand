import { z, ZodTypeAny } from "zod";
import { LogLine } from "../../types/log";
import { ZodPathSegments } from "../../types/stagehand";
import { extract } from "../inference";
import { LLMClient } from "../llm/LLMClient";
import { injectUrls, transformSchema } from "../utils";
import { StagehandPage } from "../StagehandPage";
import { Stagehand, StagehandFunctionName } from "../index";
import { pageTextSchema } from "../../types/page";
import { getAccessibilityTree } from "@/lib/a11y/utils";

export class StagehandExtractHandler {
  private readonly stagehand: Stagehand;
  private readonly stagehandPage: StagehandPage;
  private readonly logger: (logLine: LogLine) => void;
  private readonly userProvidedInstructions?: string;

  constructor({
    stagehand,
    logger,
    stagehandPage,
    userProvidedInstructions,
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
  }) {
    this.stagehand = stagehand;
    this.logger = logger;
    this.stagehandPage = stagehandPage;
    this.userProvidedInstructions = userProvidedInstructions;
  }

  public async extract<T extends z.AnyZodObject>({
    instruction,
    schema,
    content = {},
    llmClient,
    requestId,
    domSettleTimeoutMs,
    useTextExtract,
    selector,
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
  } = {}): Promise<z.infer<T>> {
    const noArgsCalled = !instruction && !schema && !llmClient && !selector;
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
      llmClient,
      requestId,
      domSettleTimeoutMs,
      selector,
    });
  }

  private async extractPageText(
    domSettleTimeoutMs?: number,
  ): Promise<{ page_text?: string }> {
    await this.stagehandPage._waitForSettledDom(domSettleTimeoutMs);
    const tree = await getAccessibilityTree(this.stagehandPage, this.logger);
    this.logger({
      category: "extraction",
      message: "Getting accessibility tree data",
      level: 1,
    });
    const outputString = tree.simplified;

    const result = { page_text: outputString };
    return pageTextSchema.parse(result);
  }

  private async domExtract<T extends z.AnyZodObject>({
    instruction,
    schema,
    llmClient,
    requestId,
    domSettleTimeoutMs,
    selector,
  }: {
    instruction: string;
    schema: T;
    content?: z.infer<T>;
    llmClient: LLMClient;
    requestId?: string;
    domSettleTimeoutMs?: number;
    selector?: string;
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

    await this.stagehandPage._waitForSettledDom(domSettleTimeoutMs);
    const targetXpath = selector?.replace(/^xpath=/, "") ?? "";
    const tree = await getAccessibilityTree(
      this.stagehandPage,
      this.logger,
      targetXpath,
    );
    this.logger({
      category: "extraction",
      message: "Getting accessibility tree data",
      level: 1,
    });
    const outputString = tree.simplified;
    const idToUrlMapping = tree.idToUrl;

    // Transform user defined schema to replace string().url() with .number()
    const [transformedSchema, urlFieldPaths] =
      transformUrlStringsToNumericIds(schema);

    // call extract inference with transformed schema
    const extractionResponse = await extract({
      instruction,
      domElements: outputString,
      schema: transformedSchema,
      chunksSeen: 1,
      chunksTotal: 1,
      llmClient,
      requestId,
      userProvidedInstructions: this.userProvidedInstructions,
      logger: this.logger,
      logInferenceToFile: this.stagehand.logInferenceToFile,
    });

    const {
      metadata: { completed },
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      inference_time_ms: inferenceTimeMs,
      ...output
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

    // revert to original schema and populate with URLs
    for (const { segments } of urlFieldPaths) {
      injectUrls(output, segments, idToUrlMapping);
    }

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
