import ts from "typescript";
import type { Plugin } from "vite-plus";

// Remove this pre-transform once Oxc can lower TypeScript 5 standard decorators.
export function instrumentedDecoratorBuild(): Plugin {
  return {
    name: "stagehand-instrumented-decorator",
    enforce: "pre",
    transform(code, id) {
      if (!id.split("?", 1)[0].endsWith(".ts") || !code.includes("@Instrumented(")) {
        return null;
      }

      const result = ts.transpileModule(code, {
        compilerOptions: {
          inlineSourceMap: true,
          inlineSources: true,
          module: ts.ModuleKind.ESNext,
          target: ts.ScriptTarget.ES2022,
        },
        fileName: id,
      });

      return result.outputText;
    },
  };
}
