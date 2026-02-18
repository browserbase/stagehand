import {
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicToolResult,
  ResponseInputItem as OpenAIResponseInputItem,
} from "../../types/public/agent.js";
import type {
  Content as GoogleContent,
  Part as GooglePart,
} from "@google/genai";

export type ResponseInputItem = AnthropicMessage | AnthropicToolResult;

interface FunctionResponseData {
  inlineData?: {
    mimeType?: string;
    data?: string;
  };
}
export type AnthropicResponseInputItem = AnthropicMessage | AnthropicToolResult;
export type SupportedInputItem =
  | AnthropicResponseInputItem
  | OpenAIResponseInputItem
  | GoogleContent;

/**
 * Finds all items in the conversation history that contain images
 * @param items - Array of conversation items to check
 * @returns Array of indices where images were found
 */
export function findItemsWithImages(items: ResponseInputItem[]): number[] {
  const itemsWithImages: number[] = [];

  items.forEach((item, index) => {
    let hasImage = false;

    if (Array.isArray(item.content)) {
      hasImage = item.content.some(
        (contentItem: AnthropicContentBlock) =>
          contentItem.type === "tool_result" &&
          "content" in contentItem &&
          Array.isArray(contentItem.content) &&
          (contentItem.content as AnthropicContentBlock[]).some(
            (nestedItem: AnthropicContentBlock) => nestedItem.type === "image",
          ),
      );
    }

    if (hasImage) {
      itemsWithImages.push(index);
    }
  });

  return itemsWithImages;
}

/**
 * Compresses conversation history by removing images from older items
 * while keeping the most recent images intact
 * @param items - Array of conversation items to process
 * @param keepMostRecentCount - Number of most recent image-containing items to preserve (default: 2)
 * @returns Object with processed items
 */
export function compressConversationImages(
  items: ResponseInputItem[],
  keepMostRecentCount: number = 2,
): { items: ResponseInputItem[] } {
  const itemsWithImages = findItemsWithImages(items);

  items.forEach((item, index) => {
    const imageIndex = itemsWithImages.indexOf(index);
    const shouldCompress =
      imageIndex >= 0 &&
      imageIndex < itemsWithImages.length - keepMostRecentCount;

    if (shouldCompress) {
      if (Array.isArray(item.content)) {
        item.content = item.content.map(
          (contentItem: AnthropicContentBlock) => {
            if (
              contentItem.type === "tool_result" &&
              "content" in contentItem &&
              Array.isArray(contentItem.content) &&
              (contentItem.content as AnthropicContentBlock[]).some(
                (nestedItem: AnthropicContentBlock) =>
                  nestedItem.type === "image",
              )
            ) {
              return {
                ...contentItem,
                content: "screenshot taken",
              } as AnthropicContentBlock;
            }
            return contentItem;
          },
        );
      }
    }
  });

  return {
    items,
  };
}

/**
 * Finds all items in the conversation history that contain images (Google format)
 * @param items - Array of conversation items to check
 * @returns Array of indices where images were found
 */
export function findGoogleItemsWithImages(items: GoogleContent[]): number[] {
  const itemsWithImages: number[] = [];

  items.forEach((item, index) => {
    let hasImage = false;

    if (item.parts && Array.isArray(item.parts)) {
      hasImage = item.parts.some((part: GooglePart) => {
        // Check for functionResponse with data containing images
        if (part.functionResponse?.response?.data) {
          const data = part.functionResponse.response
            .data as FunctionResponseData[];
          return data.some((dataItem) =>
            dataItem.inlineData?.mimeType?.startsWith("image/"),
          );
        }

        // Check for functionResponse with parts containing images
        if (part.functionResponse?.parts) {
          return part.functionResponse.parts.some((responsePart) =>
            responsePart.inlineData?.mimeType?.startsWith("image/"),
          );
        }

        // Check for direct inline data
        return part.inlineData?.mimeType?.startsWith("image/");
      });
    }

    if (hasImage) {
      itemsWithImages.push(index);
    }
  });

  return itemsWithImages;
}

/**
 * Finds all items in the conversation history that contain images (OpenAI format)
 * @param items - Array of conversation items to check
 * @returns Array of indices where images were found
 */
export function findOpenAIItemsWithImages(
  items: OpenAIResponseInputItem[],
): number[] {
  const itemsWithImages: number[] = [];

  items.forEach((item, index) => {
    let hasImage = false;

    // Check for computer_call_output with image
    if (
      "type" in item &&
      item.type === "computer_call_output" &&
      "output" in item
    ) {
      const output = item.output as unknown as {
        type: string;
        image_url: string;
      };
      hasImage = output?.type === "input_image" && !!output?.image_url;
    }

    if (hasImage) {
      itemsWithImages.push(index);
    }
  });

  return itemsWithImages;
}

/**
 * Compresses OpenAI conversation history by removing images from older items
 * while keeping the most recent images intact
 * @param items - Array of conversation items to process
 * @param keepMostRecentCount - Number of most recent image-containing items to preserve (default: 2)
 * @returns Object with processed items
 */
export function compressOpenAIConversationImages(
  items: OpenAIResponseInputItem[],
  keepMostRecentCount: number = 2,
): { items: OpenAIResponseInputItem[] } {
  const itemsWithImages = findOpenAIItemsWithImages(items);

  items.forEach((item, index) => {
    const imageIndex = itemsWithImages.indexOf(index);
    const shouldCompress =
      imageIndex >= 0 &&
      imageIndex < itemsWithImages.length - keepMostRecentCount;

    if (shouldCompress) {
      // For computer_call_output with image, replace with text
      if (
        "type" in item &&
        item.type === "computer_call_output" &&
        "output" in item
      ) {
        const output = item.output as unknown as { type: string };
        if (output?.type === "input_image") {
          // Replace the image with a text message
          (item as unknown as { output: string }).output = "screenshot taken";
        }
      }
    }
  });

  return {
    items,
  };
}

/**
 * Compresses Google conversation history by removing images from older items
 * while keeping the most recent images intact
 * @param items - Array of conversation items to process
 * @param keepMostRecentCount - Number of most recent image-containing items to preserve (default: 2)
 * @returns Object with processed items
 */
export function compressGoogleConversationImages(
  items: GoogleContent[],
  keepMostRecentCount: number = 2,
): { items: GoogleContent[] } {
  const itemsWithImages = findGoogleItemsWithImages(items);

  items.forEach((item, index) => {
    const imageIndex = itemsWithImages.indexOf(index);
    const shouldCompress =
      imageIndex >= 0 &&
      imageIndex < itemsWithImages.length - keepMostRecentCount;

    if (shouldCompress && item.parts && Array.isArray(item.parts)) {
      item.parts = item.parts.map((part: GooglePart) => {
        // Replace functionResponse with data containing images
        if (part.functionResponse?.response?.data) {
          const data = part.functionResponse.response
            .data as FunctionResponseData[];
          const hasImage = data.some((dataItem) =>
            dataItem.inlineData?.mimeType?.startsWith("image/"),
          );
          if (hasImage) {
            return {
              ...part,
              functionResponse: {
                ...part.functionResponse,
                data: [] as FunctionResponseData[],
                response: {
                  ...part.functionResponse.response,
                  compressed: "screenshot taken",
                },
              },
            };
          }
        }

        // Replace functionResponse with parts containing images
        if (part.functionResponse?.parts) {
          const hasImageInParts = part.functionResponse.parts.some(
            (responsePart) =>
              responsePart.inlineData?.mimeType?.startsWith("image/"),
          );
          if (hasImageInParts) {
            return {
              ...part,
              functionResponse: {
                ...part.functionResponse,
                parts: part.functionResponse.parts.filter(
                  (responsePart) =>
                    !responsePart.inlineData?.mimeType?.startsWith("image/"),
                ),
                response: {
                  ...part.functionResponse.response,
                  compressed: "screenshot taken",
                },
              },
            };
          }
        }

        // Replace direct inline data images
        if (part.inlineData?.mimeType?.startsWith("image/")) {
          return {
            text: "screenshot taken",
          };
        }
        return part;
      });
    }
  });

  return {
    items,
  };
}
