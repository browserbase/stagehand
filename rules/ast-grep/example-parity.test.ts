import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import python from "@ast-grep/lang-python";
import { parse, registerDynamicLanguage, type SgNode } from "@ast-grep/napi";
import { describe, expect, it } from "vitest";

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

describe("example name normalization", () => {
  it.each([
    ["customLlm", "custom-llm"],
    ["custom_llm", "custom-llm"],
    ["custom-llm", "custom-llm"],
    ["parseHTMLElement", "parse-html-element"],
    ["parse_html_element", "parse-html-element"],
    ["URLParser", "url-parser"],
  ])("normalizes %s to %s", (name, expected) => {
    expect(normalizeExampleName(name)).toBe(expected);
  });
});

describe("TypeScript and Python examples remain in sync", () => {
  it("provides the same examples in both active SDKs", async () => {
    await assertExampleInventory(exampleDirectories);
  });

  it("calls the same public SDK operations in every matching example", async () => {
    await assertExampleOperations(exampleDirectories);
  });

  it("uses the public SDK lifecycle required by each example", async () => {
    for (const language of ["typescript", "python"] as const) {
      for (const example of await examples(language)) {
        const root = parse(language, await readFile(example.url, "utf8")).root();
        const stagehand = stagehandVariable(root, language);
        const operations = publicSdkOperations(root, language);
        const usesOnlyBrowserbaseServices =
          operations.length > 0 &&
          operations.every((operation) => operation.startsWith("browserbase."));
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
        ).toBeDefined();
        if (usesOnlyBrowserbaseServices) {
          expect(
            publicImport
              ?.getMultipleMatches("IMPORTS")
              .some((node) => node.text() === "browserbase"),
            `${language} ${example.file} must import public browserbase services`,
          ).toBe(true);
          expect(
            stagehand,
            `${language} ${example.file} must not construct Stagehand for browserless services`,
          ).toBeUndefined();
        } else {
          expect(
            publicImport?.getMultipleMatches("IMPORTS").some((node) => node.text() === "Stagehand"),
            `${language} ${example.file} must import public Stagehand`,
          ).toBe(true);
        }
        if (usesOnlyBrowserbaseServices) {
          expect(
            root.text(),
            `${language} ${example.file} must not reach into SDK internals`,
          ).not.toMatch(/\b(?:CDPClient|RPCClient|Transport|_generated|rpc_client)\b/);
          continue;
        }
        expect(stagehand, `${language} ${example.file} must construct Stagehand`).toBeDefined();
        if (language === "typescript") {
          expect(
            root.find({
              rule: { pattern: `const ${stagehand} = await Stagehand.create($$$ARGS)` },
            }),
            `${language} ${example.file} must create Stagehand asynchronously`,
          ).not.toBeNull();
          expect(
            root.find({ rule: { pattern: `await ${stagehand}.close()` } }),
            `${language} ${example.file} must close Stagehand`,
          ).not.toBeNull();
        } else {
          expect(
            root.find({ rule: { pattern: `${stagehand} = await Stagehand.create($$$ARGS)` } }),
            `${language} ${example.file} must create Stagehand asynchronously`,
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

describe("active SDK example coverage regressions", () => {
  it.each([
    { name: "accepts a new TS/Python example without Go", missing: "none", part: "none" },
    { name: "rejects a missing TypeScript example", missing: "typescript", part: "example" },
    { name: "rejects a missing Python example", missing: "python", part: "example" },
    { name: "rejects a missing TypeScript operation", missing: "typescript", part: "operation" },
    { name: "rejects a missing Python operation", missing: "python", part: "operation" },
  ] as const)("$name", async ({ missing, part }) => {
    const directory = await mkdtemp(join(tmpdir(), "sdk-example-parity-"));
    try {
      const directories = {
        typescript: pathToFileURL(`${join(directory, "typescript")}/`),
        python: pathToFileURL(`${join(directory, "python")}/`),
      };
      const fixtures = {
        typescript: `const client = await Stagehand.create({});
const page = await client.browser.context.newPage();
await page.freshFeature();
await client.close();`,
        python: `client = await Stagehand.create()
page = await client.browser.context.new_page()
await page.fresh_feature()
await client.close()`,
      };
      for (const language of ["typescript", "python"] as const) {
        await mkdir(directories[language]);
        if (missing === language && part === "example") continue;
        const source =
          missing === language && part === "operation"
            ? fixtures[language].replace(/^await page\..+$/mu, "")
            : fixtures[language];
        // Different spellings exercise filename normalization as well as discovery.
        const file = language === "typescript" ? "freshFeature.ts" : "fresh_feature.py";
        await writeFile(new URL(file, directories[language]), source);
      }
      if (part === "example") {
        await expect(assertExampleInventory(directories)).rejects.toThrow(
          "TS/Python must provide matching examples",
        );
      } else {
        await assertExampleInventory(directories);
        const check = assertExampleOperations(directories);
        if (part === "operation")
          await expect(check).rejects.toThrow("must call the same public SDK operations");
        else await expect(check).resolves.toBeUndefined();
      }
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});

async function assertExampleInventory(directories: Record<ExampleLanguage, URL>): Promise<void> {
  const inventories = {
    python: (await examples("python", directories.python)).map(({ name }) => name),
    typescript: (await examples("typescript", directories.typescript)).map(({ name }) => name),
  };

  expect(inventories.python, "TS/Python must provide matching examples").toStrictEqual(
    inventories.typescript,
  );
  expect(inventories.typescript.length).toBeGreaterThan(0);
}

async function assertExampleOperations(directories: Record<ExampleLanguage, URL>): Promise<void> {
  const typescriptExamples = await examples("typescript", directories.typescript);
  const pythonExamples = new Map(
    (await examples("python", directories.python)).map((example) => [example.name, example]),
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
}

async function examples(
  language: ExampleLanguage,
  directory: URL = exampleDirectories[language],
): Promise<Array<{ file: string; name: string; url: URL }>> {
  const extension = exampleExtensions[language];
  return (await readdir(directory))
    .filter((file) => file.endsWith(extension))
    .map((file) => ({
      file,
      name: normalizeExampleName(file.slice(0, -extension.length)),
      url: new URL(file, directory),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

function stagehandVariable(root: SgNode, language: ExampleLanguage): string | undefined {
  const construction = root.find({
    rule: {
      pattern:
        language === "typescript"
          ? "const $STAGEHAND = await Stagehand.create($$$ARGS)"
          : "$STAGEHAND = await Stagehand.create($$$ARGS)",
    },
  });

  return construction?.getMatch("STAGEHAND")?.text();
}

function publicSdkOperations(root: SgNode, language: ExampleLanguage): string[] {
  const stagehand = stagehandVariable(root, language);
  if (!stagehand) return browserbaseServiceOperations(root);

  const assignments = root.findAll({
    rule: { pattern: language === "typescript" ? "const $NAME = $VALUE" : "$NAME = $VALUE" },
  });
  const pageObjects = new Set(
    assignments.flatMap((assignment) => {
      const value = assignment.getMatch("VALUE");
      const comesFromContext = value?.find({
        rule: { pattern: `${stagehand}.browser.context.$METHOD($$$ARGS)` },
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

      if (object === stagehand && method !== "init" && method !== "close") {
        return [`stagehand.${snakeCase(method)}`];
      }
      if (object === `${stagehand}.browser.context`) return [`context.${snakeCase(method)}`];
      if (pageObjects.has(object)) return [`page.${snakeCase(method)}`];
      return [];
    })
    .sort();
}

function browserbaseServiceOperations(root: SgNode): string[] {
  return root
    .findAll({ rule: { pattern: "$OBJECT.$METHOD($$$ARGS)" } })
    .flatMap((call) => {
      const object = call.getMatch("OBJECT")?.text();
      const method = call.getMatch("METHOD")?.text();
      return object === "browserbase" && (method === "search" || method === "fetch")
        ? [`browserbase.${method}`]
        : [];
    })
    .sort();
}

function snakeCase(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2")
    .toLowerCase();
}

function normalizeExampleName(value: string): string {
  return snakeCase(value).replaceAll("_", "-");
}
