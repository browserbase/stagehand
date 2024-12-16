import crypto from "crypto";
import { LogLine } from "../types/log";
import { TextAnnotation } from "../types/textannotation";
import { z } from "zod";

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
  // **1:** Estimate the average character width in pixels by examining the text annotations.
  // If no reliable measurement is found, default to 10 pixels per character.
  const charWidth = estimateCharacterWidth(textAnnotations) || 10;

  // **2:** Create a copy of textAnnotations and sort them by their vertical position (y-coordinate),
  // ensuring that topmost annotations appear first and bottommost appear last.
  const sortedAnnotations = [...textAnnotations].sort(
    (a, b) => a.bottom_left.y - b.bottom_left.y,
  );

  // **3:** Group annotations by their line position. We use a small epsilon to handle
  // floating-point differences. Two annotations are considered on the same line if their
  // y-coordinates differ by less than epsilon.
  const epsilon = 0.0001;
  const lineMap: Map<number, TextAnnotation[]> = new Map();

  for (const annotation of sortedAnnotations) {
    let foundLineY: number | undefined;

    // **4:** Check if the annotation belongs to an existing line group.
    // If so, add it to that line. Otherwise, start a new line group.
    for (const key of lineMap.keys()) {
      if (Math.abs(key - annotation.bottom_left.y) < epsilon) {
        foundLineY = key;
        break;
      }
    }

    if (foundLineY !== undefined) {
      lineMap.get(foundLineY)!.push(annotation);
    } else {
      lineMap.set(annotation.bottom_left.y, [annotation]);
    }
  }

  // **5:** Extract all line keys (y-coordinates) and sort them to process lines top-to-bottom.
  const lineYs = Array.from(lineMap.keys()).sort((a, b) => a - b);

  // **6:** For each line, group words together and calculate the maximum normalized end position (maxNormalizedEndX).
  // This will help determine the necessary canvas width to accommodate all text.
  let maxNormalizedEndX = 0;
  const finalLines: TextAnnotation[][] = [];

  for (const lineY of lineYs) {
    const lineAnnotations = lineMap.get(lineY)!;

    // **7:** Sort annotations in the current line by their horizontal position (x-coordinate),
    // ensuring left-to-right ordering.
    lineAnnotations.sort((a, b) => a.bottom_left.x - b.bottom_left.x);

    // **8:** Group nearby annotations into word clusters, forming logical sentences or phrases.
    const groupedLineAnnotations = groupWordsInSentence(lineAnnotations);

    // **9:** Determine how far to the right the text in this line extends, normalized by page width.
    // Update maxNormalizedEndX to track the widest line encountered.
    for (const ann of groupedLineAnnotations) {
      const textLengthInPx = ann.text.length * charWidth;
      const normalizedTextLength = textLengthInPx / pageWidth;
      const endX = ann.bottom_left_normalized.x + normalizedTextLength;
      if (endX > maxNormalizedEndX) {
        maxNormalizedEndX = endX;
      }
    }

    // **10:** Save the processed line to finalLines for later rendering.
    finalLines.push(groupedLineAnnotations);
  }

  // **11:** Determine the canvas width in characters. We scale according to maxNormalizedEndX and page width.
  // Add a small buffer (20 chars) to ensure no text overflows the canvas.
  let canvasWidth = Math.ceil(maxNormalizedEndX * (pageWidth / charWidth)) + 20;
  canvasWidth = Math.max(canvasWidth, 1);

  // **12:** Compute the baseline (lowest point) of each line. This helps us understand vertical spacing.
  const lineBaselines = finalLines.map((line) =>
    Math.min(...line.map((a) => a.bottom_left.y)),
  );

  // **13:** Compute vertical gaps between consecutive lines to determine line spacing.
  const verticalGaps: number[] = [];
  for (let i = 1; i < lineBaselines.length; i++) {
    verticalGaps.push(lineBaselines[i] - lineBaselines[i - 1]);
  }

  // **14:** Estimate what a "normal" line spacing is by taking the median of all vertical gaps.
  const normalLineSpacing = verticalGaps.length > 0 ? median(verticalGaps) : 0;

  // **15:** Create a 2D character canvas initialized with spaces, onto which we'll "print" text lines.
  let canvas: string[][] = [];

  // **16:** lineIndex represents the current line of the canvas. Initialize with -1 so the first line starts at 0.
  let lineIndex = -1;

  // **17:** Iterate over each line of processed text.
  for (let i = 0; i < finalLines.length; i++) {
    if (i === 0) {
      // **18:** For the first line, just increment lineIndex to start at 0 with no extra spacing.
      lineIndex++;
      ensureLineExists(canvas, lineIndex, canvasWidth);
    } else {
      // **19:** For subsequent lines, calculate how many extra blank lines to insert based on spacing.
      const gap = lineBaselines[i] - lineBaselines[i - 1];

      let extraLines = 0;
      // **20:** If we have a known normal line spacing, and the gap is larger than expected,
      // insert extra blank lines proportional to the ratio of gap to normal spacing.
      if (normalLineSpacing > 0) {
        if (gap > 1.2 * normalLineSpacing) {
          extraLines = Math.max(Math.round(gap / normalLineSpacing) - 1, 0);
        }
      }

      // **21:** Insert the calculated extra blank lines to maintain approximate vertical spacing.
      for (let e = 0; e < extraLines; e++) {
        lineIndex++;
        ensureLineExists(canvas, lineIndex, canvasWidth);
      }

      // **22:** After adjusting for spacing, increment lineIndex for the current line of text.
      lineIndex++;
      ensureLineExists(canvas, lineIndex, canvasWidth);
    }

    // **23:** Now place the annotations for the current line onto the canvas at the appropriate horizontal positions.
    const lineAnnotations = finalLines[i];
    for (const annotation of lineAnnotations) {
      const text = annotation.text;
      // **24:** Calculate the starting x-position in the canvas based on normalized coordinates.
      const startXInChars = Math.round(
        annotation.bottom_left_normalized.x * canvasWidth,
      );

      // **25:** Place each character of the annotation text into the canvas.
      for (let j = 0; j < text.length; j++) {
        const xPos = startXInChars + j;
        // **26:** Ensure we don't exceed the canvas width.
        if (xPos < canvasWidth) {
          canvas[lineIndex][xPos] = text[j];
        }
      }
    }
  }

  // **27:** Trim trailing whitespace from each line to create a cleaner output.
  canvas = canvas.map((row) => {
    const lineStr = row.join("");
    return Array.from(lineStr.trimEnd());
  });

  // **29:** Join all lines to form the final page text. Trim any trailing whitespace from the entire text.
  let pageText = canvas.map((line) => line.join("")).join("\n");
  pageText = pageText.trimEnd();

  // **30:** Surround the page text with lines of dashes to clearly delineate the text block.
  pageText =
    "-".repeat(canvasWidth) + "\n" + pageText + "\n" + "-".repeat(canvasWidth);

  // **31:** Return the fully formatted text.
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
 * `estimateCharacterWidth` estimates the average character width (in pixels) from a collection of text annotations.
 * It calculates the width per character for each annotation and uses their median as the result.
 * If no annotations are available or they have zero-length text, returns 0.
 *
 * @param textAnnotations - An array of text annotations with text and width fields.
 * @returns The median character width in pixels, or 0 if none can be calculated.
 */
function estimateCharacterWidth(textAnnotations: TextAnnotation[]): number {
  // collect width-per-character measurements from each annotation
  const charWidths: number[] = [];
  for (const annotation of textAnnotations) {
    const length = annotation.text.length;
    if (length > 0) {
      charWidths.push(annotation.width / length);
    }
  }

  // return the median of all collected measurements
  return median(charWidths);
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
    const padding = 2;
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
        groupedAnnotations.push(groupedAnnotation);
        currentGroup = [annotation];
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
