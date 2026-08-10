import { defineRule, type ESTree } from "@oxlint/plugins";

function importedName(node: ESTree.ImportSpecifier["imported"]): string {
  return node.type === "Identifier" ? node.name : String(node.value);
}

export const noRenamedImports = defineRule({
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Named imports must keep their exported names so references remain consistent across the codebase.",
    },
  },

  create(context) {
    return {
      ImportSpecifier(node: ESTree.ImportSpecifier) {
        const imported = importedName(node.imported);
        if (imported === node.local.name) return;

        context.report({
          node,
          message: `Import "${imported}" without renaming it to "${node.local.name}".`,
        });
      },
    };
  },
});
