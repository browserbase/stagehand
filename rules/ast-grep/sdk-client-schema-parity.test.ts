import { readFile } from "node:fs/promises";
import go from "@ast-grep/lang-go";
import python from "@ast-grep/lang-python";
import { parse, registerDynamicLanguage, type SgNode } from "@ast-grep/napi";
import { describe, expect, it } from "vitest";
import * as ClientSchemas from "../../packages/sdk-ts/src/clientSchemas.js";

registerDynamicLanguage({ go, python });

type ObjectSchema = {
  shape: Record<string, unknown>;
};

type Concept = {
  go: () => Promise<string[]>;
  name: string;
  python: () => Promise<string[]>;
  typescript: ObjectSchema;
};

const pythonSource = new URL("../../packages/sdk-python/src/stagehand/", import.meta.url);
const goSource = new URL("../../packages/sdk-go/", import.meta.url);
const docsSource = new URL("../../packages/docs/v4/", import.meta.url);
// These legacy Chrome extension ID overrides are not user-actionable and are pending deprecation.
const intentionallyUndocumentedBrowserFields = new Set([
  "LocalBrowserConnectOptions.extension_id",
  "BrowserbaseConnectOptions.extension_id",
]);

const concepts: readonly Concept[] = [
  {
    name: "LocalBrowserLaunchOptions",
    typescript: ClientSchemas.LocalBrowserLaunchOptionsSchema,
    python: () => pythonClassFields("client_types.py", "LocalBrowserLaunchOptions"),
    go: () => goStructFields("browser_factories.go", "LocalBrowserLaunchOptions"),
  },
  {
    name: "LocalBrowserConnectOptions",
    typescript: ClientSchemas.LocalBrowserConnectOptionsSchema,
    python: () => pythonClassFields("client_types.py", "LocalBrowserConnectOptions"),
    go: () => goStructFields("browser_factories.go", "LocalBrowserConnectOptions"),
  },
  {
    name: "BrowserbaseConnectOptions",
    typescript: ClientSchemas.BrowserbaseConnectOptionsSchema,
    python: () => pythonClassFields("client_types.py", "BrowserbaseConnectOptions"),
    go: () => goStructFields("browser_factories.go", "BrowserbaseConnectOptions"),
  },
  {
    name: "StagehandClientLoggingConfig",
    typescript: ClientSchemas.StagehandClientLoggingConfigSchema,
    python: () => pythonClassFields("client_types.py", "StagehandClientLoggingConfig"),
    go: () => goStructFields("client_options.go", "StagehandClientLoggingConfig"),
  },
  {
    name: "StagehandClientActOptions",
    typescript: ClientSchemas.StagehandClientActOptionsSchema,
    python: () => pythonMethodParameters("stagehand.py", "Stagehand", "act", ["instruction"]),
    go: () => goStructFields("client_options.go", "StagehandClientActOptions"),
  },
  {
    name: "StagehandClientObserveOptions",
    typescript: ClientSchemas.StagehandClientObserveOptionsSchema,
    python: () => pythonMethodParameters("stagehand.py", "Stagehand", "observe", ["instruction"]),
    go: () => goStructFields("client_options.go", "StagehandClientObserveOptions"),
  },
  {
    name: "StagehandClientExtractOptions",
    typescript: ClientSchemas.StagehandClientExtractOptionsSchema,
    python: () =>
      pythonMethodParameters("stagehand.py", "Stagehand", "extract", ["instruction", "schema"]),
    go: () => goStructFields("client_options.go", "StagehandClientExtractOptions"),
  },
] as const;

describe("SDK-owned schemas remain one cross-language contract", () => {
  it("keeps every comparable SDK-only field in TypeScript, Python, and Go", async () => {
    const differences: string[] = [];

    for (const concept of concepts) {
      const expected = schemaFields(concept.typescript);
      const [pythonFields, goFields] = await Promise.all([concept.python(), concept.go()]);
      if (!arraysEqual(pythonFields, expected)) {
        differences.push(
          `${concept.name} Python: expected [${expected.join(", ")}], received [${pythonFields.join(", ")}]`,
        );
      }
      if (!arraysEqual(goFields, expected)) {
        differences.push(
          `${concept.name} Go: expected [${expected.join(", ")}], received [${goFields.join(", ")}]`,
        );
      }
    }

    expect(
      differences,
      "SDK-only field names are derived dynamically; only concept/type names are paired explicitly",
    ).toEqual([]);
  });

  it("keeps Python public input declarations and runtime models in sync", async () => {
    const pairs = [
      "LocalBrowserLaunchOptions",
      "LocalBrowserConnectOptions",
      "BrowserbaseConnectOptions",
      "StagehandClientLoggingConfig",
      "StagehandClientCreateConfig",
    ];
    const differences: string[] = [];

    for (const name of pairs) {
      const [input, runtime] = await Promise.all([
        pythonClassFields("client_types.py", name),
        pythonClassFields("client_models.py", name),
      ]);
      if (!arraysEqual(input, runtime)) {
        differences.push(
          `${name}: public input [${input.join(", ")}], runtime model [${runtime.join(", ")}]`,
        );
      }
    }

    expect(
      differences,
      "Python TypedDicts and Pydantic models must expose identical fields",
    ).toEqual([]);
  });

  it("keeps Stagehand creation fields aligned while naming intentional language adapters", async () => {
    const expectedConfig = schemaFields(ClientSchemas.StagehandClientCreateConfigSchema);
    const expectedCreate = schemaFields(ClientSchemas.StagehandCreateOptionsSchema);
    const [pythonConfig, pythonCreate, goCreate] = await Promise.all([
      pythonClassFields("client_models.py", "StagehandClientCreateConfig"),
      pythonMethodParameters("stagehand.py", "Stagehand", "create", [
        "model_api_key",
        "model_headers",
      ]),
      goStructFields("client_options.go", "CreateOptions"),
    ]);

    expect(pythonConfig, "Python create config must match the canonical client schema").toEqual(
      expectedConfig,
    );
    expect(pythonCreate, "Python create parameters must match StagehandCreateOptions").toEqual(
      expectedCreate,
    );
    expect(
      goCreate.filter((field) => field !== "generate"),
      "Go splits the client-LLM callback into Generate; every other CreateOptions field must match",
    ).toEqual(expectedCreate);
    expect(goCreate, "Go must retain its explicit client-LLM callback adapter").toContain(
      "generate",
    );
  });

  it("classifies every exported SDK-owned object schema", () => {
    const compared = new Set([
      ...concepts.map(({ name }) => `${name}Schema`),
      "StagehandClientCreateConfigSchema",
      "StagehandCreateOptionsSchema",
    ]);
    const intentionallySpecialized = new Set([
      // Browserbase owns this open pass-through surface.
      "BrowserbaseLaunchOptionsSchema",
      // These validate Browserbase SDK responses rather than cross-language caller input.
      "BrowserbaseSessionConnectionSchema",
      "BrowserbaseSessionCreateResultSchema",
      "BrowserbaseSessionRetrieveResultSchema",
      // Runtime callbacks and handles are necessarily language-specific.
      "ClientLLMSchema",
      // These are partial views of already-generated protocol schemas.
      "WebMCPInvokeOptionsSchema",
      "WebMCPResultOptionsSchema",
      "WebMCPToolsOptionsSchema",
    ]);
    const objectSchemas = Object.entries(ClientSchemas)
      .filter(
        ([name, value]) =>
          name.endsWith("Schema") &&
          typeof value === "object" &&
          value !== null &&
          "shape" in value,
      )
      .map(([name]) => name)
      .sort();

    expect(
      objectSchemas,
      "A new SDK-owned Zod object must join cross-language parity or be explicitly classified",
    ).toStrictEqual([...compared, ...intentionallySpecialized].sort());
  });

  it("documents every Stagehand creation field structurally in each language tab", async () => {
    const source = await readFile(new URL("reference/stagehand.mdx", docsSource), "utf8");
    const pythonFields = await pythonMethodParameters("stagehand.py", "Stagehand", "create");
    const expected = {
      TypeScript: Object.keys(ClientSchemas.StagehandCreateOptionsSchema.shape).sort(),
      Python: pythonFields,
      Go: (await goStructFieldSpellings("client_options.go", "CreateOptions"))
        .map((field) => `options.${field}`)
        .sort(),
    } as const;
    const differences: string[] = [];

    for (const [language, fields] of Object.entries(expected)) {
      const section = languageSection(source, language);
      const create = headingSection(section, language === "Go" ? "Create" : "create");
      const documented = [...create.matchAll(/<ParamField\s+path="([^"]+)"/gu)]
        .map((match) => match[1] as string)
        .sort();
      if (!arraysEqual(documented, fields)) {
        differences.push(
          `${language}: expected [${fields.join(", ")}], received [${documented.join(", ")}]`,
        );
      }
    }

    expect(
      differences,
      "Stagehand.create reference fields must be exhaustive even when guides provide the longer explanations",
    ).toEqual([]);
  });

  it("mentions every SDK-owned browser and logging field in the configuration docs", async () => {
    const [browserDocs, loggingDocs] = await Promise.all([
      readFile(new URL("configuration/browser.mdx", docsSource), "utf8"),
      readFile(new URL("configuration/logging.mdx", docsSource), "utf8"),
    ]);
    const missing: string[] = [];
    const browserConcepts = concepts.filter(({ name }) =>
      [
        "LocalBrowserLaunchOptions",
        "LocalBrowserConnectOptions",
        "BrowserbaseConnectOptions",
      ].includes(name),
    );

    for (const concept of browserConcepts) {
      const typescriptFields = Object.keys(concept.typescript.shape);
      const pythonFields = await concept.python();
      const goFile =
        concept.name === "StagehandClientLoggingConfig"
          ? "client_options.go"
          : "browser_factories.go";
      const goFields = await goStructFieldSpellings(goFile, concept.name);
      for (const field of typescriptFields) {
        if (
          !isIntentionallyUndocumentedBrowserField(concept.name, field) &&
          !browserDocs.includes(field)
        ) {
          missing.push(`browser TypeScript ${concept.name}.${field}`);
        }
      }
      for (const field of pythonFields) {
        if (
          !isIntentionallyUndocumentedBrowserField(concept.name, field) &&
          !browserDocs.includes(field)
        ) {
          missing.push(`browser Python ${concept.name}.${field}`);
        }
      }
      for (const field of goFields) {
        if (
          !isIntentionallyUndocumentedBrowserField(concept.name, field) &&
          !browserDocs.includes(field)
        ) {
          missing.push(`browser Go ${concept.name}.${field}`);
        }
      }
    }
    for (const field of Object.keys(ClientSchemas.StagehandClientLoggingConfigSchema.shape)) {
      if (!loggingDocs.includes(field)) missing.push(`logging TypeScript ${field}`);
    }
    for (const field of await pythonClassFields(
      "client_types.py",
      "StagehandClientLoggingConfig",
    )) {
      if (!loggingDocs.includes(field)) missing.push(`logging Python ${field}`);
    }
    for (const field of await goStructFieldSpellings(
      "client_options.go",
      "StagehandClientLoggingConfig",
    )) {
      if (!loggingDocs.includes(field)) missing.push(`logging Go ${field}`);
    }

    expect(
      missing,
      "Configuration docs must mention every SDK-owned field in each language's public spelling",
    ).toEqual([]);
  });
});

function schemaFields(schema: ObjectSchema): string[] {
  return Object.keys(schema.shape).map(snakeCase).sort();
}

function isIntentionallyUndocumentedBrowserField(concept: string, field: string): boolean {
  return intentionallyUndocumentedBrowserFields.has(`${concept}.${snakeCase(field)}`);
}

async function pythonClassFields(file: string, className: string): Promise<string[]> {
  const root = parse("python", await readFile(new URL(file, pythonSource), "utf8")).root();
  const classNode = root
    .findAll({ rule: { kind: "class_definition" } })
    .find((candidate) => candidate.field("name")?.text() === className);
  if (!classNode) throw new Error(`${className} was not found in ${file}`);
  const body = classNode.field("body");
  if (!body) return [];
  return [
    ...new Set(
      body
        .findAll({ rule: { kind: "assignment" } })
        .filter(
          (assignment) =>
            assignment
              .ancestors()
              .find((ancestor) => ancestor.kind() === "class_definition")
              ?.field("name")
              ?.text() === className,
        )
        .flatMap((assignment) => {
          const left = assignment.field("left") ?? namedChildren(assignment)[0];
          return left?.kind() === "identifier" && left.text() !== "model_config"
            ? [snakeCase(left.text())]
            : [];
        }),
    ),
  ].sort();
}

async function pythonMethodParameters(
  file: string,
  className: string,
  methodName: string,
  excluded: readonly string[] = [],
): Promise<string[]> {
  const root = parse("python", await readFile(new URL(file, pythonSource), "utf8")).root();
  const method = root.findAll({ rule: { kind: "function_definition" } }).find(
    (candidate) =>
      candidate.field("name")?.text() === methodName &&
      candidate
        .ancestors()
        .find((ancestor) => ancestor.kind() === "class_definition")
        ?.field("name")
        ?.text() === className &&
      !candidate
        .ancestors()
        .some(
          (ancestor) =>
            ancestor.kind() === "decorated_definition" && ancestor.text().startsWith("@overload"),
        ),
  );
  if (!method) throw new Error(`${className}.${methodName} was not found in ${file}`);
  const parameters = method.field("parameters");
  if (!parameters) return [];
  const ignored = new Set(["self", "cls", ...excluded].map(snakeCase));
  return [
    ...new Set(
      namedChildren(parameters)
        .flatMap((parameter) => {
          const name = pythonParameterName(parameter);
          return name ? [snakeCase(name)] : [];
        })
        .filter((name) => !ignored.has(name)),
    ),
  ].sort();
}

function pythonParameterName(parameter: SgNode): string | undefined {
  if (parameter.kind() === "identifier") return parameter.text();
  const name = parameter.field("name") ?? parameter.field("pattern");
  if (name) return name.find({ rule: { kind: "identifier" } })?.text() ?? name.text();
  return parameter.find({ rule: { kind: "identifier" } })?.text();
}

async function goStructFields(file: string, structName: string): Promise<string[]> {
  return (await goStructFieldSpellings(file, structName)).map(snakeCase).sort();
}

async function goStructFieldSpellings(file: string, structName: string): Promise<string[]> {
  const source = await readFile(new URL(file, goSource), "utf8");
  const body = source.match(
    new RegExp(`^type ${structName} struct \\{\\n([\\s\\S]*?)^\\}`, "mu"),
  )?.[1];
  if (body === undefined) throw new Error(`${structName} was not found in ${file}`);
  return body
    .split("\n")
    .flatMap((line) => line.match(/^\s*([A-Z][A-Za-z0-9_]*)\s+/u)?.[1] ?? [])
    .sort();
}

function languageSection(source: string, language: string): string {
  const start = source.indexOf(`<Tab title="${language}">`);
  if (start < 0) throw new Error(`Missing ${language} tab`);
  const next = source.indexOf("<Tab title=", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

function headingSection(source: string, heading: string): string {
  const start = source.indexOf(`## ${heading}()`);
  if (start < 0) throw new Error(`Missing ${heading}() heading`);
  const next = source.indexOf("\n## ", start + 1);
  return source.slice(start, next < 0 ? source.length : next);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function snakeCase(value: string): string {
  let normalized = value;
  for (const acronym of ["HTTPS", "HTTP", "CDP", "API", "URL", "LLM", "MCP", "MIME", "ID"]) {
    normalized = normalized.replaceAll(acronym, `_${acronym.toLowerCase()}_`);
  }
  return normalized
    .replace(/([a-z\d])([A-Z])/gu, "$1_$2")
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1_$2")
    .replace(/[-_]+/gu, "_")
    .replace(/^_|_$/gu, "")
    .toLowerCase();
}

function namedChildren(node: SgNode): SgNode[] {
  return node.children().filter((child) => child.isNamed());
}
