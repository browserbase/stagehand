import { defineRule, type ESTree } from "@oxlint/plugins";

function keyName(key: ESTree.PropertyKey): string | null {
  if (key.type === "Identifier") return key.name;
  if (key.type === "Literal" && typeof key.value === "string") return key.value;
  return null;
}

export const noLooseJsonSchemaInProtocolOperations = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Protocol operation params/results must reference named schemas imported from the canonical protocol schema module.",
    },
  },

  create(context) {
    const canonicalSchemas = new Set<string>();

    if (!context.filename.endsWith("packages/protocol/schema-registry.ts")) return {};

    return {
      ImportDeclaration(node: ESTree.ImportDeclaration) {
        if (node.source.value !== "./schemas.ts" && node.source.value !== "./schemas.js") return;

        for (const specifier of node.specifiers) {
          if (specifier.type !== "ImportSpecifier") continue;
          canonicalSchemas.add(specifier.local.name);
        }
      },

      Property(node: ESTree.ObjectProperty) {
        const propertyName = keyName(node.key);
        if (propertyName !== "paramsSchema" && propertyName !== "resultSchema") return;
        if (node.value.type === "Identifier" && canonicalSchemas.has(node.value.name)) return;

        context.report({
          node: node.value,
          message: `Protocol operation ${propertyName} must reference a named schema imported from ./schemas.ts.`,
        });
      },
    };
  },
});
