/**
 * Google Computer Use Agent (CUA) Tools
 *
 * AI SDK tool() wrappers matching Google's native CUA tool names.
 * Used by V3AgentHandler when mode === "cua" with a Google CUA model.
 * Google CUA uses a 0-1000 coordinate system normalized to viewport pixels.
 */

import type { ToolSet } from "ai";
import type { V3 } from "../../../v3.js";

import { clickAtTool } from "./clickAt.js";
import { typeTextAtTool } from "./typeTextAt.js";
import { keyCombinationTool } from "./keyCombination.js";
import { scrollAtTool } from "./scrollAt.js";
import { scrollDocumentTool } from "./scrollDocument.js";
import { navigateTool } from "./navigate.js";
import { goBackTool } from "./goBack.js";
import { goForwardTool } from "./goForward.js";
import { hoverAtTool } from "./hoverAt.js";
import { dragAndDropTool } from "./dragAndDrop.js";
import { wait5SecondsTool } from "./wait5Seconds.js";
import { openWebBrowserTool } from "./openWebBrowser.js";

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
