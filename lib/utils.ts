import crypto from "crypto";
import { ZodFirstPartyTypeKind as Kind, z } from "zod";
import { ObserveResult, Page } from ".";
import { LogLine } from "../types/log";
import { ZodPathSegments } from "../types/stagehand";
import { TextAnnotation } from "../types/textannotation";
import { Schema, Type } from "@google/genai";
import { ModelProvider } from "../types/model";

// This is a heuristic for the width of a character in pixels. It seems to work
// better than attempting to calculate character widths dynamically, which sometimes
// results in collisions when placing characters on the "canvas".
const HEURISTIC_CHAR_WIDTH = 5;

export function generateId(operation: string) {
  return crypto.createHash("sha256").update(operation).digest("hex");
}

/**
 * `formatText` converts a list of text annotations into a formatted text representation.
 * Each annotation represents a piece of text at a certain position on a webpage.
 * The formatting attempts to reconstruct a textual "screenshot" of the page by:
 * - Grouping annotations into lines based on their vertical positions.
 * - Adjusting spacing to reflect line gaps.
 * - Attempting to preserve relative positions and formatting.
 *
 * The output is a text block, optionally surrounded by lines of dashes, that aims
 * to closely mirror the visual layout of the text on the page.
 *
 * @param textAnnotations - An array of TextAnnotations describing text and their positions.
 * @param pageWidth - The width of the page in pixels, used to normalize positions.
 * @returns A string representing the text layout of the page.
 */
export function formatText(
  textAnnotations: TextAnnotation[],
  pageWidth: number,
): string {
  // **1: Sort annotations by vertical position (y-coordinate).**
  //    The topmost annotations appear first, the bottommost last.
  const sortedAnnotations = [...textAnnotations].sort(
    (a, b) => a.bottom_left.y - b.bottom_left.y,
  );

  // **2: Group annotations by line based on their y-coordinate.**
  //    We use an epsilon so that very close y-values are treated as the same line.
  const epsilon = 1;
  const lineMap: Map<number, TextAnnotation[]> = new Map();

  for (const annotation of sortedAnnotations) {
    let foundLineY: number | undefined;
    // **3: Check if this annotation belongs to any existing line group.**
    for (const key of lineMap.keys()) {
      if (Math.abs(key - annotation.bottom_left.y) < epsilon) {
        foundLineY = key;
        break;
      }
    }

    // If found, push into that line; otherwise, create a new line entry.
    if (foundLineY !== undefined) {
      lineMap.get(foundLineY)!.push(annotation);
    } else {
      lineMap.set(annotation.bottom_left.y, [annotation]);
    }
  }

  // **4: Get all unique y-coordinates for lines and sort them top-to-bottom.**
  const lineYs = Array.from(lineMap.keys()).sort((a, b) => a - b);

  // **5: Build an array of "final lines" (TextAnnotations[]) by grouping words for each line.**
  const finalLines: TextAnnotation[][] = [];

  for (const lineY of lineYs) {
    const lineAnnotations = lineMap.get(lineY)!;

    // **6: Sort annotations in the current line left-to-right by x-coordinate.**
    lineAnnotations.sort((a, b) => a.bottom_left.x - b.bottom_left.x);

    // **7: Group annotations into word clusters (sentences/phrases).**
    const groupedLineAnnotations = groupWordsInSentence(lineAnnotations);

    // **8: Push the grouped annotations for this line into finalLines.**
    finalLines.push(groupedLineAnnotations);
  }

  // -------------------------
  // **First Pass**: Calculate the width of the longest line (in characters) up front.
  // We will use this to set the width of the canvas, which will reduce likelihood of collisions.
  // -------------------------
  let maxLineWidthInChars = 0;

  for (const line of finalLines) {
    let lineMaxEnd = 0;
    for (const ann of line) {
      // Convert normalized X to character index
      const startXInChars = Math.round(
        ann.bottom_left_normalized.x * (pageWidth / HEURISTIC_CHAR_WIDTH),
      );
      // Each annotation spans ann.text.length characters
      const endXInChars = startXInChars + ann.text.length;

      if (endXInChars > lineMaxEnd) {
        lineMaxEnd = endXInChars;
      }
    }
    // Track the largest width across all lines
    if (lineMaxEnd > maxLineWidthInChars) {
      maxLineWidthInChars = lineMaxEnd;
    }
  }

  // **9: Add a 20-char buffer to ensure we don’t cut off text.**
  maxLineWidthInChars += 20;

  // **10: Determine the canvas width based on the measured maxLineWidthInChars.**
  const canvasWidth = Math.max(maxLineWidthInChars, 1);

  // **11: Compute the baseline (lowest y) of each line to measure vertical spacing.**
  const lineBaselines = finalLines.map((line) =>
    Math.min(...line.map((a) => a.bottom_left.y)),
  );

  // **12: Compute the gaps between consecutive lines.**
  const verticalGaps: number[] = [];
  for (let i = 1; i < lineBaselines.length; i++) {
    verticalGaps.push(lineBaselines[i] - lineBaselines[i - 1]);
  }

  // **13: Estimate a "normal" line spacing via the median of these gaps.**
  const normalLineSpacing = verticalGaps.length > 0 ? median(verticalGaps) : 0;

  // **14: Create a 2D character canvas (array of arrays), filled with spaces.**
  let canvas: string[][] = [];

  // **15: lineIndex tracks which row of the canvas we’re on; start at -1 so the first line is index 0.**
  let lineIndex = -1;

  // **16: Render each line of text into our canvas.**
  for (let i = 0; i < finalLines.length; i++) {
    if (i === 0) {
      // **17: For the very first line, just increment lineIndex once.**
      lineIndex++;
      ensureLineExists(canvas, lineIndex, canvasWidth);
    } else {
      // **18: For subsequent lines, figure out how many blank lines to insert
      //       based on the gap between this line's baseline and the previous line’s baseline.**
      const gap = lineBaselines[i] - lineBaselines[i - 1];

      let extraLines = 0;
      // **19: If the gap is significantly larger than the "normal" spacing,
      //       insert blank lines proportionally.**
      if (normalLineSpacing > 0 && gap > 1.2 * normalLineSpacing) {
        extraLines = Math.max(Math.round(gap / normalLineSpacing) - 1, 0);
      }

      // **20: Insert the calculated extra blank lines.**
      for (let e = 0; e < extraLines; e++) {
        lineIndex++;
        ensureLineExists(canvas, lineIndex, canvasWidth);
      }

      // **21: Move to the next line (row) in the canvas for this line’s text.**
      lineIndex++;
      ensureLineExists(canvas, lineIndex, canvasWidth);
    }

    // **22: Place each annotation’s text in the correct horizontal position for this line.**
    const lineAnnotations = finalLines[i];
    for (const annotation of lineAnnotations) {
      const text = annotation.text;

      // **23: Calculate the starting x-position in the canvas by converting normalized x to char space.**
      const startXInChars = Math.round(
        annotation.bottom_left_normalized.x *
          (pageWidth / HEURISTIC_CHAR_WIDTH),
      );

      // **24: Place each character of the annotation in the canvas.**
      for (let j = 0; j < text.length; j++) {
        const xPos = startXInChars + j;
        // **25: Don’t write beyond the right edge of the canvas.**
        if (xPos < canvasWidth) {
          canvas[lineIndex][xPos] = text[j];
        }
      }
    }
  }

  // **26: Trim trailing whitespace from each line to clean up the output.**
  canvas = canvas.map((row) => {
    const lineStr = row.join("");
    return Array.from(lineStr.trimEnd());
  });

  // **27: Combine all rows into a single string, separating rows with newlines.**
  let pageText = canvas.map((line) => line.join("")).join("\n");
  pageText = pageText.trimEnd();

  // **28: Surround the rendered text with lines of dashes for clarity.**
  pageText =
    "-".repeat(canvasWidth) + "\n" + pageText + "\n" + "-".repeat(canvasWidth);

  // **29: Return the final formatted text.**
  return pageText;
}

/**
 * `ensureLineExists` ensures that a specified line index exists in the canvas.
 * If the canvas is not long enough, it extends it by adding new empty lines (filled with spaces).
 * This function is used to dynamically grow the canvas as we progress through the lines.
 *
 * @param canvas - The 2D character canvas array.
 * @param lineIndex - The desired line index that must exist.
 * @param width - The width of each line in characters.
 */
function ensureLineExists(
  canvas: string[][],
  lineIndex: number,
  width: number,
) {
  // loop until the canvas has at least lineIndex+1 lines.
  // each new line is filled with spaces to match the required width.
  while (lineIndex >= canvas.length) {
    canvas.push(new Array(width).fill(" "));
  }
}

/**
 * `groupWordsInSentence` groups annotations within a single line into logical "words" or "sentences".
 * It uses a set of heuristics involving horizontal proximity and similar height
 * to decide when to join multiple annotations into a single grouped annotation.
 *
 * @param lineAnnotations - An array of annotations from a single line of text.
 * @returns An array of grouped annotations, where each represents one concatenated piece of text.
 */
function groupWordsInSentence(
  lineAnnotations: TextAnnotation[],
): TextAnnotation[] {
  const groupedAnnotations: TextAnnotation[] = [];
  let currentGroup: TextAnnotation[] = [];

  for (const annotation of lineAnnotations) {
    // if the current group is empty, start a new group with this annotation
    if (currentGroup.length === 0) {
      currentGroup.push(annotation);
      continue;
    }

    // determine horizontal grouping criteria
    // use a padding factor to allow slight spaces between words
    const padding = 1;
    const lastAnn = currentGroup[currentGroup.length - 1];
    const characterWidth = (lastAnn.width / lastAnn.text.length) * padding;
    const isWithinHorizontalRange =
      annotation.bottom_left.x <=
      lastAnn.bottom_left.x + lastAnn.width + characterWidth;

    // check if the annotation can be grouped with the current group.
    // conditions:
    // 1. the height difference from the group's first annotation is ≤ 4 units
    // 2. the annotation is horizontally close to the last annotation in the group
    if (
      Math.abs(annotation.height - currentGroup[0].height) <= 4 &&
      isWithinHorizontalRange
    ) {
      // if it meets the criteria, add to the current group
      currentGroup.push(annotation);
    } else {
      // if it doesn't meet criteria:
      // 1. finalize the current group into a single grouped annotation,
      // 2. add it to groupedAnnotations,
      // 3. start a new group with the current annotation
      if (currentGroup.length > 0) {
        const groupedAnnotation = createGroupedAnnotation(currentGroup);
        if (groupedAnnotation.text.length > 0) {
          groupedAnnotations.push(groupedAnnotation);
          currentGroup = [annotation];
        }
      }
    }
  }

  // after processing all annotations, if there's a remaining group, finalize it too
  if (currentGroup.length > 0) {
    const groupedAnnotation = createGroupedAnnotation(currentGroup);
    groupedAnnotations.push(groupedAnnotation);
  }

  // return the final array of grouped annotations representing words or phrases
  return groupedAnnotations;
}

/**
 * `createGroupedAnnotation` combines a group of annotations into a single annotation by concatenating their text.
 * It also attempts to preserve formatting, such as marking bold text if the median height suggests emphasis.
 *
 * @param group - An array of annotations that should be merged into a single text element.
 * @returns A new TextAnnotation representing the combined text and averaged metrics from the group.
 */
function createGroupedAnnotation(group: TextAnnotation[]): TextAnnotation {
  // initialize an empty string to build the combined text.
  let text = "";

  // concatenate the text from each annotation in the group.
  // insert a space between words, except when punctuation directly follows a word
  for (const word of group) {
    if (
      [".", ",", '"', "'", ":", ";", "!", "?", "{", "}", "’", "”"].includes(
        word.text,
      )
    ) {
      text += word.text;
    } else {
      text += text !== "" ? " " + word.text : word.text;
    }
  }

  // determine if the combined text qualifies as a "word" (contains alphanumeric chars)
  // and whether its median height suggests emphasizing it (e.g., bold text).
  const isWord = /[a-zA-Z0-9]/.test(text);
  const medianHeight = median(group.map((word) => word.height));

  // if it's considered a word and tall enough, surround it with `**` for bold formatting.
  if (isWord && medianHeight > 25) {
    text = "**" + text + "**";
  }

  // return a new annotation that represents the merged group.
  // use the first annotation's coordinates and normalized positions as references,
  // and sum the widths of all annotations to get the total width.
  return {
    text: text,
    bottom_left: {
      x: group[0].bottom_left.x,
      y: group[0].bottom_left.y,
    },
    bottom_left_normalized: {
      x: group[0].bottom_left_normalized.x,
      y: group[0].bottom_left_normalized.y,
    },
    width: group.reduce((sum, a) => sum + a.width, 0),
    height: group[0].height,
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);

  if (sorted.length % 2 === 0) {
    return (sorted[middle - 1] + sorted[middle]) / 2;
  } else {
    return sorted[middle];
  }
}

export function logLineToString(logLine: LogLine): string {
  try {
    const timestamp = logLine.timestamp || new Date().toISOString();
    if (logLine.auxiliary?.error) {
      return `${timestamp}::[stagehand:${logLine.category}] ${logLine.message}\n ${logLine.auxiliary.error.value}\n ${logLine.auxiliary.trace.value}`;
    }
    return `${timestamp}::[stagehand:${logLine.category}] ${logLine.message} ${
      logLine.auxiliary ? JSON.stringify(logLine.auxiliary) : ""
    }`;
  } catch (error) {
    console.error(`Error logging line:`, error);
    return "error logging line";
  }
}

export function validateZodSchema(schema: z.ZodTypeAny, data: unknown) {
  try {
    schema.parse(data);
    return true;
  } catch {
    return false;
  }
}

export async function drawObserveOverlay(page: Page, results: ObserveResult[]) {
  // Convert single xpath to array for consistent handling
  const xpathList = results.map((result) => result.selector);

  // Filter out empty xpaths
  const validXpaths = xpathList.filter((xpath) => xpath !== "xpath=");

  await page.evaluate((selectors) => {
    selectors.forEach((selector) => {
      let element;
      if (selector.startsWith("xpath=")) {
        const xpath = selector.substring(6);
        element = document.evaluate(
          xpath,
          document,
          null,
          XPathResult.FIRST_ORDERED_NODE_TYPE,
          null,
        ).singleNodeValue;
      } else {
        element = document.querySelector(selector);
      }

      if (element instanceof HTMLElement) {
        const overlay = document.createElement("div");
        overlay.setAttribute("stagehandObserve", "true");
        const rect = element.getBoundingClientRect();
        overlay.style.position = "absolute";
        overlay.style.left = rect.left + "px";
        overlay.style.top = rect.top + "px";
        overlay.style.width = rect.width + "px";
        overlay.style.height = rect.height + "px";
        overlay.style.backgroundColor = "rgba(255, 255, 0, 0.3)";
        overlay.style.pointerEvents = "none";
        overlay.style.zIndex = "10000";
        document.body.appendChild(overlay);
      }
    });
  }, validXpaths);
}

export async function clearOverlays(page: Page) {
  // remove existing stagehandObserve attributes
  await page.evaluate(() => {
    const elements = document.querySelectorAll('[stagehandObserve="true"]');
    elements.forEach((el) => {
      const parent = el.parentNode;
      while (el.firstChild) {
        parent?.insertBefore(el.firstChild, el);
      }
      parent?.removeChild(el);
    });
  });
}

/**
 * Detects if the code is running in the Bun runtime environment.
 * @returns {boolean} True if running in Bun, false otherwise.
 */
export function isRunningInBun(): boolean {
  return (
    typeof process !== "undefined" &&
    typeof process.versions !== "undefined" &&
    "bun" in process.versions
  );
}

/*
 * Helper functions for converting between Gemini and Zod schemas
 */
function decorateGeminiSchema(
  geminiSchema: Schema,
  zodSchema: z.ZodTypeAny,
): Schema {
  if (geminiSchema.nullable === undefined) {
    geminiSchema.nullable = zodSchema.isOptional();
  }

  if (zodSchema.description) {
    geminiSchema.description = zodSchema.description;
  }

  return geminiSchema;
}

export function toGeminiSchema(zodSchema: z.ZodTypeAny): Schema {
  const zodType = getZodType(zodSchema);

  switch (zodType) {
    case "ZodArray": {
      return decorateGeminiSchema(
        {
          type: Type.ARRAY,
          items: toGeminiSchema(
            (zodSchema as z.ZodArray<z.ZodTypeAny>).element,
          ),
        },
        zodSchema,
      );
    }
    case "ZodObject": {
      const properties: Record<string, Schema> = {};
      const required: string[] = [];

      Object.entries((zodSchema as z.ZodObject<z.ZodRawShape>).shape).forEach(
        ([key, value]: [string, z.ZodTypeAny]) => {
          properties[key] = toGeminiSchema(value);
          if (getZodType(value) !== "ZodOptional") {
            required.push(key);
          }
        },
      );

      return decorateGeminiSchema(
        {
          type: Type.OBJECT,
          properties,
          required: required.length > 0 ? required : undefined,
        },
        zodSchema,
      );
    }
    case "ZodString":
      return decorateGeminiSchema(
        {
          type: Type.STRING,
        },
        zodSchema,
      );
    case "ZodNumber":
      return decorateGeminiSchema(
        {
          type: Type.NUMBER,
        },
        zodSchema,
      );
    case "ZodBoolean":
      return decorateGeminiSchema(
        {
          type: Type.BOOLEAN,
        },
        zodSchema,
      );
    case "ZodEnum":
      return decorateGeminiSchema(
        {
          type: Type.STRING,
          enum: zodSchema._def.values,
        },
        zodSchema,
      );
    case "ZodDefault":
    case "ZodNullable":
    case "ZodOptional": {
      const innerSchema = toGeminiSchema(zodSchema._def.innerType);
      return decorateGeminiSchema(
        {
          ...innerSchema,
          nullable: true,
        },
        zodSchema,
      );
    }
    case "ZodLiteral":
      return decorateGeminiSchema(
        {
          type: Type.STRING,
          enum: [zodSchema._def.value],
        },
        zodSchema,
      );
    default:
      return decorateGeminiSchema(
        {
          type: Type.OBJECT,
          nullable: true,
        },
        zodSchema,
      );
  }
}

// Helper function to check the type of Zod schema
export function getZodType(schema: z.ZodTypeAny): string {
  return schema._def.typeName;
}

/**
 * Recursively traverses a given Zod schema, scanning for any fields of type `z.string().url()`.
 * For each such field, it replaces the `z.string().url()` with `z.number()`.
 *
 * This function is used internally by higher-level utilities (e.g., transforming entire object schemas)
 * and handles nested objects, arrays, unions, intersections, optionals.
 *
 * @param schema - The Zod schema to transform.
 * @param currentPath - An array of string/number keys representing the current schema path (used internally for recursion).
 * @returns A two-element tuple:
 *   1. The updated Zod schema, with any `.url()` fields replaced by `z.number()`.
 *   2. An array of {@link ZodPathSegments} objects representing each replaced field, including the path segments.
 */
export function transformSchema(
  schema: z.ZodTypeAny,
  currentPath: Array<string | number>,
): [z.ZodTypeAny, ZodPathSegments[]] {
  // 1) If it's a string with .url(), convert to z.number()
  if (isKind(schema, Kind.ZodString)) {
    const hasUrlCheck =
      schema._def.checks?.some(
        (check: { kind: string }) => check.kind === "url",
      ) ?? false;
    if (hasUrlCheck) {
      return [makeIdNumberSchema(schema as z.ZodString), [{ segments: [] }]];
    }
    return [schema, []];
  }

  // 2) If it's an object, transform each field
  if (isKind(schema, Kind.ZodObject)) {
    // The shape is a raw object containing fields keyed by string (no symbols):
    const shape = schema._def.shape() as Record<string, z.ZodTypeAny>;
    const newShape: Record<string, z.ZodTypeAny> = {};
    const urlPaths: ZodPathSegments[] = [];
    let changed = false;

    const shapeKeys = Object.keys(shape);

    for (const key of shapeKeys) {
      const child = shape[key];
      const [transformedChild, childPaths] = transformSchema(child, [
        ...currentPath,
        key,
      ]);

      if (transformedChild !== child) {
        changed = true;
      }
      newShape[key] = transformedChild;

      if (childPaths.length > 0) {
        for (const cp of childPaths) {
          urlPaths.push({ segments: [key, ...cp.segments] });
        }
      }
    }

    if (changed) {
      return [z.object(newShape), urlPaths];
    }
    return [schema, urlPaths];
  }

  // 3) If it's an array, transform its item type
  if (isKind(schema, Kind.ZodArray)) {
    const itemType = schema._def.type as z.ZodTypeAny;
    const [transformedItem, childPaths] = transformSchema(itemType, [
      ...currentPath,
      "*",
    ]);
    const changed = transformedItem !== itemType;
    const arrayPaths: ZodPathSegments[] = childPaths.map((cp) => ({
      segments: ["*", ...cp.segments],
    }));

    if (changed) {
      return [z.array(transformedItem), arrayPaths];
    }
    return [schema, arrayPaths];
  }

  // 4) If it's a union, transform each option
  if (isKind(schema, Kind.ZodUnion)) {
    // Cast the union’s options to an array of ZodTypeAny
    const unionOptions = schema._def.options as z.ZodTypeAny[];
    const newOptions: z.ZodTypeAny[] = [];
    let changed = false;
    let allPaths: ZodPathSegments[] = [];

    unionOptions.forEach((option: z.ZodTypeAny, idx: number) => {
      const [newOption, childPaths] = transformSchema(option, [
        ...currentPath,
        `union_${idx}`,
      ]);
      if (newOption !== option) {
        changed = true;
      }
      newOptions.push(newOption);
      allPaths = [...allPaths, ...childPaths];
    });

    if (changed) {
      // We assume at least two options remain:
      return [
        z.union(newOptions as [z.ZodTypeAny, z.ZodTypeAny, ...z.ZodTypeAny[]]),
        allPaths,
      ];
    }
    return [schema, allPaths];
  }

  // 5) If it's an intersection, transform left and right
  if (isKind(schema, Kind.ZodIntersection)) {
    const leftType = schema._def.left as z.ZodTypeAny;
    const rightType = schema._def.right as z.ZodTypeAny;

    const [left, leftPaths] = transformSchema(leftType, [
      ...currentPath,
      "intersection_left",
    ]);
    const [right, rightPaths] = transformSchema(rightType, [
      ...currentPath,
      "intersection_right",
    ]);
    const changed = left !== leftType || right !== rightType;
    const allPaths = [...leftPaths, ...rightPaths];
    if (changed) {
      return [z.intersection(left, right), allPaths];
    }
    return [schema, allPaths];
  }

  // 6) If it's optional, transform inner
  if (isKind(schema, Kind.ZodOptional)) {
    const innerType = schema._def.innerType as z.ZodTypeAny;
    const [inner, innerPaths] = transformSchema(innerType, currentPath);
    if (inner !== innerType) {
      return [z.optional(inner), innerPaths];
    }
    return [schema, innerPaths];
  }

  // 7) If it's nullable, transform inner
  if (isKind(schema, Kind.ZodNullable)) {
    const innerType = schema._def.innerType as z.ZodTypeAny;
    const [inner, innerPaths] = transformSchema(innerType, currentPath);
    if (inner !== innerType) {
      return [z.nullable(inner), innerPaths];
    }
    return [schema, innerPaths];
  }

  // 8) If it's an effect, transform base schema
  if (isKind(schema, Kind.ZodEffects)) {
    const baseSchema = schema._def.schema as z.ZodTypeAny;
    const [newBaseSchema, basePaths] = transformSchema(baseSchema, currentPath);
    if (newBaseSchema !== baseSchema) {
      return [z.effect(newBaseSchema, schema._def.effect), basePaths];
    }
    return [schema, basePaths];
  }

  // 9) If none of the above, return as-is
  return [schema, []];
}

/**
 * Once we get the final extracted object that has numeric IDs in place of URLs,
 * use `injectUrls` to walk the object and replace numeric IDs
 * with the real URL strings from idToUrlMapping. The `path` may include `*`
 * for array indices (indicating "all items in the array").
 */
export function injectUrls(
  obj: unknown,
  path: Array<string | number>,
  idToUrlMapping: Record<string, string>,
): void {
  if (path.length === 0) return;
  const [key, ...rest] = path;

  if (key === "*") {
    if (Array.isArray(obj)) {
      for (const item of obj) {
        injectUrls(item, rest, idToUrlMapping);
      }
    }
    return;
  }

  if (obj && typeof obj === "object") {
    const record = obj as Record<string | number, unknown>;
    if (path.length === 1) {
      const fieldValue = record[key];
      if (typeof fieldValue === "number") {
        const mappedUrl = idToUrlMapping[String(fieldValue)];
        record[key] = mappedUrl ?? ``;
      }
    } else {
      injectUrls(record[key], rest, idToUrlMapping);
    }
  }
}

function isKind(s: z.ZodTypeAny, kind: Kind): boolean {
  return (s as z.ZodTypeAny)._def.typeName === kind;
}

function makeIdNumberSchema(orig: z.ZodString): z.ZodNumber {
  const userDesc =
    // Zod ≥3.23 exposes .description directly; fall back to _def for older minor versions
    (orig as unknown as { description?: string }).description ??
    (orig as unknown as { _def?: { description?: string } })._def
      ?.description ??
    "";

  const base =
    "This field must be filled with the numerical ID of the link element";
  const composed =
    userDesc.trim().length > 0
      ? `${base} that follows this user-defined description: ${userDesc}`
      : base;

  return z.number().describe(composed);
}

/**
 * Mapping from LLM provider names to their corresponding environment variable names for API keys.
 */
export const providerEnvVarMap: Partial<
  Record<ModelProvider | string, string>
> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
  google: "GOOGLE_GENERATIVE_AI_API_KEY",
  groq: "GROQ_API_KEY",
  cerebras: "CEREBRAS_API_KEY",
  togetherai: "TOGETHER_AI_API_KEY",
  mistral: "MISTRAL_API_KEY",
  deepseek: "DEEPSEEK_API_KEY",
  perplexity: "PERPLEXITY_API_KEY",
  azure: "AZURE_API_KEY",
  xai: "XAI_API_KEY",
  google_legacy: "GOOGLE_API_KEY",
};

/**
 * Loads an API key for a provider, checking environment variables.
 * @param provider The name of the provider (e.g., 'openai', 'anthropic')
 * @param logger Optional logger for info/error messages
 * @returns The API key if found, undefined otherwise
 */
export function loadApiKeyFromEnv(
  provider: string | undefined,
  logger: (logLine: LogLine) => void,
): string | undefined {
  if (!provider) {
    return undefined;
  }

  const envVarName = providerEnvVarMap[provider];
  if (!envVarName) {
    logger({
      category: "init",
      message: `No known environment variable for provider '${provider}'`,
      level: 0,
    });
    return undefined;
  }

  const apiKeyFromEnv = process.env[envVarName];
  if (typeof apiKeyFromEnv === "string" && apiKeyFromEnv.length > 0) {
    return apiKeyFromEnv;
  }

  logger({
    category: "init",
    message: `API key for ${provider} not found in environment variable ${envVarName}`,
    level: 0,
  });

  return undefined;
}
