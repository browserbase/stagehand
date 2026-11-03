import { defineRule } from "@oxlint/plugins";

// Oxlint rejects legacy octal literals in strict modules, but not in CommonJS.
// Preserve ESLint's no-octal rule for both kinds of files.
export const noLegacyOctal = defineRule({
  meta: {
    type: "problem",
    docs: { description: "Disallow legacy octal literals; use the explicit 0o prefix." },
  },
  create(context) {
    return {
      Literal(node) {
        if (typeof node.value === "number" && /^0[0-7]+$/.test(node.raw ?? "")) {
          context.report({
            node,
            message: "Legacy octal literals are prohibited. Use the 0o prefix.",
          });
        }
      },
    };
  },
});
