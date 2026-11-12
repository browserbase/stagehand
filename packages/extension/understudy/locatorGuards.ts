import type { LocatorChain } from "@browserbasehq/stagehand-protocol/types";
import { UnsupportedPromptLocatorError } from "../errors.js";

export function hasPromptSelector(chain: LocatorChain): boolean {
  return chain.steps.some((step) => step.selector.type === "prompt");
}

export function assertDeterministicLocator(chain: LocatorChain, usage: string): void {
  if (hasPromptSelector(chain)) {
    throw new UnsupportedPromptLocatorError(`Prompt selectors are not supported in ${usage}`);
  }
}

export function assertDeterministicLocatorOptions(options?: {
  locator?: { selector: LocatorChain };
  ignoreLocators?: { selector: LocatorChain }[];
}): void {
  if (options?.locator) assertDeterministicLocator(options.locator.selector, "locator scopes");
  for (const locator of options?.ignoreLocators ?? []) {
    assertDeterministicLocator(locator.selector, "locator exclusions");
  }
}
