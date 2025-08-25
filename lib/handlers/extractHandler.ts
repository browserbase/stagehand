import { z, ZodTypeAny } from "zod/v3";
import { LogLine } from "../../types/log";
import { ZodPathSegments } from "../../types/stagehand";
import { extract } from "../inference";
import { LLMClient } from "../llm/LLMClient";
import { injectUrls, transformSchema } from "../utils";
import { StagehandPage } from "../StagehandPage";
import { Stagehand, StagehandFunctionName } from "../index";
import { pageTextSchema } from "../../types/page";
import {
  getAccessibilityTree,
  getAccessibilityTreeWithFrames,
} from "@/lib/a11y/utils";
import { EncodedId } from "@/types/context";

export class StagehandExtractHandler {
  private readonly stagehand: Stagehand;
  private readonly stagehandPage: StagehandPage;
  private readonly logger: (logLine: LogLine) => void;
  private readonly userProvidedInstructions?: string;
  private readonly experimental: boolean;

  constructor({
    stagehand,
    logger,
    stagehandPage,
    userProvidedInstructions,
    experimental,
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
    experimental: boolean;
  }) {
    this.stagehand = stagehand;
    this.logger = logger;
    this.stagehandPage = stagehandPage;
    this.userProvidedInstructions = userProvidedInstructions;
    this.experimental = experimental;
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
      iframes,
    });
  }

  private async extractPageText(
    domSettleTimeoutMs?: number,
  ): Promise<{ page_text?: string }> {
    await this.stagehandPage._waitForSettledDom(domSettleTimeoutMs);
    const tree = await getAccessibilityTree(
      this.experimental,
      this.stagehandPage,
      this.logger,
    );
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
    iframes,
  }: {
    instruction: string;
    schema: T;
    content?: z.infer<T>;
    llmClient: LLMClient;
    requestId?: string;
    domSettleTimeoutMs?: number;
    selector?: string;
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

    await this.stagehandPage._waitForSettledDom(domSettleTimeoutMs);
    const targetXpath = selector?.replace(/^xpath=/, "") ?? "";
    const {
      combinedTree: outputString,
      combinedUrlMap: idToUrlMapping,
      discoveredIframes,
    } = await (iframes
      ? getAccessibilityTreeWithFrames(
          this.experimental,
          this.stagehandPage,
          this.logger,
          targetXpath,
        ).then(({ combinedTree, combinedUrlMap }) => ({
          combinedTree,
          combinedUrlMap,
          combinedXpathMap: {} as Record<EncodedId, string>,
          discoveredIframes: [] as undefined,
        }))
      : getAccessibilityTree(
          this.experimental,
          this.stagehandPage,
          this.logger,
          targetXpath,
        ).then(({ simplified, idToUrl, iframes: frameNodes }) => ({
          combinedTree: simplified,
          combinedUrlMap: idToUrl as Record<EncodedId, string>,
          combinedXpathMap: {} as Record<EncodedId, string>,
          discoveredIframes: frameNodes,
        })));

    this.logger({
      category: "extraction",
      message: "Got accessibility tree data",
      level: 1,
    });

    if (discoveredIframes !== undefined && discoveredIframes.length > 0) {
      this.logger({
        category: "extraction",
        message: `Warning: found ${discoveredIframes.length} iframe(s) on the page. If you wish to interact with iframe content, please make sure you are setting iframes: true`,
        level: 1,
      });
    }

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
