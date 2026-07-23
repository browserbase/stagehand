import { readdir, readFile } from "node:fs/promises";
import python from "@ast-grep/lang-python";
import { parse, registerDynamicLanguage, type SgNode } from "@ast-grep/napi";
import { describe, expect, it } from "vite-plus/test";

registerDynamicLanguage({ python });

const exampleDirectories = {
  python: new URL("../../packages/sdk-python/examples/", import.meta.url),
  typescript: new URL("../../packages/sdk-ts/examples/", import.meta.url),
} as const;

type ExampleLanguage = keyof typeof exampleDirectories;

const exampleExtensions: Record<ExampleLanguage, string> = {
  python: ".py",
  typescript: ".ts",
};

describe("All language examples remain in sync", () => {
  it("provides the same examples in TypeScript and Python", async () => {
    const inventories = {
      python: (await examples("python")).map(({ name }) => name),
      typescript: (await examples("typescript")).map(({ name }) => name),
    };

    expect(inventories.python).toStrictEqual(inventories.typescript);
    expect(inventories.typescript.length).toBeGreaterThan(0);
  });

  it("calls the same public SDK operations in every matching example", async () => {
    const typescriptExamples = await examples("typescript");
    const pythonExamples = new Map(
      (await examples("python")).map((example) => [example.name, example]),
    );

    for (const typescript of typescriptExamples) {
      const pythonExample = pythonExamples.get(typescript.name);
      expect(pythonExample, `${typescript.name} must have a Python example`).toBeDefined();
      if (!pythonExample) continue;

      const typescriptRoot = parse("typescript", await readFile(typescript.url, "utf8")).root();
      const pythonRoot = parse("python", await readFile(pythonExample.url, "utf8")).root();

      expect(
        publicSdkOperations(pythonRoot, "python"),
        `${typescript.name} must call the same public SDK operations in Python and TypeScript`,
      ).toStrictEqual(publicSdkOperations(typescriptRoot, "typescript"));
    }
  });

  it("uses the public Stagehand lifecycle in every example", async () => {
    for (const language of ["typescript", "python"] as const) {
      for (const example of await examples(language)) {
        const root = parse(language, await readFile(example.url, "utf8")).root();
        const stagehand = stagehandVariable(root, language);
        const publicImport = root.find({
          rule: {
            pattern:
              language === "typescript"
                ? 'import { $$$IMPORTS } from "../src/index.js"'
                : "from stagehand import $$$IMPORTS",
          },
        });

        expect(
          publicImport,
          `${language} ${example.file} must import the public SDK`,
        ).not.toBeNull();
        expect(
          publicImport?.getMultipleMatches("IMPORTS").some((node) => node.text() === "Stagehand"),
          `${language} ${example.file} must import public Stagehand`,
        ).toBe(true);
        expect(stagehand, `${language} ${example.file} must construct Stagehand`).toBeDefined();
        expect(
          root.find({ rule: { pattern: `await ${stagehand}.init()` } }),
          `${language} ${example.file} must initialize Stagehand`,
        ).not.toBeNull();
        expect(
          root.find({ rule: { pattern: `await ${stagehand}.close()` } }),
          `${language} ${example.file} must close Stagehand`,
        ).not.toBeNull();
        expect(
          root.text(),
          `${language} ${example.file} must not reach into SDK internals`,
        ).not.toMatch(/\b(?:CDPClient|RPCClient|Transport|_generated|rpc_client)\b/);
      }
    }
  });
});

async function examples(
  language: ExampleLanguage,
): Promise<Array<{ file: string; name: string; url: URL }>> {
  const extension = exampleExtensions[language];
  return (await readdir(exampleDirectories[language]))
    .filter((file) => file.endsWith(extension))
    .map((file) => ({
      file,
      name: file.slice(0, -extension.length).replaceAll("_", "-"),
      url: new URL(file, exampleDirectories[language]),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function stagehandVariable(root: SgNode, language: ExampleLanguage): string | undefined {
  const construction = root.find({
    rule: {
      pattern:
        language === "typescript"
          ? "const $STAGEHAND = new Stagehand($$$ARGS)"
          : "$STAGEHAND = Stagehand($$$ARGS)",
    },
  });

  return construction?.getMatch("STAGEHAND")?.text();
}

function publicSdkOperations(root: SgNode, language: ExampleLanguage): string[] {
  const stagehand = stagehandVariable(root, language);
  if (!stagehand) return [];

  const assignments = root.findAll({
    rule: { pattern: language === "typescript" ? "const $NAME = $VALUE" : "$NAME = $VALUE" },
  });
  const pageObjects = new Set(
    assignments.flatMap((assignment) => {
      const value = assignment.getMatch("VALUE");
      const comesFromContext = value?.find({
        rule: { pattern: `${stagehand}.context.$METHOD($$$ARGS)` },
      });
      const name = assignment.getMatch("NAME")?.text();
      return comesFromContext && name ? [name] : [];
    }),
  );

  return root
    .findAll({ rule: { pattern: "$OBJECT.$METHOD($$$ARGS)" } })
    .flatMap((call) => {
      const object = call.getMatch("OBJECT")?.text();
      const method = call.getMatch("METHOD")?.text();
      if (!object || !method) return [];

      if (object === stagehand) return [`stagehand.${snakeCase(method)}`];
      if (object === `${stagehand}.context`) return [`context.${snakeCase(method)}`];
      if (pageObjects.has(object)) return [`page.${snakeCase(method)}`];
      return [];
    })
    .sort();
}

function snakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}
