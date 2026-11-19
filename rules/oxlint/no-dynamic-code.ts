import { defineRule, type ESTree } from "@oxlint/plugins";

// Keep the CLI's former no-restricted-syntax selectors and
// security/detect-eval-with-expression behavior, including shadowed identifiers.
// Native no-eval/no-new-func rules additionally check actual global references.
export const noDynamicCode = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow dynamic code construction in the CLI." },
  },
  create(context) {
    function check(node: ESTree.CallExpression | ESTree.NewExpression) {
      const callee = node.callee;
      const directFunction = callee.type === "Identifier" && callee.name === "Function";
      const globalFunction =
        node.type === "CallExpression" &&
        callee.type === "MemberExpression" &&
        callee.object.type === "Identifier" &&
        callee.object.name === "globalThis" &&
        callee.property.type === "Identifier" &&
        callee.property.name === "Function";
      if (directFunction || globalFunction) {
        context.report({ node, message: "Dynamic function construction is prohibited." });
      }
      if (
        node.type === "CallExpression" &&
        callee.type === "Identifier" &&
        callee.name === "eval" &&
        node.arguments.length > 0 &&
        node.arguments[0].type !== "Literal"
      ) {
        context.report({ node, message: "Calling eval with a nonliteral argument is prohibited." });
      }
    }
    return { CallExpression: check, NewExpression: check };
  },
});
