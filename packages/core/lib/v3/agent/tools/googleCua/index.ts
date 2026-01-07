/**
 * Google Computer Use Agent (CUA) Tools
 *
 * These tools match Google's native computer use tool names and signatures.
 * They can be used with V3AgentHandler when using a Google CUA model
 * (e.g., google/gemini-2.5-computer-use-preview-10-2025).
 *
 * Google CUA uses a 0-1000 coordinate system that gets normalized to viewport coordinates.
 */

import type { ToolSet } from "ai";
import type { V3 } from "../../../v3";

// Tool exports
export { clickAtTool } from "./clickAt";
export { typeTextAtTool } from "./typeTextAt";
export { keyCombinationTool } from "./keyCombination";
export { scrollAtTool } from "./scrollAt";
export { scrollDocumentTool } from "./scrollDocument";
export { navigateTool } from "./navigate";
export { goBackTool } from "./goBack";
export { goForwardTool } from "./goForward";
export { hoverAtTool } from "./hoverAt";
export { dragAndDropTool } from "./dragAndDrop";
export { wait5SecondsTool } from "./wait5Seconds";
export { openWebBrowserTool } from "./openWebBrowser";

// Type exports
export type { CuaToolResult, CuaModelOutput } from "./types";

// Utility exports
export {
  getViewportSize,
  normalizeGoogleCoordinates,
  createCuaResult,
  cuaToModelOutput,
} from "./utils";

// Import tools for createGoogleCuaTools
import { clickAtTool } from "./clickAt";
import { typeTextAtTool } from "./typeTextAt";
import { keyCombinationTool } from "./keyCombination";
import { scrollAtTool } from "./scrollAt";
import { scrollDocumentTool } from "./scrollDocument";
import { navigateTool } from "./navigate";
import { goBackTool } from "./goBack";
import { goForwardTool } from "./goForward";
import { hoverAtTool } from "./hoverAt";
import { dragAndDropTool } from "./dragAndDrop";
import { wait5SecondsTool } from "./wait5Seconds";
import { openWebBrowserTool } from "./openWebBrowser";

/**
 * Creates all Google CUA tools as a ToolSet
 */
export function createGoogleCuaTools(v3: V3): ToolSet {
  return {
    click_at: clickAtTool(v3),
    type_text_at: typeTextAtTool(v3),
    key_combination: keyCombinationTool(v3),
    scroll_at: scrollAtTool(v3),
    scroll_document: scrollDocumentTool(v3),
    navigate: navigateTool(v3),
    go_back: goBackTool(v3),
    go_forward: goForwardTool(v3),
    hover_at: hoverAtTool(v3),
    drag_and_drop: dragAndDropTool(v3),
    wait_5_seconds: wait5SecondsTool(v3),
    open_web_browser: openWebBrowserTool(v3),
  };
}

