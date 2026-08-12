import type { LocatorScriptName } from "../dom/locatorScripts/registry.js";

/**
 * Build an expression that invokes a helper installed by Stagehand's extension
 * content script in its isolated world.
 */
export function buildLocatorInvocation(name: LocatorScriptName, args: string[]): string {
  const key = JSON.stringify(name);
  return `(() => {
    const scripts = globalThis.__stagehandLocatorScripts;
    if (!scripts) throw new Error("Stagehand extension world is not initialized");
    return scripts[${key}](${args.join(", ")});
  })()`;
}
