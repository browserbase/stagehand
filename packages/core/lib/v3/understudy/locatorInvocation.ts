import {
  locatorScriptBootstrap,
  locatorScriptGlobalRefs,
  type LocatorScriptName,
} from "../dom/build/locatorScripts.generated.js";

/**
 * Build an expression that injects the locator bundle (if needed) and invokes a
 * specific helper via its stable global reference. This keeps Runtime.evaluate
 * payloads tiny while guaranteeing our selector utilities are present in any
 * execution context.
 */
export function buildLocatorInvocation(
  name: LocatorScriptName,
  args: string[],
): string {
  const invocation = `${locatorScriptGlobalRefs[name]}(${args.join(", ")})`;
  return `(() => { ${locatorScriptBootstrap}; return ${invocation}; })()`;
}
