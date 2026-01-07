/**
 * Stagehand Agent Tools
 *
 * These are the standard tools used by Stagehand agents for web automation.
 * They support both DOM-based (act, fillForm) and coordinate-based (click, type) modes.
 */

// Tool exports
export { actTool } from "./act";
export { ariaTreeTool } from "./ariaTree";
export { clickTool } from "./click";
export { clickAndHoldTool } from "./clickAndHold";
export { dragAndDropTool } from "./dragAndDrop";
export { extractTool } from "./extract";
export { fillFormTool } from "./fillform";
export { fillFormVisionTool } from "./fillFormVision";
export { gotoTool } from "./goto";
export { keysTool } from "./keys";
export { navBackTool } from "./navback";
export { screenshotTool } from "./screenshot";
export { scrollTool, scrollVisionTool } from "./scroll";
export { searchTool } from "./search";
export { thinkTool } from "./think";
export { typeTool } from "./type";
export { waitTool } from "./wait";

