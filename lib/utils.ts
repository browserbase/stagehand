import crypto from "crypto";
import { LogLine } from "../types/log";
import { TextAnnotation } from "../types/textannotation";
import { z } from "zod";

export function generateId(operation: string) {
  return crypto.createHash("sha256").update(operation).digest("hex");
}

export function formatText(textAnnotations: TextAnnotation[]): string {
  // lineCluster is a map where keys represent the line number (corresponding to the y-coordinates)
  // of the TextAnnotations, and values are arrays of annotations belonging to that line
  // and values are arrays of annotations belonging to that line
  const lineCluster: Map<number, TextAnnotation[]> = new Map();

  // we consider TextAnnotations to be on the same line if their y-coordinates
  // are within 10 pixels of each other
  const lineThreshold = 10;

  // sort all text annotations by y-coordinate (smallest to largest)
  // in the list of sortedAnnotations, the annotations closest to the top of the page
  // will appear first, and the annotations closest to the bottom of the page will appear last
  const sortedAnnotations = textAnnotations.sort(
    (a, b) => a.bottom_left.y - b.bottom_left.y,
  );

  // here, we cluster annotations into lines of text based on vertical proximity.
  // for each annotation in the sorted list (sorted by y-coordinate):
  //    1. get its y-coordinate (lineY),
  //    2. check if it is close enough (within lineThreshold) to the last existing line cluster.
  //    3. if close, add the annotation to the existing cluster for that line.
  //    4. if not close, start a new cluster with lineY as the key and the current annotation as the value.
  // this ensures that annotations in close vertical proximity are grouped together,
  // effectively forming logical "lines" of text.
  sortedAnnotations.forEach((annotation) => {
    const lineY = annotation.bottom_left.y;
    const keys = Array.from(lineCluster.keys());
    const lastY = keys[keys.length - 1];

    if (keys.length > 0 && Math.abs(lineY - lastY) < lineThreshold) {
      lineCluster.get(lastY)!.push(annotation);
    } else {
      lineCluster.set(lineY, [annotation]);
    }
  });

  // this is the default canvas width (width of the text-rendered-webpage) in characters
  let canvasWidth = 80;

  // calculate canvas width based on the longest line
  if (lineCluster.size > 0) {
    const longestLine = Array.from(lineCluster.values()).reduce((a, b) => {
      const aLength = a.reduce((sum, token) => sum + token.text.length + 1, 0);
      const bLength = b.reduce((sum, token) => sum + token.text.length + 1, 0);
      return aLength > bLength ? a : b;
    });

    const maxSumTextLengths = longestLine.reduce(
      (sum, token) => sum + token.text.length + 1,
      0,
    );
    canvasWidth = Math.ceil(maxSumTextLengths * 1.5);
  }

  // here we are creating a 2D array (canvas) to represent the text-rendered-webpage.
  // each row corresponds to a line of text, and each cell within each row
  // corresponds to a character slot in that line of text. we initialize the canvas
  // with empty spaces
  let canvas: string[][] = [];
  for (let i = 0; i < lineCluster.size; i++) {
    canvas.push(new Array(canvasWidth).fill(" "));
  }

  const letterHeight = 30;
  const emptySpaceHeight = letterHeight + 5;
  let maxPreviousLineHeight = emptySpaceHeight;

  const adjustCanvasWidth = (newWidth: number) => {
    if (newWidth > canvasWidth) {
      canvasWidth = newWidth;
      canvas = canvas.map((row) => {
        return [...row, ...new Array(newWidth - row.length).fill(" ")];
      });
    }
  };

  // place the annotations on the canvas
  let i = 0;
  const sortedLineEntries = Array.from(lineCluster.entries()).sort(
    (a, b) => a[0] - b[0],
  );

  for (const [, lineAnnotations] of sortedLineEntries) {
    // sort annotations in this line by X-coordinate. This allows us to make sure
    // annotations are placed on the canvas from left to right
    lineAnnotations.sort((a, b) => a.bottom_left.x - b.bottom_left.x);
    const groupedLineAnnotations = groupWordsInSentence(lineAnnotations);

    // here we are determining if we need to add an empty line to the canvas.
    // we do this by comparing the height of the current line to the height of the
    // previous line. if the current line is significantly lower than the previous line,
    // we add empty lines to the canvas to fill the gap.
    const maxLineHeight = Math.max(
      ...groupedLineAnnotations.map(
        (annotation) => annotation.bottom_left.y - annotation.height,
      ),
    );
    const heightToAdd = Math.floor(
      (maxLineHeight - maxPreviousLineHeight) / emptySpaceHeight,
    );
    if (heightToAdd > 0) {
      for (let h = 0; h < heightToAdd; h++) {
        canvas.push(new Array(canvasWidth).fill(" "));
        i += 1;
      }
    }

    // store the BOTTOM height of the letter to be used for calculating the height of the next line
    maxPreviousLineHeight = Math.max(
      ...groupedLineAnnotations.map((annotation) => annotation.bottom_left.y),
    );

    let lastX = 0;
    for (const annotation of groupedLineAnnotations) {
      const text = annotation.text;

      // get the x-coordinate of the annotation and normalize it to the canvas width
      let x = Math.floor(annotation.bottom_left_normalized.x * canvasWidth);

      // move forward if there's an overlap
      x = Math.max(x, lastX);

      // ensure the text fits within the canvas
      if (x + text.length >= canvasWidth) {
        adjustCanvasWidth(x + text.length + 1);
      }

      // place the text on the canvas
      for (let j = 0; j < text.length; j++) {
        canvas[i][x + j] = text[j];
      }

      lastX = x + text.length + 1;
    }

    i += 1;
  }

  // delete all whitespace characters after the last non-whitespace character in each row
  canvas = canvas.map((row) => {
    const lineStr = row.join("");
    return Array.from(lineStr.trimEnd());
  });

  let pageText = canvas.map((line) => line.join("")).join("\n");
  pageText = pageText.trim();

  pageText =
    "-".repeat(canvasWidth) + "\n" + pageText + "\n" + "-".repeat(canvasWidth);

  return pageText;
}

function groupWordsInSentence(
  lineAnnotations: TextAnnotation[],
): TextAnnotation[] {
  const groupedAnnotations: TextAnnotation[] = [];
  let currentGroup: TextAnnotation[] = [];

  for (const annotation of lineAnnotations) {
    // if currentGroup is empty, this is the first annotation of a new group.
    // add the annotation to the currentGroup and move to the next annotation
    if (currentGroup.length === 0) {
      currentGroup.push(annotation);
      continue;
    }

    const padding = 2;

    // calculate the average character width in the last annotation of the current group.
    // multiply it by the padding factor to account for spacing between words or punctuation.
    const characterWidth =
      (currentGroup[currentGroup.length - 1].width /
        currentGroup[currentGroup.length - 1].text.length) *
      padding;

    // check if the current annotation is within the horizontal range of the
    // last annotation in the group. the range extends from the starting
    // x-coordinate of the last annotation to its width plus padding.
    const isWithinHorizontalRange =
      annotation.bottom_left.x <=
      currentGroup[currentGroup.length - 1].bottom_left.x +
        currentGroup[currentGroup.length - 1].width +
        characterWidth;

    // check if the annotation meets the criteria to be grouped with the current group:
    // 1. the height of the current annotation is similar (difference ≤ 4 units)
    //    to the first annotation in the group,
    // 2. the current annotation is within the horizontal range of the last
    //    annotation in the group.
    if (
      Math.abs(annotation.height - currentGroup[0].height) <= 4 &&
      isWithinHorizontalRange
    ) {
      currentGroup.push(annotation);
    } else {
      // if the conditions are not satisfied:
      // 1. finalize the current group by creating a grouped annotation from its contents,
      // 2. add the grouped annotation to the result list,
      // 3. start a new group with the current annotation.
      if (currentGroup.length > 0) {
        const groupedAnnotation = createGroupedAnnotation(currentGroup);
        groupedAnnotations.push(groupedAnnotation);
        currentGroup = [annotation];
      }
    }
  }

  // append the last group if it exists
  if (currentGroup.length > 0) {
    const groupedAnnotation = createGroupedAnnotation(currentGroup);
    groupedAnnotations.push(groupedAnnotation);
  }

  return groupedAnnotations;
}

function createGroupedAnnotation(group: TextAnnotation[]): TextAnnotation {
  // empty string to hold the concatenated text of the group
  let text = "";

  // loop through each annotation (word) in the group to construct the final text string
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

  // Determine if the concatenated text qualifies as a "word".
  // A valid word must be longer than one character and contain at least one alphanumeric character.
  const isWord = /[a-zA-Z0-9]/.test(text);
  const medianHeight = median(group.map((word) => word.height));

  // if the text is considered a valid word and its median height is larger than 25,
  // format the text as bold by surrounding it with `**`.
  if (isWord && medianHeight > 25) {
    text = "**" + text + "**";
  }

  // return a new TextAnnotation object representing the grouped text.
  // - text: the concatenated and (maybe) formatted text,
  // - bottom_left: the bottom-left position of the first annotation in the group,
  // - bottom_left_normalized: the normalized coordinates of the first annotation,
  // - width: the total width of the group: summed width of all annotations in the group,
  // - height: the height of the first annotation (assumes consistent height within the group)
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
