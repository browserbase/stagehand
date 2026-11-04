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
  "require",
  "module",
  "exports",
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
    function isGlobalThis(node: ESTree.Node | null): boolean {
      return (
        node?.type === "Identifier" &&
        node.name === "globalThis" &&
        context.sourceCode.isGlobalReference(node)
      );
    }
    function checkProperty(node: ESTree.Node, computed: boolean) {
      const name =
        !computed && node.type === "Identifier"
          ? node.name
          : node.type === "Literal" && typeof node.value === "string"
            ? node.value
            : undefined;
      if (name && nodeGlobals.has(name)) report(node, name);
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
        if (isGlobalThis(node.object)) checkProperty(node.property, node.computed);
      },
      ObjectPattern(node: ESTree.ObjectPattern | ESTree.ObjectAssignmentTarget) {
        const parent = node.parent;
        const source =
          parent.type === "VariableDeclarator" && parent.id === node
            ? parent.init
            : (parent.type === "AssignmentExpression" || parent.type === "AssignmentPattern") &&
                parent.left === node
              ? parent.right
              : null;
        if (!isGlobalThis(source)) return;
        for (const property of node.properties) {
          if (property.type === "Property") checkProperty(property.key, property.computed);
        }
      },
    };
  },
});
