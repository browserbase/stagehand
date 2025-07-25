import {
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicToolResult,
} from "@/types/agent";

export type ResponseInputItem = AnthropicMessage | AnthropicToolResult;

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
