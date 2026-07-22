import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import python from "@ast-grep/lang-python";
import { Lang, parse, registerDynamicLanguage, type SgNode } from "@ast-grep/napi";
import { createProcessor } from "@mdx-js/mdx";
import { describe, expect, it } from "vite-plus/test";

registerDynamicLanguage({ python });

type Language = "Python" | "TypeScript";

type MdxAttribute = {
  name?: string;
  type?: string;
  value?: unknown;
};

type MdxNode = {
  attributes?: MdxAttribute[];
  children?: MdxNode[];
  depth?: number;
  name?: string;
  type?: string;
  value?: string;
};

type ReferencePage = {
  classSlug: string;
  filePath: string;
  views: ReferenceView[];
};

type ReferenceView = {
  methods: ReferenceMethod[];
  title?: string;
};

type ReferenceMethod = {
  methodName: string;
  methodSlug: string;
  paramFields: DocumentedField[];
  paramPaths: Array<string | undefined>;
  responseFields: DocumentedField[];
  responseNames: Array<string | undefined>;
};

type DocumentedField = {
  key?: string;
  optional: boolean;
  type?: string;
};

type ProjectedField = {
  key: string;
  optional: boolean;
  schema: JsonSchema;
};

type SchemaField = {
  path: string[];
  required: boolean;
  schema: JsonSchema;
};

type SdkMethod = {
  classSlug: string;
  localInputPaths: string[];
  methodName: string;
  methodSlug: string;
  operationName?: string;
  parameters: string[];
  parameterTypes: Record<string, string>;
  returnType?: string;
};

type JsonSchema = {
  $ref?: string;
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  required?: string[];
  type?: string | string[];
};

type ProtocolDocument = JsonSchema & {
  $defs: Record<string, JsonSchema>;
  properties: {
    methods: {
      properties: Record<
        string,
        {
          properties: {
            params: JsonSchema;
            result: JsonSchema;
          };
        }
      >;
    };
  };
};

type SdkObject = {
  className: string;
  classSlug: string;
  pythonFile: string;
  typescriptFile: string;
};

const DOCS_ROOT = fileURLToPath(new URL("..", import.meta.url));
const REFERENCE_ROOT = resolve(DOCS_ROOT, "reference");
const TYPESCRIPT_ROOT = fileURLToPath(new URL("../../sdk-ts/src", import.meta.url));
const PYTHON_ROOT = fileURLToPath(new URL("../../sdk-python/src/stagehand", import.meta.url));
const PROTOCOL_SCHEMA = fileURLToPath(new URL("../../protocol/stagehand.v4.json", import.meta.url));
const PROTOCOL_REGISTRY = fileURLToPath(
  new URL("../../protocol/schema-registry.ts", import.meta.url),
);
const LANGUAGES = ["TypeScript", "Python"] as const satisfies readonly Language[];

const SDK_OBJECTS = [
  {
    className: "Stagehand",
    classSlug: "stagehand",
    typescriptFile: "stagehand.ts",
    pythonFile: "stagehand.py",
  },
  {
    className: "BrowserContext",
    classSlug: "context",
    typescriptFile: "browserContext.ts",
    pythonFile: "browser_context.py",
  },
  {
    className: "BrowserClipboard",
    classSlug: "clipboard",
    typescriptFile: "browserClipboard.ts",
    pythonFile: "browser_clipboard.py",
  },
  {
    className: "Page",
    classSlug: "page",
    typescriptFile: "page.ts",
    pythonFile: "page.py",
  },
  {
    className: "Locator",
    classSlug: "locator",
    typescriptFile: "locator.ts",
    pythonFile: "locator.py",
  },
] as const satisfies readonly SdkObject[];

describe("SDK reference surface", () => {
  it("keeps every public callable in sync across TypeScript, Python, and reference pages", async () => {
    const [typescriptMethods, pythonMethods, referencePages] = await Promise.all([
      readTypescriptMethods(),
      readPythonMethods(),
      readReferencePages(),
    ]);

    const expected = methodKeys(typescriptMethods);
    expect(
      methodKeys(pythonMethods),
      "Python public callables must match the TypeScript SDK surface",
    ).toStrictEqual(expected);
    expect(
      operationBindings(pythonMethods),
      "Equivalent TypeScript and Python callables must bind the same protocol operation",
    ).toStrictEqual(operationBindings(typescriptMethods));
    for (const language of LANGUAGES) {
      expect(
        documentedMethods(referencePages, language)
          .map(({ classSlug, method }) => `${classSlug}/${method.methodSlug}`)
          .sort(),
        `${language} method headings must match the public SDK surface`,
      ).toStrictEqual(expected);
    }
  });

  it("has exactly one reference page for every documented SDK object", async () => {
    const pageSlugs = (await readReferencePages()).map(({ classSlug }) => classSlug).sort();

    expect(pageSlugs, "Add one reference/<object>.mdx page for every SDK object").toStrictEqual(
      SDK_OBJECTS.map(({ classSlug }) => classSlug).sort(),
    );
  });

  it("uses the exact language-specific public method names as headings", async () => {
    const [typescriptMethods, pythonMethods, referencePages] = await Promise.all([
      readTypescriptMethods(),
      readPythonMethods(),
      readReferencePages(),
    ]);
    const differences: string[] = [];

    for (const [language, methods] of [
      ["TypeScript", typescriptMethods],
      ["Python", pythonMethods],
    ] as const satisfies ReadonlyArray<readonly [Language, SdkMethod[]]>) {
      const documented = documentedMethods(referencePages, language)
        .map(({ classSlug, method }) => `${classSlug}/${method.methodSlug}:${method.methodName}`)
        .sort();
      const expected = methods.map((method) => `${methodKey(method)}:${method.methodName}`).sort();
      if (!arraysEqual(documented, expected)) {
        differences.push(
          `${language}: expected [${expected.join(", ")}], received [${documented.join(", ")}]`,
        );
      }
    }

    expect(
      differences,
      "Use each language's exact public method name in its consolidated page View",
    ).toEqual([]);
  });

  it("uses exactly one TypeScript View and one Python View on every reference page", async () => {
    const invalidPages = (await readReferencePages()).flatMap((page) => {
      const titles = page.views.map(({ title }) => title ?? "<missing title>").sort();
      return arraysEqual(titles, [...LANGUAGES].sort())
        ? []
        : [`${page.filePath}: ${titles.join(", ")}`];
    });

    expect(
      invalidPages,
      "Each reference page must contain exactly the two native SDK Views",
    ).toEqual([]);
  });

  it("documents the exact direct signature parameters inside each language View", async () => {
    const [typescriptMethods, pythonMethods, referencePages] = await Promise.all([
      readTypescriptMethods(),
      readPythonMethods(),
      readReferencePages(),
    ]);
    const differences: string[] = [];

    for (const [language, methods] of [
      ["TypeScript", typescriptMethods],
      ["Python", pythonMethods],
    ] as const satisfies ReadonlyArray<readonly [Language, SdkMethod[]]>) {
      const documentedByMethod = documentedMethodMap(referencePages, language);
      for (const method of methods) {
        const reference = documentedByMethod.get(methodKey(method));
        if (!reference) continue;

        const missingPathAttributes = reference.method.paramPaths.filter(
          (path) => path === undefined,
        ).length;
        if (missingPathAttributes > 0) {
          differences.push(
            `${reference.filePath} ${language} ${method.methodName}: ${missingPathAttributes} ParamField(s) need a string path`,
          );
        }

        // Nested fields such as `options.timeout` are checked separately against the schema.
        // This assertion makes the top-level, directly callable signature an exact match.
        const documented = reference.method.paramPaths
          .filter((path): path is string => path !== undefined && !path.includes("."))
          .sort();
        const expected = [...method.parameters].sort();
        if (!arraysEqual(documented, expected)) {
          differences.push(
            `${reference.filePath} ${language} ${method.methodName}: expected [${expected.join(", ")}], received [${documented.join(", ")}]`,
          );
        }
      }
    }

    expect(
      differences,
      "ParamField paths must exactly match each language's direct method signature",
    ).toEqual([]);
  });

  it("documents every nested public protocol input field", async () => {
    const [typescriptMethods, pythonMethods, referencePages, protocol] = await Promise.all([
      readTypescriptMethods(),
      readPythonMethods(),
      readReferencePages(),
      readProtocolDocument(),
    ]);
    const differences: string[] = [];

    for (const [language, methods] of [
      ["TypeScript", typescriptMethods],
      ["Python", pythonMethods],
    ] as const satisfies ReadonlyArray<readonly [Language, SdkMethod[]]>) {
      const documentedByMethod = documentedMethodMap(referencePages, language);
      for (const method of methods) {
        if (!method.operationName) continue;
        const operation = protocol.properties.methods.properties[method.operationName];
        if (!operation) {
          throw new Error(`${methodKey(method)} binds unknown operation ${method.operationName}`);
        }

        const reference = documentedByMethod.get(methodKey(method));
        if (!reference) continue;
        const documented = reference.method.paramPaths
          .filter((path): path is string => path !== undefined && path.includes("."))
          .sort();
        const expected = projectedInputPaths(
          method,
          language,
          operation.properties.params,
          protocol,
        ).sort();
        if (!arraysEqual(documented, expected)) {
          differences.push(
            `${reference.filePath} ${language} ${method.methodName}: expected [${expected.join(", ")}], received [${documented.join(", ")}]`,
          );
        }
      }
    }

    expect(
      differences,
      "Nested ParamFields must exactly match the public protocol-schema projection",
    ).toEqual([]);
  });

  it("uses language-correct types and optionality for nested protocol input fields", async () => {
    const [typescriptMethods, pythonMethods, referencePages, protocol] = await Promise.all([
      readTypescriptMethods(),
      readPythonMethods(),
      readReferencePages(),
      readProtocolDocument(),
    ]);
    const differences: string[] = [];

    for (const [language, methods] of [
      ["TypeScript", typescriptMethods],
      ["Python", pythonMethods],
    ] as const satisfies ReadonlyArray<readonly [Language, SdkMethod[]]>) {
      const documentedByMethod = documentedMethodMap(referencePages, language);
      for (const method of methods) {
        if (!method.operationName) continue;
        const operation = protocol.properties.methods.properties[method.operationName];
        const reference = documentedByMethod.get(methodKey(method));
        if (!operation || !reference) continue;
        const documented = new Map(reference.method.paramFields.map((field) => [field.key, field]));
        for (const field of projectedInputFields(
          method,
          language,
          operation.properties.params,
          protocol,
        )) {
          const actual = documented.get(field.key);
          if (!actual) continue;
          const expectedType = canonicalSchemaType(field.schema, language, protocol);
          if (actual.type !== expectedType || actual.optional !== field.optional) {
            differences.push(
              `${methodKey(method)} ${language} ${field.key}: expected type=${expectedType} optional=${field.optional}, received type=${actual.type ?? "<missing>"} optional=${actual.optional}`,
            );
          }
        }
      }
    }

    expect(
      differences,
      "Nested protocol ParamFields must use canonical language types and schema optionality",
    ).toEqual([]);
  });

  it("documents flattened model options with the protocol ModelConfig type", async () => {
    const [typescriptMethods, pythonMethods, referencePages, protocol] = await Promise.all([
      readTypescriptMethods(),
      readPythonMethods(),
      readReferencePages(),
      readProtocolDocument(),
    ]);
    const differences: string[] = [];

    for (const [language, methods] of [
      ["TypeScript", typescriptMethods],
      ["Python", pythonMethods],
    ] as const satisfies ReadonlyArray<readonly [Language, SdkMethod[]]>) {
      const documentedByMethod = documentedMethodMap(referencePages, language);
      for (const method of methods) {
        if (!method.operationName || !method.parameters.includes("model")) continue;
        const operation = protocol.properties.methods.properties[method.operationName];
        const reference = documentedByMethod.get(methodKey(method));
        if (!operation || !reference) continue;

        const optionsSchema = resolvedProperties(operation.properties.params, protocol).options;
        const modelSchema = optionsSchema
          ? resolvedProperties(optionsSchema, protocol).model
          : undefined;
        if (!modelSchema?.$ref) continue;

        const actual = reference.method.paramFields.find(({ key }) => key === "model")?.type;
        const expected = canonicalSchemaType(modelSchema, language, protocol);
        if (actual !== expected) {
          differences.push(
            `${methodKey(method)} ${language} model: expected ${expected}, received ${actual ?? "<missing>"}`,
          );
        }
      }
    }

    expect(
      differences,
      "Flattened model parameters in MDX must retain the protocol's ModelConfig type",
    ).toEqual([]);
  });

  it("documents one public response root inside every method View", async () => {
    const invalidViews = (await readReferencePages()).flatMap((page) =>
      page.views.flatMap((view) =>
        view.methods.flatMap((method) =>
          method.responseNames.filter((name) => name === "result").length === 1
            ? []
            : [
                `${page.filePath} ${view.title ?? "<missing title>"} ${method.methodName}: expected one ResponseField named result`,
              ],
        ),
      ),
    );

    expect(
      invalidViews,
      "Each SDK method View must contain exactly one top-level ResponseField named result",
    ).toEqual([]);
  });

  it("documents every nested public SDK result field", async () => {
    const [typescriptMethods, pythonMethods, referencePages, protocol] = await Promise.all([
      readTypescriptMethods(),
      readPythonMethods(),
      readReferencePages(),
      readProtocolDocument(),
    ]);
    const differences: string[] = [];

    for (const [language, methods] of [
      ["TypeScript", typescriptMethods],
      ["Python", pythonMethods],
    ] as const satisfies ReadonlyArray<readonly [Language, SdkMethod[]]>) {
      const documentedByMethod = documentedMethodMap(referencePages, language);
      for (const method of methods) {
        if (!method.operationName) continue;
        const reference = documentedByMethod.get(methodKey(method));
        if (!reference) continue;
        const documented = reference.method.responseNames
          .filter((name): name is string => name !== undefined && name !== "result")
          .sort();
        const expected = projectedResultPaths(method, language, protocol).sort();
        if (!arraysEqual(documented, expected)) {
          differences.push(
            `${reference.filePath} ${language} ${method.methodName}: expected [${expected.join(", ")}], received [${documented.join(", ")}]`,
          );
        }
      }
    }

    expect(
      differences,
      "Nested ResponseFields must exactly match the public SDK result-model projection",
    ).toEqual([]);
  });

  it("uses language-correct types and optionality for nested public result fields", async () => {
    const [typescriptMethods, pythonMethods, referencePages, protocol] = await Promise.all([
      readTypescriptMethods(),
      readPythonMethods(),
      readReferencePages(),
      readProtocolDocument(),
    ]);
    const differences: string[] = [];

    for (const [language, methods] of [
      ["TypeScript", typescriptMethods],
      ["Python", pythonMethods],
    ] as const satisfies ReadonlyArray<readonly [Language, SdkMethod[]]>) {
      const documentedByMethod = documentedMethodMap(referencePages, language);
      for (const method of methods) {
        if (!method.operationName) continue;
        const reference = documentedByMethod.get(methodKey(method));
        if (!reference) continue;
        const documented = new Map(
          reference.method.responseFields.map((field) => [field.key, field]),
        );
        for (const field of projectedResultFields(method, language, protocol)) {
          const actual = documented.get(field.key);
          if (!actual) continue;
          const expectedType = canonicalSchemaType(field.schema, language, protocol);
          if (actual.type !== expectedType || actual.optional !== field.optional) {
            differences.push(
              `${methodKey(method)} ${language} ${field.key}: expected type=${expectedType} optional=${field.optional}, received type=${actual.type ?? "<missing>"} optional=${actual.optional}`,
            );
          }
        }
      }
    }

    expect(
      differences,
      "Nested ResponseFields must use canonical language types and schema optionality",
    ).toEqual([]);
  });
});

describe("Mintlify customization boundary", () => {
  it("includes every MDX content page in docs.json navigation", async () => {
    const docsConfig = JSON.parse(
      await readFile(resolve(DOCS_ROOT, "docs.json"), "utf8"),
    ) as unknown;
    const navigatedPages = [...collectNavigationPages(docsConfig)].sort();
    const contentPages = (await listFiles(DOCS_ROOT, shouldInspectDocsDirectory))
      .filter((filePath) => extname(filePath) === ".mdx")
      .map((filePath) =>
        relative(DOCS_ROOT, filePath)
          .split(sep)
          .join("/")
          .replace(/\.mdx$/u, ""),
      )
      .sort();

    expect(navigatedPages, "Every MDX content page must be reachable from docs.json").toStrictEqual(
      contentPages,
    );
  });

  it("uses no custom presentation code", async () => {
    const customPresentationFiles = (await listFiles(DOCS_ROOT, shouldInspectDocsDirectory))
      .map((filePath) => relative(DOCS_ROOT, filePath).split(sep).join("/"))
      .filter(
        (filePath) =>
          !filePath.startsWith("tests/") &&
          [".css", ".js", ".jsx", ".tsx"].includes(extname(filePath)),
      )
      .sort();

    expect(
      customPresentationFiles,
      "Mintlify should use native components without custom CSS, JavaScript, JSX, or TSX",
    ).toStrictEqual([]);
  });
});

async function readTypescriptMethods(): Promise<SdkMethod[]> {
  const registry = await readRegistryMethodNames();
  const methods = await Promise.all(
    SDK_OBJECTS.map(async ({ className, classSlug, typescriptFile }) => {
      const filePath = resolve(TYPESCRIPT_ROOT, typescriptFile);
      const root = parse(Lang.TypeScript, await readFile(filePath, "utf8")).root();
      const classNode = findClass(root, "class_declaration", className, filePath);
      const classBody = classNode.field("body");
      if (!classBody) throw new Error(`${className} has no class body in ${filePath}`);

      return namedChildren(classBody)
        .filter((node) => node.kind() === "method_definition")
        .flatMap((method): SdkMethod[] => {
          const nameNode = method.field("name");
          const methodName = nameNode?.text();
          const access = namedChildren(method).find(
            (child) => child.kind() === "accessibility_modifier",
          );
          const isAccessor = method
            .children()
            .some((child) => child.kind() === "get" || child.kind() === "set");
          if (
            !methodName ||
            methodName === "constructor" ||
            nameNode?.kind() === "private_property_identifier" ||
            access?.text() === "private" ||
            access?.text() === "protected" ||
            isAccessor
          ) {
            return [];
          }

          return [
            sdkMethod(
              classSlug,
              methodName,
              readParameterNames(method, typescriptParameterName, filePath),
              extractOperationName(method, "TypeScript", registry, filePath),
              method.field("return_type")?.text().replace(/^:\s*/u, ""),
              readParameterTypes(method, typescriptParameterName),
              localTypescriptInputPaths(method, root),
            ),
          ];
        });
    }),
  );

  return deduplicateMethods(methods.flat(), "TypeScript");
}

async function readRegistryMethodNames(): Promise<Map<string, string>> {
  const root = parse(Lang.TypeScript, await readFile(PROTOCOL_REGISTRY, "utf8")).root();
  const declaration = root.find({ rule: { pattern: "const StagehandMethods = $METHODS" } });
  const registry = declaration?.getMatch("METHODS")?.find({ rule: { kind: "object" } });
  if (!registry) throw new Error("Could not find the StagehandMethods registry");

  return new Map(
    namedChildren(registry).flatMap((entry) => {
      if (entry.kind() !== "pair") return [];
      const [key, value] = namedChildren(entry);
      const nameProperty =
        value &&
        namedChildren(value).find(
          (property) => property.kind() === "pair" && namedChildren(property)[0]?.text() === "name",
        );
      const wireName = nameProperty && namedChildren(nameProperty)[1];
      return key && wireName ? [[key.text(), stringLiteral(wireName)] as const] : [];
    }),
  );
}

function extractOperationName(
  method: SgNode,
  language: Language,
  registry: ReadonlyMap<string, string> | undefined,
  filePath: string,
): string | undefined {
  const callKind = language === "TypeScript" ? "call_expression" : "call";
  const operations = method.findAll({ rule: { kind: callKind } }).flatMap((call): string[] => {
    const calledFunction = namedChildren(call)[0]?.text();
    if (!calledFunction?.endsWith(".send") && !calledFunction?.endsWith("?.send")) return [];
    const methodNode = callArguments(call)[0];
    if (!methodNode) return [];
    if (language === "Python") {
      return methodNode.kind() === "string" ? [stringLiteral(methodNode)] : [];
    }
    const registryKey = methodNode.text().replace(/^StagehandMethods\./u, "");
    const wireName = registry?.get(registryKey);
    if (!wireName) {
      throw new Error(`${filePath} references unknown StagehandMethods.${registryKey}`);
    }
    return [wireName];
  });
  const unique = [...new Set(operations)];
  if (unique.length > 1) {
    throw new Error(`${filePath} public method binds multiple operations: ${unique.join(", ")}`);
  }
  return unique[0];
}

function callArguments(call: SgNode): SgNode[] {
  const argumentsNode =
    call.field("arguments") ??
    namedChildren(call).find(
      (child) => child.kind() === "arguments" || child.kind() === "argument_list",
    );
  return argumentsNode ? namedChildren(argumentsNode) : [];
}

async function readPythonMethods(): Promise<SdkMethod[]> {
  const methods = await Promise.all(
    SDK_OBJECTS.map(async ({ className, classSlug, pythonFile }) => {
      const filePath = resolve(PYTHON_ROOT, pythonFile);
      const root = parse("python", await readFile(filePath, "utf8")).root();
      const classNode = findClass(root, "class_definition", className, filePath);
      const classBody = classNode.field("body");
      if (!classBody) throw new Error(`${className} has no class body in ${filePath}`);

      return namedChildren(classBody).flatMap((member): SdkMethod[] => {
        const decorators =
          member.kind() === "decorated_definition"
            ? namedChildren(member).filter((child) => child.kind() === "decorator")
            : [];
        const method =
          member.kind() === "decorated_definition" ? member.field("definition") : member;
        if (!method || method.kind() !== "function_definition") return [];

        const methodName = method.field("name")?.text();
        const excludedDecorator = decorators.some((decorator) => {
          const decoratorName = decorator.text().slice(1).split("(", 1)[0]?.split(".").at(-1);
          return decoratorName === "overload" || decoratorName === "property";
        });
        if (!methodName || methodName.startsWith("_") || excludedDecorator) return [];

        return [
          sdkMethod(
            classSlug,
            methodName,
            readParameterNames(method, pythonParameterName, filePath).filter(
              (parameter) => parameter !== "self" && parameter !== "cls",
            ),
            extractOperationName(method, "Python", undefined, filePath),
            method.field("return_type")?.text(),
            readParameterTypes(method, pythonParameterName),
          ),
        ];
      });
    }),
  );

  return deduplicateMethods(methods.flat(), "Python");
}

function findClass(
  root: SgNode,
  kind: "class_declaration" | "class_definition",
  className: string,
  filePath: string,
): SgNode {
  const classNode = root
    .findAll({ rule: { kind } })
    .find((candidate) => candidate.field("name")?.text() === className);
  if (!classNode) throw new Error(`Could not find ${className} in ${filePath}`);
  return classNode;
}

function readParameterNames(
  method: SgNode,
  nameOf: (parameter: SgNode) => string | undefined,
  filePath: string,
): string[] {
  const parameters = method.field("parameters");
  if (!parameters) throw new Error(`Method has no parameter list in ${filePath}: ${method.text()}`);

  return namedChildren(parameters).flatMap((parameter) => {
    const name = nameOf(parameter);
    if (name) return [name];
    if (parameter.kind() === "keyword_separator" || parameter.kind() === "positional_separator") {
      return [];
    }
    throw new Error(
      `Unsupported public method parameter in ${filePath}: ${parameter.text()} (${parameter.kind()})`,
    );
  });
}

function readParameterTypes(
  method: SgNode,
  nameOf: (parameter: SgNode) => string | undefined,
): Record<string, string> {
  const parameters = method.field("parameters");
  if (!parameters) return {};
  return Object.fromEntries(
    namedChildren(parameters).flatMap((parameter) => {
      const name = nameOf(parameter);
      const type = parameter.field("type")?.text().replace(/^:\s*/u, "");
      return name && type ? [[name, type]] : [];
    }),
  );
}

function typescriptParameterName(parameter: SgNode): string | undefined {
  const pattern = parameter.field("pattern") ?? parameter.field("name");
  if (pattern?.kind() === "identifier") return pattern.text();
  if (parameter.kind() === "identifier") return parameter.text();
  return undefined;
}

function pythonParameterName(parameter: SgNode): string | undefined {
  if (parameter.kind() === "identifier") return parameter.text();
  const namedParameter = parameter.field("name") ?? parameter.field("pattern");
  if (namedParameter) return firstIdentifier(namedParameter)?.text();

  const type = parameter.field("type");
  const value = parameter.field("value");
  return namedChildren(parameter)
    .filter(
      (child) =>
        child.range().start.index !== type?.range().start.index &&
        child.range().start.index !== value?.range().start.index,
    )
    .map(firstIdentifier)
    .find((identifier) => identifier !== undefined)
    ?.text();
}

function firstIdentifier(node: SgNode): SgNode | undefined {
  if (node.kind() === "identifier") return node;
  return node.find({ rule: { kind: "identifier" } }) ?? undefined;
}

function localTypescriptInputPaths(method: SgNode, module: SgNode): string[] {
  const aliases = new Map(
    module.findAll({ rule: { kind: "type_alias_declaration" } }).flatMap((alias) => {
      const name = alias.field("name")?.text();
      const value = alias.field("value");
      return name && value ? [[name, value] as const] : [];
    }),
  );
  const parameters = method.field("parameters");
  if (!parameters) return [];

  const paths = namedChildren(parameters).flatMap((parameter): string[] => {
    const name = typescriptParameterName(parameter);
    const type = parameter.field("type");
    if (!name || !type) return [];
    const referencedAliases = type
      .findAll({ rule: { kind: "type_identifier" } })
      .map((identifier) => identifier.text())
      .filter((identifier) => aliases.has(identifier));
    return referencedAliases.flatMap((alias) =>
      localTypePropertyPaths(alias, aliases).map((path) => `${name}.${path.join(".")}`),
    );
  });
  return [...new Set(paths)].sort();
}

function localTypePropertyPaths(
  aliasName: string,
  aliases: ReadonlyMap<string, SgNode>,
  seen = new Set<string>(),
): string[][] {
  if (seen.has(aliasName)) return [];
  const value = aliases.get(aliasName);
  if (!value) return [];
  const nextSeen = new Set([...seen, aliasName]);
  const directProperties = value
    .findAll({ rule: { kind: "property_signature" } })
    .flatMap((property): string[][] => {
      const name = property.field("name")?.text();
      return name ? [[name]] : [];
    });
  const inheritedProperties = value
    .findAll({ rule: { kind: "type_identifier" } })
    .map((identifier) => identifier.text())
    .filter((identifier) => aliases.has(identifier))
    .flatMap((identifier) => localTypePropertyPaths(identifier, aliases, nextSeen));
  return uniquePaths([...directProperties, ...inheritedProperties]);
}

function sdkMethod(
  classSlug: string,
  methodName: string,
  parameters: string[],
  operationName?: string,
  returnType?: string,
  parameterTypes: Record<string, string> = {},
  localInputPaths: string[] = [],
): SdkMethod {
  const normalizedName = snakeCase(methodName);
  return {
    classSlug,
    localInputPaths,
    methodName,
    methodSlug: normalizedName.replaceAll("_", "-"),
    operationName,
    parameters,
    parameterTypes,
    returnType,
  };
}

function deduplicateMethods(methods: SdkMethod[], language: Language): SdkMethod[] {
  const unique = new Map<string, SdkMethod>();
  for (const method of methods) {
    const key = methodKey(method);
    const existing = unique.get(key);
    if (existing && !arraysEqual(existing.parameters, method.parameters)) {
      throw new Error(
        `${language} defines ${key} more than once with different parameters; exclude overload declarations structurally`,
      );
    }
    unique.set(key, existing ?? method);
  }
  return [...unique.values()];
}

async function readReferencePages(): Promise<ReferencePage[]> {
  const classSlugs = new Set<string>(SDK_OBJECTS.map(({ classSlug }) => classSlug));
  return Promise.all(
    (await listFiles(REFERENCE_ROOT))
      .filter((filePath) => extname(filePath) === ".mdx")
      .map(async (filePath): Promise<ReferencePage> => {
        const pathParts = relative(REFERENCE_ROOT, filePath).split(sep);
        if (pathParts.length !== 1) {
          throw new Error(`Reference pages must use one reference/<object>.mdx file: ${filePath}`);
        }
        const [fileName] = pathParts;
        const classSlug = fileName?.replace(/\.mdx$/u, "");
        if (!classSlug || !classSlugs.has(classSlug)) {
          throw new Error(`Unknown SDK reference class path: ${filePath}`);
        }

        const tree = createProcessor({ format: "mdx" }).parse(
          await readFile(filePath, "utf8"),
        ) as MdxNode;
        const views = findElements(tree, "View").map((view): ReferenceView => {
          return {
            title: stringAttribute(view, "title"),
            methods: readReferenceMethods(view, filePath),
          };
        });

        return {
          classSlug,
          filePath: relative(DOCS_ROOT, filePath).split(sep).join("/"),
          views,
        };
      }),
  );
}

function readReferenceMethods(view: MdxNode, filePath: string): ReferenceMethod[] {
  const children = view.children ?? [];
  return children.flatMap((child, index): ReferenceMethod[] => {
    if (child.type !== "heading" || child.depth !== 2) return [];
    const heading = mdxText(child).trim();
    if (heading === "Quick start") return [];
    const methodName = heading.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\(\)$/u)?.[1];
    if (!methodName) {
      throw new Error(
        `${filePath} View headings must be "Quick start" or an exact method name ending in (): ${heading}`,
      );
    }

    const nextHeading = children.findIndex(
      (candidate, candidateIndex) =>
        candidateIndex > index && candidate.type === "heading" && (candidate.depth ?? 0) <= 2,
    );
    const section = {
      children: children.slice(index + 1, nextHeading < 0 ? undefined : nextHeading),
    } satisfies MdxNode;
    const paramFields = findElements(section, "ParamField").map(
      (field): DocumentedField => ({
        key: stringAttribute(field, "path"),
        optional: hasAttribute(field, "optional"),
        type: stringAttribute(field, "type"),
      }),
    );
    const responseFields = findElements(section, "ResponseField").map(
      (field): DocumentedField => ({
        key: stringAttribute(field, "name"),
        optional: hasAttribute(field, "optional"),
        type: stringAttribute(field, "type"),
      }),
    );
    return [
      {
        methodName,
        methodSlug: snakeCase(methodName).replaceAll("_", "-"),
        paramFields,
        paramPaths: paramFields.map(({ key }) => key),
        responseFields,
        responseNames: responseFields.map(({ key }) => key),
      },
    ];
  });
}

async function listFiles(
  directory: string,
  inspectDirectory: (name: string) => boolean = () => true,
): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (isMissingDirectoryError(error)) return [];
    throw error;
  }

  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        return inspectDirectory(entry.name) ? listFiles(entryPath, inspectDirectory) : [];
      }
      return [entryPath];
    }),
  );
  return files.flat();
}

function shouldInspectDocsDirectory(name: string): boolean {
  return name !== "node_modules" && name !== ".mintlify";
}

function findElements(node: MdxNode, name: string): MdxNode[] {
  const matches = node.name === name ? [node] : [];
  return matches.concat(node.children?.flatMap((child) => findElements(child, name)) ?? []);
}

function mdxText(node: MdxNode): string {
  return `${node.value ?? ""}${node.children?.map(mdxText).join("") ?? ""}`;
}

function stringAttribute(node: MdxNode, name: string): string | undefined {
  const value = node.attributes?.find(
    (attribute) => attribute.type === "mdxJsxAttribute" && attribute.name === name,
  )?.value;
  return typeof value === "string" ? value : undefined;
}

function hasAttribute(node: MdxNode, name: string): boolean {
  return node.attributes?.some((attribute) => attribute.name === name) ?? false;
}

function methodKeys(methods: SdkMethod[]): string[] {
  return methods.map(methodKey).sort();
}

function methodKey({ classSlug, methodSlug }: SdkMethod): string {
  return `${classSlug}/${methodSlug}`;
}

type DocumentedMethodLocation = {
  classSlug: string;
  filePath: string;
  method: ReferenceMethod;
};

function documentedMethods(pages: ReferencePage[], language: Language): DocumentedMethodLocation[] {
  return pages.flatMap((page) =>
    page.views
      .filter(({ title }) => title === language)
      .flatMap(({ methods }) =>
        methods.map((method) => ({
          classSlug: page.classSlug,
          filePath: page.filePath,
          method,
        })),
      ),
  );
}

function documentedMethodMap(
  pages: ReferencePage[],
  language: Language,
): Map<string, DocumentedMethodLocation> {
  return new Map(
    documentedMethods(pages, language).map((location) => [
      `${location.classSlug}/${location.method.methodSlug}`,
      location,
    ]),
  );
}

function operationBindings(methods: SdkMethod[]): string[] {
  return methods
    .map((method) => `${methodKey(method)}:${method.operationName ?? "<client-only>"}`)
    .sort();
}

async function readProtocolDocument(): Promise<ProtocolDocument> {
  return JSON.parse(await readFile(PROTOCOL_SCHEMA, "utf8")) as ProtocolDocument;
}

function projectedInputPaths(
  method: SdkMethod,
  language: Language,
  schema: JsonSchema,
  protocol: ProtocolDocument,
): string[] {
  const parameters = new Map(method.parameters.map((name) => [snakeCase(name), name]));
  const schemaPaths = schemaPropertyPaths(schema, protocol);
  const projected = schemaPaths.flatMap((wirePath): string[] => {
    const matchedIndex = wirePath.findIndex((segment) => parameters.has(snakeCase(segment)));
    if (matchedIndex < 0) return [];
    const parameter = parameters.get(snakeCase(wirePath[matchedIndex] as string));
    if (!parameter) return [];
    const path = [
      parameter,
      ...wirePath.slice(matchedIndex + 1).map((segment) => publicFieldName(segment, language)),
    ];
    return path.length > 1 ? [path.join(".")] : [];
  });
  const schemaDefinition = schema.$ref?.match(/^#\/\$defs\/(.+)$/u)?.[1];
  const wrappedParams = schemaDefinition
    ? Object.entries(method.parameterTypes).flatMap(([parameter, type]) =>
        type.trim() === schemaDefinition
          ? schemaPaths.map(
              (path) =>
                `${parameter}.${path.map((segment) => publicFieldName(segment, language)).join(".")}`,
            )
          : [],
      )
    : [];
  return [...new Set([...projected, ...wrappedParams, ...method.localInputPaths])]
    .filter((path) => path.includes("."))
    .sort();
}

function projectedInputFields(
  method: SdkMethod,
  language: Language,
  schema: JsonSchema,
  protocol: ProtocolDocument,
): ProjectedField[] {
  const parameters = new Map(method.parameters.map((name) => [snakeCase(name), name]));
  const fields = schemaFields(schema, protocol);
  const projected = fields.flatMap((field): ProjectedField[] => {
    const matchedIndex = field.path.findIndex((segment) => parameters.has(snakeCase(segment)));
    if (matchedIndex < 0) return [];
    const parameter = parameters.get(snakeCase(field.path[matchedIndex] as string));
    if (!parameter) return [];
    const path = [
      parameter,
      ...field.path.slice(matchedIndex + 1).map((segment) => publicFieldName(segment, language)),
    ];
    return path.length > 1
      ? [{ key: path.join("."), optional: !field.required, schema: field.schema }]
      : [];
  });
  const schemaDefinition = schema.$ref?.match(/^#\/\$defs\/(.+)$/u)?.[1];
  const wrapped = schemaDefinition
    ? Object.entries(method.parameterTypes).flatMap(([parameter, type]) =>
        type.trim() === schemaDefinition
          ? fields.map((field) => ({
              key: `${parameter}.${field.path
                .map((segment) => publicFieldName(segment, language))
                .join(".")}`,
              optional: !field.required,
              schema: field.schema,
            }))
          : [],
      )
    : [];
  return uniqueProjectedFields([...projected, ...wrapped]);
}

function projectedResultPaths(
  method: SdkMethod,
  language: Language,
  protocol: ProtocolDocument,
): string[] {
  return projectedResultFields(method, language, protocol).map(({ key }) => key);
}

function projectedResultFields(
  method: SdkMethod,
  language: Language,
  protocol: ProtocolDocument,
): ProjectedField[] {
  return uniqueProjectedFields(
    returnSchemas(method, protocol).flatMap((schema) =>
      schemaFields(schema, protocol).map((field) => ({
        key: `result.${field.path.map((segment) => publicFieldName(segment, language)).join(".")}`,
        optional: !field.required,
        schema: field.schema,
      })),
    ),
  );
}

function returnSchemas(method: SdkMethod, protocol: ProtocolDocument): JsonSchema[] {
  if (!method.returnType) return [];
  const indexedAccess = method.returnType.match(
    /\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\[\s*["']([^"']+)["']\s*\]/u,
  );
  const schemas: JsonSchema[] = [];
  if (indexedAccess) {
    const [, modelName, propertyName] = indexedAccess;
    const model = modelName ? protocol.$defs[modelName] : undefined;
    const property =
      model && propertyName ? resolvedProperties(model, protocol)[propertyName] : undefined;
    if (property) schemas.push(property);
  } else {
    const modelNames = method.returnType.match(/[A-Za-z_$][A-Za-z0-9_$]*/gu) ?? [];
    for (const modelName of modelNames) {
      const schema = protocol.$defs[modelName];
      if (schema && !schemas.includes(schema)) schemas.push(schema);
    }
  }

  return schemas;
}

function schemaFields(
  schema: JsonSchema,
  protocol: ProtocolDocument,
  prefix: string[] = [],
  seenReferences: ReadonlySet<string> = new Set(),
): SchemaField[] {
  if (schema.$ref) {
    if (seenReferences.has(schema.$ref)) return [];
    return schemaFields(
      resolveReference(schema.$ref, protocol),
      protocol,
      prefix,
      new Set([...seenReferences, schema.$ref]),
    );
  }
  const alternatives = [...(schema.allOf ?? []), ...(schema.anyOf ?? []), ...(schema.oneOf ?? [])];
  const alternativeFields = alternatives.flatMap((alternative) =>
    schemaFields(alternative, protocol, prefix, new Set(seenReferences)),
  );
  const itemFields = schema.items
    ? schemaFields(schema.items, protocol, prefix, new Set(seenReferences))
    : [];
  const required = new Set(schema.required ?? []);
  const propertyFields = Object.entries(schema.properties ?? {}).flatMap(([name, property]) => {
    const path = [...prefix, name];
    return [
      { path, required: required.has(name), schema: property },
      ...schemaFields(property, protocol, path, new Set(seenReferences)),
    ];
  });
  return uniqueSchemaFields([...alternativeFields, ...itemFields, ...propertyFields]);
}

function schemaPropertyPaths(
  schema: JsonSchema,
  protocol: ProtocolDocument,
  prefix: string[] = [],
  seenReferences: ReadonlySet<string> = new Set(),
): string[][] {
  if (schema.$ref) {
    if (seenReferences.has(schema.$ref)) return [];
    const referenced = resolveReference(schema.$ref, protocol);
    return schemaPropertyPaths(
      referenced,
      protocol,
      prefix,
      new Set([...seenReferences, schema.$ref]),
    );
  }

  const alternatives = [...(schema.allOf ?? []), ...(schema.anyOf ?? []), ...(schema.oneOf ?? [])];
  const alternativePaths = alternatives.flatMap((alternative) =>
    schemaPropertyPaths(alternative, protocol, prefix, new Set(seenReferences)),
  );
  const itemPaths = schema.items
    ? schemaPropertyPaths(schema.items, protocol, prefix, new Set(seenReferences))
    : [];
  const propertyPaths = Object.entries(schema.properties ?? {}).flatMap(([name, property]) => {
    const propertyPath = [...prefix, name];
    return [
      propertyPath,
      ...schemaPropertyPaths(property, protocol, propertyPath, new Set(seenReferences)),
    ];
  });
  return uniquePaths([...alternativePaths, ...itemPaths, ...propertyPaths]);
}

function resolvedProperties(
  schema: JsonSchema,
  protocol: ProtocolDocument,
): Record<string, JsonSchema> {
  if (schema.$ref) return resolvedProperties(resolveReference(schema.$ref, protocol), protocol);
  return schema.properties ?? {};
}

function resolveReference(reference: string, protocol: ProtocolDocument): JsonSchema {
  const definitionName = reference.match(/^#\/\$defs\/(.+)$/u)?.[1];
  const definition = definitionName ? protocol.$defs[definitionName] : undefined;
  if (!definition) throw new Error(`Unsupported JSON Schema reference: ${reference}`);
  return definition;
}

function uniquePaths(paths: string[][]): string[][] {
  return [...new Map(paths.map((path) => [path.join("."), path])).values()];
}

function uniqueSchemaFields(fields: SchemaField[]): SchemaField[] {
  const unique = new Map<string, SchemaField>();
  for (const field of fields) {
    const key = field.path.join(".");
    const existing = unique.get(key);
    unique.set(
      key,
      existing ? { ...existing, required: existing.required && field.required } : field,
    );
  }
  return [...unique.values()];
}

function uniqueProjectedFields(fields: ProjectedField[]): ProjectedField[] {
  const unique = new Map<string, ProjectedField>();
  for (const field of fields) {
    const existing = unique.get(field.key);
    unique.set(
      field.key,
      existing ? { ...existing, optional: existing.optional || field.optional } : field,
    );
  }
  return [...unique.values()].sort((left, right) => left.key.localeCompare(right.key));
}

function canonicalSchemaType(
  schema: JsonSchema,
  language: Language,
  protocol: ProtocolDocument,
): string {
  if (schema.$ref) {
    const name = schema.$ref.match(/^#\/\$defs\/(.+)$/u)?.[1];
    if (!name || !protocol.$defs[name]) {
      throw new Error(`Unsupported JSON Schema reference: ${schema.$ref}`);
    }
    return name;
  }

  const alternatives = [...(schema.anyOf ?? []), ...(schema.oneOf ?? [])];
  if (alternatives.length > 0) {
    return [
      ...new Set(
        alternatives.map((alternative) => canonicalSchemaType(alternative, language, protocol)),
      ),
    ].join(" | ");
  }
  if (schema.allOf?.length) {
    return [
      ...new Set(schema.allOf.map((part) => canonicalSchemaType(part, language, protocol))),
    ].join(" & ");
  }

  const type = Array.isArray(schema.type) ? schema.type : schema.type ? [schema.type] : [];
  if (type.length > 1) {
    return type.map((item) => canonicalPrimitiveType(item, language)).join(" | ");
  }
  if (type[0] === "array") {
    const itemType = schema.items
      ? canonicalSchemaType(schema.items, language, protocol)
      : language === "TypeScript"
        ? "unknown"
        : "object";
    return language === "TypeScript" ? `${itemType}[]` : `list[${itemType}]`;
  }
  if (type[0]) return canonicalPrimitiveType(type[0], language);
  if (schema.properties) return language === "TypeScript" ? "object" : "dict[str, object]";
  return language === "TypeScript" ? "unknown" : "object";
}

function canonicalPrimitiveType(type: string, language: Language): string {
  if (language === "TypeScript") {
    if (type === "integer" || type === "number") return "number";
    if (type === "null") return "null";
    if (type === "object") return "object";
    if (type === "array") return "unknown[]";
    return type;
  }
  if (type === "integer") return "int";
  if (type === "number") return "float";
  if (type === "boolean") return "bool";
  if (type === "string") return "str";
  if (type === "null") return "None";
  if (type === "object") return "dict[str, object]";
  if (type === "array") return "list[object]";
  return "object";
}

function publicFieldName(wireName: string, language: Language): string {
  if (language === "Python") return wireName;
  return wireName.replace(/_([a-z\d])/gu, (_, character: string) => character.toUpperCase());
}

function collectNavigationPages(value: unknown, pages = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectNavigationPages(item, pages);
    return pages;
  }
  if (!value || typeof value !== "object") return pages;
  for (const [key, child] of Object.entries(value)) {
    if (key === "root" && typeof child === "string") pages.add(child);
    if (key === "pages" && Array.isArray(child)) {
      for (const item of child) {
        if (typeof item === "string") pages.add(item);
        else collectNavigationPages(item, pages);
      }
      continue;
    }
    collectNavigationPages(child, pages);
  }
  return pages;
}

function snakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1_$2")
    .replace(/([a-z\d])([A-Z])/gu, "$1_$2")
    .toLowerCase();
}

function namedChildren(node: SgNode): SgNode[] {
  return node.children().filter((child) => child.isNamed());
}

function stringLiteral(node: SgNode): string {
  const text = node.text();
  const quote = text[0];
  if ((quote !== '"' && quote !== "'") || text.at(-1) !== quote) {
    throw new Error(`Expected a string literal, received ${text}`);
  }
  return text.slice(1, -1);
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function isMissingDirectoryError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
