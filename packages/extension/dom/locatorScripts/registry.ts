import { countCssMatchesPrimary, countTextMatches, countXPathMatchesMainWorld } from "./counts.js";
import { installCursorOverlay, moveCursorOverlay } from "./cursorOverlay.js";
import { getOpenOrClosedShadowRoot } from "./shadowRoots.js";
import { resolveCssSelector, resolveTextSelector, resolveXPathMainWorld } from "./selectors.js";
import { waitForSelector } from "./waitForSelector.js";

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
  waitForSelector,
});

export type LocatorScriptName = keyof typeof locatorScripts;
