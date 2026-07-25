import { readdir, readFile } from "node:fs/promises";
import go from "@ast-grep/lang-go";
import python from "@ast-grep/lang-python";
import { parse, registerDynamicLanguage, type SgNode } from "@ast-grep/napi";
import { describe, expect, it } from "vitest";

registerDynamicLanguage({ go, python });

const exampleDirectories = {
  go: new URL("../../packages/sdk-go/examples/", import.meta.url),
  python: new URL("../../packages/sdk-python/examples/", import.meta.url),
  typescript: new URL("../../packages/sdk-ts/examples/", import.meta.url),
} as const;

type ExampleLanguage = keyof typeof exampleDirectories;

const exampleExtensions: Record<ExampleLanguage, string> = {
  go: ".go",
  python: ".py",
  typescript: ".ts",
};

describe("All language examples remain in sync", () => {
  it("provides the same examples in every SDK", async () => {
    const inventories = {
      go: (await examples("go")).map(({ name }) => name),
      python: (await examples("python")).map(({ name }) => name),
      typescript: (await examples("typescript")).map(({ name }) => name),
    };

    expect(inventories.python).toStrictEqual(inventories.typescript);
    expect(inventories.go).toStrictEqual(inventories.typescript);
    expect(inventories.typescript.length).toBeGreaterThan(0);
  });

  it("calls the same public SDK operations in every matching example", async () => {
    const typescriptExamples = await examples("typescript");
    const pythonExamples = new Map(
      (await examples("python")).map((example) => [example.name, example]),
    );
    const goExamples = new Map((await examples("go")).map((example) => [example.name, example]));

    for (const typescript of typescriptExamples) {
      const pythonExample = pythonExamples.get(typescript.name);
      const goExample = goExamples.get(typescript.name);
      expect(pythonExample, `${typescript.name} must have a Python example`).toBeDefined();
      expect(goExample, `${typescript.name} must have a Go example`).toBeDefined();
      if (!pythonExample || !goExample) continue;

      const typescriptRoot = parse("typescript", await readFile(typescript.url, "utf8")).root();
      const pythonRoot = parse("python", await readFile(pythonExample.url, "utf8")).root();
      const goRoot = parse("go", await readFile(goExample.url, "utf8")).root();

      expect(
        publicSdkOperations(pythonRoot, "python"),
        `${typescript.name} must call the same public SDK operations in Python and TypeScript`,
      ).toStrictEqual(publicSdkOperations(typescriptRoot, "typescript"));
      expect(
        publicSdkOperations(goRoot, "go"),
        `${typescript.name} must call the same public SDK operations in Go and TypeScript`,
      ).toStrictEqual(publicSdkOperations(typescriptRoot, "typescript"));
    }
  });

  it("uses the public Stagehand lifecycle in every example", async () => {
    for (const language of ["typescript", "python", "go"] as const) {
      for (const example of await examples(language)) {
        const root = parse(language, await readFile(example.url, "utf8")).root();
        const stagehand = stagehandVariable(root, language);
        const publicImport =
          language === "go"
            ? root
                .findAll({ rule: { kind: "import_spec" } })
                .find((node) =>
                  node.text().endsWith('"github.com/browserbase/stagehand/packages/sdk-go"'),
                )
            : root.find({
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
        if (language !== "go") {
          expect(
            publicImport?.getMultipleMatches("IMPORTS").some((node) => node.text() === "Stagehand"),
            `${language} ${example.file} must import public Stagehand`,
          ).toBe(true);
        }
        expect(stagehand, `${language} ${example.file} must construct Stagehand`).toBeDefined();
        if (language === "go") {
          expect(
            goCalls(root).some(({ object, method }) => object === stagehand && method === "Init"),
            `${language} ${example.file} must initialize Stagehand`,
          ).toBe(true);
          expect(
            goCalls(root).some(({ object, method }) => object === stagehand && method === "Close"),
            `${language} ${example.file} must close Stagehand`,
          ).toBe(true);
        } else {
          expect(
            root.find({ rule: { pattern: `await ${stagehand}.init()` } }),
            `${language} ${example.file} must initialize Stagehand`,
          ).not.toBeNull();
          expect(
            root.find({ rule: { pattern: `await ${stagehand}.close()` } }),
            `${language} ${example.file} must close Stagehand`,
          ).not.toBeNull();
        }
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
  if (language === "go") {
    return (await readdir(exampleDirectories.go, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({
        file: `${entry.name}/main.go`,
        name: entry.name,
        url: new URL(`${entry.name}/main.go`, exampleDirectories.go),
      }))
      .sort((left, right) => left.name.localeCompare(right.name));
  }
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
          : language === "python"
            ? "$STAGEHAND = Stagehand($$$ARGS)"
            : "$STAGEHAND := stagehand.New($$$ARGS)",
    },
  });

  return construction?.getMatch("STAGEHAND")?.text();
}

function publicSdkOperations(root: SgNode, language: ExampleLanguage): string[] {
  const stagehand = stagehandVariable(root, language);
  if (!stagehand) return [];

  if (language === "go") return goPublicSdkOperations(root, stagehand);

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

function goPublicSdkOperations(root: SgNode, stagehand: string): string[] {
  const assignedValues = goAssignedValues(root);
  const contextObjects = new Set(
    assignedValues.flatMap(({ name, value }) => {
      const target = goCallTarget(value);
      return target?.object === stagehand && target.method === "Context" ? [name] : [];
    }),
  );
  const pageObjects = new Set(
    assignedValues.flatMap(({ name, value }) => {
      const target = goCallTarget(value);
      return target && contextObjects.has(target.object) ? [name] : [];
    }),
  );

  return goCalls(root)
    .flatMap(({ object, method }) => {
      if (object === stagehand && method !== "Context") {
        return [`stagehand.${snakeCase(method)}`];
      }
      if (contextObjects.has(object)) return [`context.${snakeCase(method)}`];
      if (pageObjects.has(object)) return [`page.${snakeCase(method)}`];
      return [];
    })
    .sort();
}

function goAssignedValues(root: SgNode): Array<{ name: string; value: SgNode }> {
  return root.findAll({ rule: { kind: "short_var_declaration" } }).flatMap((assignment) => {
    const [names, values] = assignment.children().filter((child) => child.isNamed());
    const name = names?.children().find((child) => child.isNamed());
    const value = values?.children().find((child) => child.isNamed());
    return name && value ? [{ name: name.text(), value }] : [];
  });
}

function goCalls(root: SgNode): Array<{ object: string; method: string }> {
  return root.findAll({ rule: { kind: "call_expression" } }).flatMap((call) => {
    const target = goCallTarget(call);
    return target ? [target] : [];
  });
}

function goCallTarget(node: SgNode): { object: string; method: string } | undefined {
  if (node.kind() !== "call_expression") return undefined;
  const called = node.children().filter((child) => child.isNamed())[0];
  if (called?.kind() !== "selector_expression") return undefined;
  const [object, method] = called.children().filter((child) => child.isNamed());
  return object && method ? { object: object.text(), method: method.text() } : undefined;
}

function snakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}
