import { defineRule, type ESTree } from "@oxlint/plugins";

const nodeGlobals = new Set([
  "process",
  "Buffer",
  "NodeJS",
  "__dirname",
  "__filename",
  "global",
  "setImmediate",
  "clearImmediate",
]);

export const noNodeGlobals = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow Node globals in browser production code." },
  },
  create(context) {
    function report(node: ESTree.Node, name: string) {
      context.report({
        node,
        message: `Browser production code must not use Node global ${name}.`,
      });
    }
    return {
      "Program:exit"() {
        for (const scope of context.sourceCode.scopeManager.scopes) {
          for (const reference of scope.references) {
            const { identifier, resolved } = reference;
            if (nodeGlobals.has(identifier.name) && (!resolved || resolved.defs.length === 0)) {
              report(identifier, identifier.name);
            }
          }
        }
      },
      MemberExpression(node: ESTree.MemberExpression) {
        if (
          node.object.type !== "Identifier" ||
          node.object.name !== "globalThis" ||
          !context.sourceCode.isGlobalReference(node.object)
        )
          return;
        const name =
          !node.computed && node.property.type === "Identifier"
            ? node.property.name
            : node.computed &&
                node.property.type === "Literal" &&
                typeof node.property.value === "string"
              ? node.property.value
              : undefined;
        if (name && nodeGlobals.has(name)) report(node.property, name);
      },
    };
  },
});
