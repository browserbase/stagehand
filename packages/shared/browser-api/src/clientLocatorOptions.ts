import type { Locator } from "./locator.js";

export type ClientLocatorOptions = {
  locator?: Locator;
  ignoreLocators?: Locator[];
};

export function serializeClientLocator(locator: Locator, pageId: string, method: string) {
  if (locator.descriptor.pageId !== pageId) {
    throw new TypeError(`${method}(): locator must belong to the target page`);
  }
  const { selector, nth } = locator.descriptor;
  return {
    selector,
    ...(nth === undefined ? {} : { nth }),
  };
}

export function serializeClientLocatorOptions<Options extends ClientLocatorOptions>(
  method: string,
  pageId: string,
  options: Options,
) {
  const { locator, ignoreLocators, ...rest } = options;
  return {
    ...rest,
    ...(locator ? { locator: serializeClientLocator(locator, pageId, method) } : {}),
    ...(ignoreLocators
      ? {
          ignoreLocators: ignoreLocators.map((ignoredLocator) =>
            serializeClientLocator(ignoredLocator, pageId, method),
          ),
        }
      : {}),
  };
}
