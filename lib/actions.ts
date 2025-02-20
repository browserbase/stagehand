import { Locator } from "@playwright/test";

const defaultMethods: Set<string> = new Set(getAvailableMethods({} as Locator));

export const actMethods = [
  "scrollIntoView",
  "press",
  "click",
  "fill",
  "type",
  "goBack",
] as const;

export function getAvailableMethods(locator: Locator) {
  return Object.keys(locator)
    .filter(
      (key) =>
        !defaultMethods.has(key) &&
        key in locator &&
        typeof locator[key as keyof Locator] === "function",
    )
    .concat(actMethods);
}
