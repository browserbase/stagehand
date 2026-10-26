import { locatorScripts } from "./dom/locatorScripts/registry.js";

type StagehandExtensionWorldGlobal = typeof globalThis & {
  __stagehandExtensionWorld?: {
    name: "stagehand";
    version: "stagehand.v4";
  };
  __stagehandLocatorWorld?: {
    kind: "extension" | "cdp-fallback";
    closedShadowRoots: boolean;
  };
  __stagehandLocatorScripts?: typeof locatorScripts;
};

const scope = globalThis as StagehandExtensionWorldGlobal;

if (!scope.__stagehandExtensionWorld) {
  Object.defineProperty(scope, "__stagehandExtensionWorld", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      name: "stagehand",
      version: "stagehand.v4",
    }),
  });
}

if (!scope.__stagehandLocatorScripts) {
  Object.defineProperty(scope, "__stagehandLocatorScripts", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: locatorScripts,
  });
}

if (!scope.__stagehandLocatorWorld) {
  const closedShadowRoots = typeof globalThis.chrome?.dom?.openOrClosedShadowRoot === "function";
  Object.defineProperty(scope, "__stagehandLocatorWorld", {
    configurable: false,
    enumerable: false,
    writable: false,
    value: Object.freeze({
      kind: closedShadowRoots ? "extension" : "cdp-fallback",
      closedShadowRoots,
    }),
  });
}
