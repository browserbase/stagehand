import {
  a11yScriptBootstrap,
  a11yScriptGlobalRefs,
  type A11yScriptName,
} from "../dom/build/a11yScripts.generated.js";

/**
 * Wrap a generated a11y script in a self-invoking expression that first ensures
 * the bootstrap has run, then calls the requested helper via its global ref.
 * This mirrors the locator resolver’s injection path so any CDP Runtime.evaluate
 * can reuse the shared bundle without inlining JS strings.
 */
export function buildA11yInvocation(
  name: A11yScriptName,
  args: string[],
): string {
  const invocation = `${a11yScriptGlobalRefs[name]}(${args.join(", ")})`;
  return `(() => { ${a11yScriptBootstrap}; return ${invocation}; })()`;
}
