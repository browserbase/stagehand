import { tool } from "ai";
import { z } from "zod/v3";
import { StagehandPage } from "../../StagehandPage";
import { buildHierarchicalTree, buildBackendIdMaps } from "../../a11y/utils";
import type { AccessibilityNode, AXNode } from "../../../types/context";

interface ViewportBounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

interface ElementBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Skip roles that are unlikely to be useful for interaction
 */
function shouldSkipRole(role: string): boolean {
  const skipRoles = new Set([
    "none",
    "presentation",
    "InlineTextBox",
    "LineBreak",
    "StaticText", // Often redundant with parent text
  ]);
  return skipRoles.has(role);
}

/**
 * Ultra-fast chunk filtering with early exits and batched processing
 */
async function filterNodesInViewportChunkOptimized(
  stagehandPage: StagehandPage,
  nodes: AXNode[],
  chunkBounds: ViewportBounds,
): Promise<AXNode[]> {
  const visibleNodes: AXNode[] = [];

  // Step 1: Quick pre-filter without any CDP calls
  const candidateNodes: Array<{ node: AXNode; backendId: number }> = [];

  for (const node of nodes) {
    // Keep structural nodes immediately
    if (!node.backendDOMNodeId) {
      if (node.role?.value === "WebArea" || !node.parentId) {
        visibleNodes.push(node);
      }
      continue;
    }

    // Skip unimportant roles early
    const role = node.role?.value || "";
    if (shouldSkipRole(role)) continue;

    candidateNodes.push({ node, backendId: node.backendDOMNodeId });
  }

  // Step 2: Process in batches to avoid overwhelming CDP
  const BATCH_SIZE = 50; // Optimal batch size for CDP calls

  for (let i = 0; i < candidateNodes.length; i += BATCH_SIZE) {
    const batch = candidateNodes.slice(i, i + BATCH_SIZE);
    const backendIds = batch.map((item) => item.backendId);

    // Get bounding boxes for this batch in parallel
    const boundingBoxes = await getBatchElementBounds(
      stagehandPage,
      backendIds,
    );

    // Filter this batch
    for (let j = 0; j < batch.length; j++) {
      const bounds = boundingBoxes[j];
      if (bounds && isElementInChunkBounds(bounds, chunkBounds)) {
        visibleNodes.push(batch[j].node);
      }
    }
  }

  return visibleNodes;
}

/**
 * Get bounding boxes for multiple elements at once - BATCH VERSION FOR SPEED!
 */
async function getBatchElementBounds(
  stagehandPage: StagehandPage,
  backendNodeIds: number[],
): Promise<(ElementBounds | null)[]> {
  // Use Promise.allSettled to batch all CDP calls in parallel
  const boxModelPromises = backendNodeIds.map(async (backendNodeId) => {
    try {
      const { model } = await stagehandPage.sendCDP<{
        model: { width: number; height: number; content: number[] };
      }>("DOM.getBoxModel", { backendNodeId });

      if (!model || !model.content || model.content.length < 8) {
        return null;
      }

      // content array contains [x1, y1, x2, y2, x3, y3, x4, y4] for the content box
      const [x1, y1, x2, y2, x3, y3, x4, y4] = model.content;

      // Calculate bounding rectangle
      const left = Math.min(x1, x2, x3, x4);
      const right = Math.max(x1, x2, x3, x4);
      const top = Math.min(y1, y2, y3, y4);
      const bottom = Math.max(y1, y2, y3, y4);

      return {
        x: left,
        y: top,
        width: right - left,
        height: bottom - top,
      };
    } catch {
      return null;
    }
  });

  // Execute all CDP calls in parallel - MUCH FASTER than sequential!
  const results = await Promise.allSettled(boxModelPromises);

  return results.map((result) =>
    result.status === "fulfilled" ? result.value : null,
  );
}

/**
 * Check if an element's bounds intersect with the chunk bounds
 */
function isElementInChunkBounds(
  elementBounds: ElementBounds,
  chunkBounds: ViewportBounds,
): boolean {
  const elementRight = elementBounds.x + elementBounds.width;
  const elementBottom = elementBounds.y + elementBounds.height;

  // Check for intersection
  return !(
    elementRight < chunkBounds.left ||
    elementBounds.x > chunkBounds.right ||
    elementBottom < chunkBounds.top ||
    elementBounds.y > chunkBounds.bottom
  );
}

/**
 * Convert CDP accessibility node to our AccessibilityNode format
 */
function decorateNode(node: AXNode): AccessibilityNode {
  return {
    role: node.role?.value || "",
    name: node.name?.value,
    description: node.description?.value,
    value: node.value?.value,
    nodeId: node.nodeId,
    backendDOMNodeId: node.backendDOMNodeId,
    parentId: node.parentId,
    childIds: node.childIds,
    properties: node.properties,
  };
}

/**
 * Parse chunk specification (e.g., "2", "2-4", "1,3,5")
 */
function parseChunks(chunksSpec: string): number[] {
  const chunks: number[] = [];

  const parts = chunksSpec.split(",").map((part) => part.trim());

  for (const part of parts) {
    if (part.includes("-")) {
      // Range like "2-4"
      const [start, end] = part.split("-").map((s) => parseInt(s.trim(), 10));
      if (!isNaN(start) && !isNaN(end) && start <= end) {
        for (let i = start; i <= end; i++) {
          chunks.push(i);
        }
      }
    } else {
      // Single chunk like "2"
      const chunk = parseInt(part, 10);
      if (!isNaN(chunk)) {
        chunks.push(chunk);
      }
    }
  }

  return [...new Set(chunks)].sort((a, b) => a - b);
}

export const createAriaTreeTool = (stagehandPage: StagehandPage) =>
  tool({
    description:
      "gets the accessibility (ARIA) tree from the current page. Tries to get the full tree first, but if it exceeds character limits, returns chunks. You can specify specific chunks using the chunks parameter (e.g., '2', '1-3', '2,4,6').",
    parameters: z.object({
      chunks: z
        .string()
        .optional()
        .describe(
          "Specific chunks to retrieve (e.g., '2', '1-3', '2,4,6'). If not provided, tries to get full tree first.",
        ),
    }),
    execute: async ({ chunks }) => {
      const MAX_CHARACTERS = 100000;
      const pageUrl = stagehandPage.page.url();

      // Get viewport dimensions
      const viewportSize = stagehandPage.page.viewportSize();
      if (!viewportSize) {
        throw new Error("Could not get viewport size");
      }
      const { width: viewportWidth, height: viewportHeight } = viewportSize;

      // If specific chunks are requested, handle that directly
      if (chunks) {
        const requestedChunks = parseChunks(chunks);
        if (requestedChunks.length === 0) {
          throw new Error("Invalid chunks specification");
        }

        return await getSpecificChunks(
          stagehandPage,
          requestedChunks,
          viewportWidth,
          viewportHeight,
          pageUrl,
          MAX_CHARACTERS,
        );
      }

      // Try to get full tree first
      try {
        const { page_text } = await stagehandPage.page.extract();
        const estimatedTokens = Math.ceil(page_text.length / 4);

        if (estimatedTokens <= MAX_CHARACTERS) {
          // Full tree fits within limits
          return {
            content: page_text,
            pageUrl,
            mode: "full",
            totalChunks: null,
            chunksShown: null,
          };
        }

        // Full tree is too large, fall back to chunks
        return await getFallbackChunks(
          stagehandPage,
          viewportWidth,
          viewportHeight,
          pageUrl,
          MAX_CHARACTERS,
        );
      } catch {
        // If extract fails, fall back to chunk-based approach
        return await getFallbackChunks(
          stagehandPage,
          viewportWidth,
          viewportHeight,
          pageUrl,
          MAX_CHARACTERS,
        );
      }
    },
    experimental_toToolResultContent: (result) => {
      if (typeof result === "string") {
        return [{ type: "text", text: `Accessibility Tree:\n${result}` }];
      }

      const { content, mode, totalChunks, chunksShown } = result;

      let header = "Accessibility Tree";
      if (mode === "chunks" && totalChunks && chunksShown) {
        header += ` (Chunks ${chunksShown} of ${totalChunks} total)`;
        if (chunksShown !== `1-${totalChunks}`) {
          header += `\n\n📄 To get other chunks call this tool again, use: chunks parameter (e.g., chunks: "${totalChunks > 3 ? "4-" + totalChunks : totalChunks}")`;
        }
      }

      return [{ type: "text", text: `${header}:\n\n${content}` }];
    },
  });

/**
 * Get specific chunks as requested by user (without scrolling)
 */
async function getSpecificChunks(
  stagehandPage: StagehandPage,
  requestedChunks: number[],
  viewportWidth: number,
  viewportHeight: number,
  pageUrl: string,
  maxCharacters: number,
): Promise<{
  content: string;
  pageUrl: string;
  mode: string;
  totalChunks: number;
  chunksShown: string;
}> {
  // Get total page height to calculate total chunks
  const pageHeight = await stagehandPage.page.evaluate(
    () => document.body.scrollHeight,
  );
  const totalChunks = Math.ceil(pageHeight / viewportHeight);

  // Enable only Accessibility domain - buildBackendIdMaps handles DOM domain internally
  try {
    await stagehandPage.enableCDP("Accessibility");
  } catch (error) {
    throw new Error(`Failed to enable Accessibility CDP domain: ${error}`);
  }

  try {
    // Get full accessibility tree and backend maps once
    const { nodes: fullNodes } = await stagehandPage.sendCDP<{
      nodes: AXNode[];
    }>("Accessibility.getFullAXTree");
    const { tagNameMap } = await buildBackendIdMaps(true, stagehandPage);

    const chunkContents: string[] = [];
    let totalLength = 0;

    for (const chunkNumber of requestedChunks) {
      if (chunkNumber > totalChunks) continue;

      // Calculate virtual chunk bounds (without scrolling)
      const virtualScrollY = (chunkNumber - 1) * viewportHeight;
      const chunkBounds = {
        left: 0,
        top: virtualScrollY,
        right: viewportWidth,
        bottom: virtualScrollY + viewportHeight,
      };

      // Filter nodes for this virtual chunk
      const visibleNodes = await filterNodesInViewportChunkOptimized(
        stagehandPage,
        fullNodes,
        chunkBounds,
      );

      const treeResult = await buildHierarchicalTree(
        visibleNodes.map(decorateNode),
        tagNameMap,
      );

      const chunkContent = `=== CHUNK ${chunkNumber} ===\n${treeResult.simplified}\n`;

      // Check if adding this chunk would exceed the limit
      if (totalLength + chunkContent.length > maxCharacters * 4) {
        if (chunkContents.length === 0) {
          // Even the first chunk is too large, truncate it
          const truncated = chunkContent.substring(0, maxCharacters * 4 - 100);
          chunkContents.push(truncated + "\n\n[CHUNK TRUNCATED]");
        }
        break;
      }

      chunkContents.push(chunkContent);
      totalLength += chunkContent.length;
    }

    const content = chunkContents.join("\n");
    const actualChunks = requestedChunks.filter((c) => c <= totalChunks);
    const chunksShown =
      actualChunks.length === 1
        ? actualChunks[0].toString()
        : `${actualChunks[0]}-${actualChunks[actualChunks.length - 1]}`;

    return {
      content,
      pageUrl,
      mode: "chunks",
      totalChunks,
      chunksShown,
    };
  } finally {
    // Only disable Accessibility domain - buildBackendIdMaps handles DOM domain cleanup
    try {
      await stagehandPage.disableCDP("Accessibility");
    } catch {
      // Ignore - domain might not have been enabled
    }
  }
}

/**
 * Get as many chunks as fit within the character limit, starting from chunk 1 (without scrolling)
 */
async function getFallbackChunks(
  stagehandPage: StagehandPage,
  viewportWidth: number,
  viewportHeight: number,
  pageUrl: string,
  maxCharacters: number,
): Promise<{
  content: string;
  pageUrl: string;
  mode: string;
  totalChunks: number;
  chunksShown: string;
}> {
  // Get total page height to calculate total chunks
  const pageHeight = await stagehandPage.page.evaluate(
    () => document.body.scrollHeight,
  );
  const totalChunks = Math.ceil(pageHeight / viewportHeight);

  // Enable only Accessibility domain - buildBackendIdMaps handles DOM domain internally
  try {
    await stagehandPage.enableCDP("Accessibility");
  } catch (error) {
    throw new Error(`Failed to enable Accessibility CDP domain: ${error}`);
  }

  try {
    // Get full accessibility tree and backend maps once
    const { nodes: fullNodes } = await stagehandPage.sendCDP<{
      nodes: AXNode[];
    }>("Accessibility.getFullAXTree");
    const { tagNameMap } = await buildBackendIdMaps(true, stagehandPage);

    const chunkContents: string[] = [];
    let totalLength = 0;
    let chunksProcessed = 0;

    for (let chunkNumber = 1; chunkNumber <= totalChunks; chunkNumber++) {
      // Calculate virtual chunk bounds (without scrolling)
      const virtualScrollY = (chunkNumber - 1) * viewportHeight;
      const chunkBounds = {
        left: 0,
        top: virtualScrollY,
        right: viewportWidth,
        bottom: virtualScrollY + viewportHeight,
      };

      // Filter nodes for this virtual chunk
      const visibleNodes = await filterNodesInViewportChunkOptimized(
        stagehandPage,
        fullNodes,
        chunkBounds,
      );

      const treeResult = await buildHierarchicalTree(
        visibleNodes.map(decorateNode),
        tagNameMap,
      );

      const chunkContent = `=== CHUNK ${chunkNumber} ===\n${treeResult.simplified}\n`;

      // Check if adding this chunk would exceed the limit
      if (totalLength + chunkContent.length > maxCharacters * 4) {
        break;
      }

      chunkContents.push(chunkContent);
      totalLength += chunkContent.length;
      chunksProcessed++;
    }

    // If no chunks fit, at least try to get the first chunk (truncated)
    if (chunksProcessed === 0) {
      const chunkBounds = {
        left: 0,
        top: 0,
        right: viewportWidth,
        bottom: viewportHeight,
      };

      const visibleNodes = await filterNodesInViewportChunkOptimized(
        stagehandPage,
        fullNodes,
        chunkBounds,
      );

      const treeResult = await buildHierarchicalTree(
        visibleNodes.map(decorateNode),
        tagNameMap,
      );

      const truncated = treeResult.simplified.substring(
        0,
        maxCharacters * 4 - 200,
      );
      chunkContents.push(
        `=== CHUNK 1 (TRUNCATED) ===\n${truncated}\n\n[TRUNCATED: Content too large]`,
      );
      chunksProcessed = 1;
    }

    const content = chunkContents.join("\n");
    const chunksShown = chunksProcessed === 1 ? "1" : `1-${chunksProcessed}`;

    return {
      content,
      pageUrl,
      mode: "chunks",
      totalChunks,
      chunksShown,
    };
  } finally {
    // Only disable Accessibility domain - buildBackendIdMaps handles DOM domain cleanup
    try {
      await stagehandPage.disableCDP("Accessibility");
    } catch {
      // Ignore - domain might not have been enabled
    }
  }
}
