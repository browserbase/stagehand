import { countCssMatchesPrimary, countTextMatches, countXPathMatchesMainWorld } from "./counts.js";
import { installCursorOverlay, moveCursorOverlay } from "./cursorOverlay.js";
import { getOpenOrClosedShadowRoot } from "./shadowRoots.js";
import { resolveCssSelector, resolveTextSelector, resolveXPathMainWorld } from "./selectors.js";
import { createSelectorWait } from "./waitForSelector.js";
import {
  countSemanticMatches,
  querySemanticSelector,
  resolveSemanticSelector,
} from "./semanticSelectors.js";

export const locatorScripts = Object.freeze({
  countCssMatchesPrimary,
  countTextMatches,
  countXPathMatchesMainWorld,
  getOpenOrClosedShadowRoot,
  installCursorOverlay,
  moveCursorOverlay,
  resolveCssSelector,
  resolveTextSelector,
  resolveXPathMainWorld,
  createSelectorWait,
  countSemanticMatches,
  querySemanticSelector,
  resolveSemanticSelector,
});

export type LocatorScriptName = keyof typeof locatorScripts;
