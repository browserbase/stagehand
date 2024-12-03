import { LLMProvider } from "../llm/LLMProvider";
import { Stagehand } from "../index";
import { z } from "zod";
import { LogLine } from "../../types/log";
import { TextAnnotation } from "../../types/textannotation";
import { extract } from "../inference";
import { LLMClient } from "../llm/LLMClient";
import { formatText } from "../utils";

const PROXIMITY_THRESHOLD = 15;

/**
 * The `StagehandExtractHandler` class is responsible for extracting structured data from a webpage by:
 *
 * **1. Waiting for the DOM to settle and initializing DOM debugging.**
 *    - Ensures the page is fully loaded and stable before extraction.
 *
 * **2. Storing the original DOM before any mutations.**
 *    - Preserves the initial state of the DOM to restore later.
 *
 * **3. Processing the DOM to generate a selector map of candidate elements.**
 *    - Identifies potential elements that contain the data to extract.
 *
 * **4. Creating text bounding boxes around every word in the webpage.**
 *    - Wraps words in spans so that their bounding boxes can be used to
 *      determine their positions on the text-rendered-webpage.
 *
 * **5. Collecting all text annotations (with positions and dimensions) from each of the candidate elements.**
 *    - Gathers text and positional data for each word.
 *
 * **6. Grouping annotations by text and deduplicating them based on proximity.**
 *    - There is no guarantee that the text annotations are unique (candidate elements can be nested).
 *    - Thus, we must remove duplicate words that are close to each other on the page.
 *
 * **7. Restoring the original DOM after mutations.**
 *    - Returns the DOM to its original state after processing.
 *
 * **8. Formatting the deduplicated annotations into a text representation.**
 *    - Prepares the text data for the extraction process.
 *
 * **9. Passing the formatted text to an LLM for extraction according to the given instruction and schema.**
 *    - Uses a language model to extract structured data based on instructions.
 *
 * **10. Handling the extraction response and logging the results.**
 *     - Processes the output from the LLM and logs relevant information.
 *
 * @remarks
 * Each step corresponds to specific code segments, as noted in the comments throughout the code.
 */


export class StagehandExtractHandler {
  private readonly stagehand: Stagehand;

  private readonly logger: (logLine: LogLine) => void;
  private readonly waitForSettledDom: (
    domSettleTimeoutMs?: number,
  ) => Promise<void>;
  private readonly startDomDebug: () => Promise<void>;
  private readonly cleanupDomDebug: () => Promise<void>;
  private readonly llmProvider: LLMProvider;
  private readonly llmClient: LLMClient;
  private readonly verbose: 0 | 1 | 2;

  constructor({
    stagehand,
    logger,
    waitForSettledDom,
    startDomDebug,
    cleanupDomDebug,
    llmProvider,
    llmClient,
    verbose,
  }: {
    stagehand: Stagehand;
    logger: (message: {
      category?: string;
      message: string;
      level?: number;
      auxiliary?: { [key: string]: { value: string; type: string } };
    }) => void;
    waitForSettledDom: (domSettleTimeoutMs?: number) => Promise<void>;
    startDomDebug: () => Promise<void>;
    cleanupDomDebug: () => Promise<void>;
    llmProvider: LLMProvider;
    llmClient: LLMClient;
    verbose: 0 | 1 | 2;
  }) {
    this.stagehand = stagehand;
    this.logger = logger;
    this.waitForSettledDom = waitForSettledDom;
    this.startDomDebug = startDomDebug;
    this.cleanupDomDebug = cleanupDomDebug;
    this.llmProvider = llmProvider;
    this.llmClient = llmClient;
    this.verbose = verbose;
  }

  public async extract<T extends z.AnyZodObject>({
    instruction,
    schema,
    content = {},
    llmClient,
    requestId,
    domSettleTimeoutMs,
  }: {
    instruction: string;
    schema: T;
    content?: z.infer<T>;
    llmClient: LLMClient;
    requestId?: string;
    domSettleTimeoutMs?: number;
  }): Promise<z.infer<T>> {
    this.logger({
      category: "extraction",
      message: "starting extraction",
      level: 1,
      auxiliary: {
        instruction: {
          value: instruction,
          type: "string",
        },
      },
    });

    // **Step 1:** Wait for the DOM to settle and start DOM debugging
    await this.waitForSettledDom(domSettleTimeoutMs);
    await this.startDomDebug();

    // **Step 2:** Store the original DOM before any mutations
    // we need to store the original DOM here because calling createTextBoundingBoxes()
    // will mutate the DOM by adding spans around every word
    const originalDOM = await this.stagehand.page.evaluate(() => window.storeDOM());

    // **Step 3:** Process the DOM to generate a selector map of candidate elements
    const { selectorMap }: { selectorMap: Record<number, string[]> } =
      await this.stagehand.page.evaluate(() => window.processAllOfDom());

    this.logger({
      category: "extraction",
      message: `received output from processAllOfDom. selectorMap has ${Object.keys(selectorMap).length} entries`,
      level: 1,
    });

    // **Step 4:** Create text bounding boxes around every word in the webpage
    // calling createTextBoundingBoxes() will create a span around every word on the
    // webpage. The bounding boxes of these spans will be used to determine their
    // positions in the text rendered webpage
    await this.stagehand.page.evaluate(() => window.createTextBoundingBoxes());
    const pageWidth = await this.stagehand.page.evaluate(() => window.innerWidth);
    const pageHeight = await this.stagehand.page.evaluate(() => window.innerHeight);

    // **Step 5:** Collect all text annotations (with positions and dimensions) from the candidate elements
    // allAnnotations will store all the TextAnnotations BEFORE deduplication
    const allAnnotations: TextAnnotation[] = [];

    // here we will loop through all the xpaths in the selectorMap,
    // and get the bounding boxes for each one. These are xpaths to "candidate elements"
    for (const xpaths of Object.values(selectorMap)) {
      const xpath = xpaths[0];

      // boundingBoxes is an array because there may be multiple bounding boxes within a single element
      // (since each bounding box is around a single word)
      const boundingBoxes: Array<{
        text: string;
        left: number;
        top: number;
        width: number;
        height: number;
      }> = await this.stagehand.page.evaluate(
        (xpath) => window.getElementBoundingBoxes(xpath),
        xpath
      );

      for (const box of boundingBoxes) {
        const bottom_left = {
          x: box.left,
          y: box.top + box.height,
        };
        const bottom_left_normalized = {
          x: box.left / pageWidth,
          y: (box.top + box.height) / pageHeight,
        };

        const annotation: TextAnnotation = {
          text: box.text,
          bottom_left,
          bottom_left_normalized,
          width: box.width,
          height: box.height,
        };
        allAnnotations.push(annotation);
      }
    }

    // **Step 6:** Group annotations by text and deduplicate them based on proximity
    const annotationsGroupedByText = new Map<string, TextAnnotation[]>();

    for (const annotation of allAnnotations) {
      if (!annotationsGroupedByText.has(annotation.text)) {
        annotationsGroupedByText.set(annotation.text, []);
      }
      annotationsGroupedByText.get(annotation.text)!.push(annotation);
    }

    const deduplicatedTextAnnotations: TextAnnotation[] = [];

    // here, we deduplicate annotations per text group
    for (const [text, annotations] of annotationsGroupedByText.entries()) {
      for (const annotation of annotations) {

        // check if this annotation is close to any existing deduplicated annotation
        const isDuplicate = deduplicatedTextAnnotations.some((existingAnnotation) => {
          if (existingAnnotation.text !== text) return false;

          const dx = existingAnnotation.bottom_left.x - annotation.bottom_left.x;
          const dy = existingAnnotation.bottom_left.y - annotation.bottom_left.y;
          const distance = Math.hypot(dx, dy);
          // the annotation is a duplicate if it has the same text and its bottom_left
          // position is within the PROXIMITY_THRESHOLD of an existing annotation.
          // we calculate the Euclidean distance between the two bottom_left points,
          // and if the distance is less than PROXIMITY_THRESHOLD,
          // the annotation is considered a duplicate.
          return distance < PROXIMITY_THRESHOLD;
        });

        if (!isDuplicate) {
          deduplicatedTextAnnotations.push(annotation);
        }
      }
    }

    // **Step 7:** Restore the original DOM after mutations
    await this.stagehand.page.evaluate((dom) => window.restoreDOM(dom), originalDOM);
    const formattedText = formatText(deduplicatedTextAnnotations);

    // **Step 9:** Pass the formatted text to an LLM for extraction according to the given instruction and schema
    const extractionResponse = await extract({
      instruction,
      previouslyExtractedContent: content,
      domElements: formattedText,
      schema,
      llmClient,
      requestId,
    });

    const {
      metadata: { completed },
      ...output
    } = extractionResponse;

    await this.cleanupDomDebug();

    // **Step 10:** Handle the extraction response and log the results
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
    return output;
  }
}
