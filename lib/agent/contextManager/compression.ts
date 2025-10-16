import { CoreMessage, ToolContent } from "ai";
import {
  compressToolResultContent,
  isImageContentPart,
  isToolResultContentPart,
} from ".";
import {
  DEFAULT_TRUNCATE_TEXT_OVER,
  SCREENSHOT_TEXT_PLACEHOLDER,
  TOOL_RESULT_AGE_MESSAGES_TO_CONSIDER_OLD,
  MAX_PREVIOUS_SAME_TOOL_RESULTS_TO_KEEP,
} from "./constants";
import { LogLevel } from "@/types/log";

export function compressToolResults(
  prompt: CoreMessage[],
  logger?: (message: string, level: LogLevel) => void,
): CoreMessage[] {
  const processed = [...prompt];
  const toolPositions = new Map<string, number[]>();
  let replacedOldToolResults = 0;
  let replacedOldScreenshots = 0;
  let replacedOldAriaTrees = 0;
  let imagesConvertedToText = 0;
  let truncatedLongToolResults = 0;

  prompt.forEach((msg, idx) => {
    if (msg.role === "tool") {
      const toolMessage = msg;
      toolMessage.content.forEach((item) => {
        if (isToolResultContentPart(item)) {
          const positions = toolPositions.get(item.toolName) || [];
          positions.push(idx);
          toolPositions.set(item.toolName, positions);
        }
      });
    }
  });

  const mapped = processed.map((msg, idx) => {
    if (msg.role === "tool") {
      const toolMessage = msg;
      const processedContent: ToolContent = toolMessage.content.map((item) => {
        if (isToolResultContentPart(item)) {
          const positions = toolPositions.get(item.toolName) || [];
          const currentPos = positions.indexOf(idx);
          const isOldByAge =
            prompt.length - idx > TOOL_RESULT_AGE_MESSAGES_TO_CONSIDER_OLD;
          const isOldByCount =
            currentPos >= 0 &&
            positions.length - currentPos >
              MAX_PREVIOUS_SAME_TOOL_RESULTS_TO_KEEP;
          const isOld = isOldByAge || isOldByCount;
          if (isOld) {
            if (item.toolName === "screenshot") {
              replacedOldToolResults++;
              replacedOldScreenshots++;
              logger?.(
                `[compression] Replaced old screenshot tool-result at message index ${idx} (reason: ${[
                  isOldByAge ? "age" : "",
                  isOldByCount ? "prior-results" : "",
                ]
                  .filter(Boolean)
                  .join("+")})`,
                2,
              );
              return {
                type: "tool-result",
                toolCallId: item.toolCallId,
                toolName: item.toolName,
                result: "Screenshot taken",
              };
            } else if (item.toolName === "ariaTree") {
              replacedOldToolResults++;
              replacedOldAriaTrees++;
              logger?.(
                `[compression] Compressed old ariaTree tool-result at message index ${idx} (reason: ${[
                  isOldByAge ? "age" : "",
                  isOldByCount ? "prior-results" : "",
                ]
                  .filter(Boolean)
                  .join("+")})`,
                2,
              );
              return {
                type: "tool-result",
                toolCallId: item.toolCallId,
                toolName: item.toolName,
                result: {
                  success: true,
                  content: "Aria tree retrieved (compressed)",
                },
              };
            }
          }
        }
        // Convert screenshot image content to text
        if (isImageContentPart(item)) {
          imagesConvertedToText++;
          return {
            type: "text",
            text: SCREENSHOT_TEXT_PLACEHOLDER,
          } as unknown as ToolContent[number];
        }

        if (isToolResultContentPart(item)) {
          const compressed = compressToolResultContent(item, {
            truncateTextOver: DEFAULT_TRUNCATE_TEXT_OVER,
          });
          if (compressed !== item) truncatedLongToolResults++;
          return compressed;
        }

        return item;
      });

      return { ...toolMessage, content: processedContent };
    }
    return msg;
  });

  if (
    replacedOldToolResults > 0 ||
    imagesConvertedToText > 0 ||
    truncatedLongToolResults > 0
  ) {
    logger?.(
      `[compression] Summary: replaced old tool-results=${replacedOldToolResults} (screenshots=${replacedOldScreenshots}, ariaTree=${replacedOldAriaTrees}); images→text=${imagesConvertedToText}; truncated long tool results=${truncatedLongToolResults}`,
      2,
    );
  }

  return mapped;
}
