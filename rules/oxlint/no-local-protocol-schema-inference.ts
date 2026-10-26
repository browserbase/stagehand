import { defineRule, type ESTree } from "@oxlint/plugins";

function isExcludedFile(filename: string): boolean {
  const normalized = filename.replaceAll("\\", "/");
  return (
    normalized.endsWith("packages/protocol/types.ts") ||
    normalized.endsWith("packages/protocol/json-rpc/types.ts") ||
    normalized.includes("/tests/") ||
    /\.test(?:-d)?\.ts$/.test(normalized)
  );
}

function isProtocolSchemaModule(filename: string, source: string): boolean {
  const normalizedFilename = filename.replaceAll("\\", "/");
  const normalizedSource = source.replaceAll("\\", "/").replace(/\.[cm]?[jt]s$/, "");

  if (
    normalizedSource.endsWith("/protocol/schemas") ||
    normalizedSource.endsWith("/protocol/json-rpc/schemas")
  ) {
    return true;
  }

  if (normalizedSource !== "./schemas") return false;

  const directory = normalizedFilename.slice(0, normalizedFilename.lastIndexOf("/"));
  return (
    directory.endsWith("/packages/protocol") || directory.endsWith("/packages/protocol/json-rpc")
  );
}

function identifierName(node: ESTree.Node | null | undefined): string | null {
  return node?.type === "Identifier" ? node.name : null;
}

export const noLocalProtocolSchemaInference = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Protocol consumers must import inferred types instead of deriving them from canonical schemas locally.",
    },
  },

  create(context) {
    const filename = context.filename;
    const schemaImports = new Set<string>();
    const schemaNamespaces = new Set<string>();

    if (isExcludedFile(filename)) return {};

    return {
      ImportDeclaration(node: ESTree.ImportDeclaration) {
        const source = node.source.value;
        if (!isProtocolSchemaModule(filename, source)) return;

        for (const specifier of node.specifiers) {
          if (specifier.type === "ImportNamespaceSpecifier") {
            schemaNamespaces.add(specifier.local.name);
            continue;
          }

          if (specifier.type !== "ImportSpecifier") continue;
          const imported = identifierName(specifier.imported);
          if (imported?.endsWith("Schema")) schemaImports.add(specifier.local.name);
        }
      },

      TSTypeQuery(node: ESTree.TSTypeQuery) {
        const expression = node.exprName;
        const directName = identifierName(expression);
        let schemaName = directName && schemaImports.has(directName) ? directName : null;

        if (!schemaName && expression.type === "TSQualifiedName") {
          const namespace = identifierName(expression.left);
          const qualifiedName = identifierName(expression.right);
          if (namespace && qualifiedName?.endsWith("Schema") && schemaNamespaces.has(namespace)) {
            schemaName = qualifiedName;
          }
        }

        if (!schemaName) return;

        context.report({
          node,
          message: `Import the inferred type for ${schemaName} from the adjacent protocol types module instead of deriving it locally.`,
        });
      },
    };
  },
});
