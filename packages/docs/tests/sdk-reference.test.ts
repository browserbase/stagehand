import { readdir, readFile } from "node:fs/promises";
import { extname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import python from "@ast-grep/lang-python";
import { Lang, parse, registerDynamicLanguage, type SgNode } from "@ast-grep/napi";
import { createProcessor } from "@mdx-js/mdx";
import { describe, expect, it } from "vitest";

registerDynamicLanguage({ python });

type Language = "Go" | "Python" | "TypeScript";

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
  views: ReferenceTab[];
};

type ReferenceTab = {
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
  localInputFields: PublicInputField[];
  methodName: string;
  methodSlug: string;
  operationName?: string;
  parameters: string[];
  parameterTypes: Record<string, string>;
  returnType?: string;
};

type PublicInputField = {
  complete: boolean;
  key: string;
  optional: boolean;
  type: string;
};

type ResponseReferenceMember = {
  isProperty: boolean;
  name: string;
  parameters: string[];
  returnType: string;
};

type JsonSchema = {
  $ref?: string;
  additionalProperties?: boolean | JsonSchema;
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  default?: unknown;
  enum?: unknown[];
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
  goClassName: string;
  pythonFile: string;
  typescriptFile: string;
};

type GoParameter = {
  name: string;
  type: string;
};

type GoFunctionDeclaration = {
  name: string;
  parameters: GoParameter[];
  receiverType?: string;
  returnType: string;
};

const DOCS_ROOT = fileURLToPath(new URL("..", import.meta.url));
const V4_DOCS_ROOT = resolve(DOCS_ROOT, "v4");
const REFERENCE_ROOT = resolve(V4_DOCS_ROOT, "reference");
const TYPESCRIPT_ROOT = fileURLToPath(new URL("../../sdk-ts/src", import.meta.url));
const PYTHON_ROOT = fileURLToPath(new URL("../../sdk-python/src/stagehand", import.meta.url));
const GO_ROOT = fileURLToPath(new URL("../../sdk-go", import.meta.url));
const PROTOCOL_SCHEMA = fileURLToPath(new URL("../../protocol/stagehand.v4.json", import.meta.url));
const PROTOCOL_SCHEMA_SOURCE = fileURLToPath(new URL("../../protocol/schemas.ts", import.meta.url));
const PROTOCOL_REGISTRY = fileURLToPath(
  new URL("../../protocol/schema-registry.ts", import.meta.url),
);
const LANGUAGES = ["TypeScript", "Python", "Go"] as const satisfies readonly Language[];
// Language tabs are the selector; every other <Tab> on a page is a different axis
// (model provider, output shape, ...).
const LANGUAGE_TAB_TITLES = new Set<string>(LANGUAGES);
const STAGEHAND_LIFECYCLE_METHODS = new Set(["create", "create-with-client-for-test", "init"]);
// Cross-language concept references are validated as MDX content, not as one-to-one SDK objects.
const SUPPLEMENTAL_REFERENCE_PAGES = new Set(["response", "webmcp"]);

// Handwritten SDK wrappers intentionally expose narrower or friendlier types than the wire
// schema. Keep these exceptions explicit so the reference is checked against the public API.
const PUBLIC_REFERENCE_FIELD_TYPES = new Map<string, string>([
  ["context.add_cookies:TypeScript:cookies.sameSite", "CookieParam['sameSite']"],
  ["context.add_cookies:Python:cookies.same_site", "Literal['Strict', 'Lax', 'None']"],
  ["context.cookies:TypeScript:result.sameSite", "Cookie['sameSite']"],
  ["context.cookies:Python:result.same_site", "Literal['Strict', 'Lax', 'None']"],
  ["page.wait_for_selector:TypeScript:options.state", "PageWaitForSelectorOptions['state']"],
  ["page.screenshot:TypeScript:options.animations", "ScreenshotOptions['animations']"],
  ["page.screenshot:TypeScript:options.caret", "ScreenshotOptions['caret']"],
  ["page.screenshot:TypeScript:options.mask", "Locator[]"],
  ["page.screenshot:TypeScript:options.scale", "ScreenshotOptions['scale']"],
  ["page.screenshot:TypeScript:options.type", "ScreenshotOptions['type']"],
]);

const SDK_OBJECTS = [
  {
    className: "Stagehand",
    classSlug: "stagehand",
    goClassName: "Stagehand",
    typescriptFile: "stagehand.ts",
    pythonFile: "stagehand.py",
  },
  {
    className: "BrowserContext",
    classSlug: "context",
    goClassName: "BrowserContext",
    typescriptFile: "browserContext.ts",
    pythonFile: "browser_context.py",
  },
  {
    className: "BrowserClipboard",
    classSlug: "clipboard",
    goClassName: "BrowserClipboard",
    typescriptFile: "browserClipboard.ts",
    pythonFile: "browser_clipboard.py",
  },
  {
    className: "Page",
    classSlug: "page",
    goClassName: "Page",
    typescriptFile: "page.ts",
    pythonFile: "page.py",
  },
  {
    className: "Locator",
    classSlug: "locator",
    goClassName: "PageLocator",
    typescriptFile: "locator.ts",
    pythonFile: "locator.py",
  },
] as const satisfies readonly SdkObject[];

const TYPESCRIPT_FIELD_SPELLINGS = uniqueSpellingsByWireName(
  await readTypescriptPublicFieldNames(),
);

describe("SDK reference surface", () => {
  it("keeps every public callable in sync across TypeScript, Python, Go, and reference pages", async () => {
    const [typescriptMethods, pythonMethods, goMethods, referencePages] = await Promise.all([
      readTypescriptMethods(),
      readPythonMethods(),
      readGoMethods(),
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
    expect(
      methodKeys(sharedSurfaceMethods(goMethods, expected)),
      "Go public callables must cover the shared SDK surface",
    ).toStrictEqual(expected);
    for (const language of LANGUAGES) {
      expect(
        documentedMethods(referencePages, language)
          .map(({ classSlug, method }) => `${classSlug}/${method.methodSlug}`)
          .sort(),
        `${language} method headings must match the public SDK surface`,
      ).toStrictEqual(expected);
    }
  }, 30_000);

  it("has exactly one reference page for every documented SDK object", async () => {
    const pageSlugs = (await readReferencePages()).map(({ classSlug }) => classSlug).sort();

    expect(pageSlugs, "Add one reference/<object>.mdx page for every SDK object").toStrictEqual(
      SDK_OBJECTS.map(({ classSlug }) => classSlug).sort(),
    );
  });

  it("keeps the supplemental Response reference in sync with its public SDK surfaces", async () => {
    const pagePath = resolve(REFERENCE_ROOT, "response.mdx");
    const tree = createProcessor({ format: "mdx" }).parse(
      await readFile(pagePath, "utf8"),
    ) as MdxNode;
    const views = new Map(
      findLanguageTabs(tree).map((view) => [stringAttribute(view, "title"), view]),
    );
    const [typescriptMembers, pythonMembers, goMembers] = await Promise.all([
      readTypescriptResponseMembers(),
      readPythonResponseMembers(),
      readGoResponseMembers(),
    ]);

    for (const [language, expected] of [
      ["TypeScript", typescriptMembers],
      ["Python", pythonMembers],
      ["Go", goMembers],
    ] as const satisfies ReadonlyArray<readonly [Language, ResponseReferenceMember[]]>) {
      const view = views.get(language);
      expect(view, `response.mdx must contain one ${language} tab`).toBeDefined();
      expect(
        responseMemberSignatures(readDocumentedResponseMembers(view as MdxNode, language)),
        `response.mdx ${language} signatures must match the public Response surface`,
      ).toStrictEqual(responseMemberSignatures(expected));
    }
  });

  it("explicitly classifies every supplemental reference page", async () => {
    const referenceSlugs = (await listFiles(REFERENCE_ROOT, () => false))
      .filter((filePath) => extname(filePath) === ".mdx")
      .map((filePath) => filePath.slice(0, -extname(filePath).length).split(sep).at(-1) as string);
    const sdkSlugs = new Set(SDK_OBJECTS.map(({ classSlug }) => classSlug));
    const supplemental = referenceSlugs.filter((slug) => !sdkSlugs.has(slug)).sort();

    expect(
      supplemental,
      "Every non-SDK-object reference page must be explicitly classified as supplemental",
    ).toStrictEqual([...SUPPLEMENTAL_REFERENCE_PAGES].sort());
  });

  it("uses public TypeScript names for documented field types", async () => {
    const [referencePages, publicExports] = await Promise.all([
      readReferencePages(),
      readTypescriptRootExports(),
    ]);
    const allowed = new Set([
      "Arg",
      "Array",
      "ArrayBuffer",
      "Awaited",
      "Buffer",
      "Error",
      "EvaluateResult",
      "Input",
      "InferOutput",
      "Map",
      "Promise",
      "R",
      "Record",
      "RegExp",
      "Result",
      "Schema",
      "Uint8Array",
    ]);
    const missing = referencePages.flatMap((page) =>
      page.views
        .filter(({ title }) => title === "TypeScript")
        .flatMap(({ methods }) => methods)
        .flatMap(({ paramFields, responseFields }) => [...paramFields, ...responseFields])
        .flatMap(
          ({ type }) =>
            type?.replace(/(['"])[\s\S]*?\1/gu, "").match(/\b[A-Z][A-Za-z0-9_$]*\b/gu) ?? [],
        )
        .filter((name) => !allowed.has(name) && !publicExports.has(name))
        .map((name) => `${page.filePath}: ${name}`),
    );

    expect(
      [...new Set(missing)].sort(),
      "Named TypeScript field types must be exported from @browserbasehq/stagehand",
    ).toEqual([]);
  });

  it("documents the accepted values for shared closed-value types", async () => {
    const cases = [
      ["page", "TypeScript", '"load"', '"domcontentloaded"', '"networkidle"'],
      ["page", "Python", '"load"', '"domcontentloaded"', '"networkidle"'],
      ["page", "Go", "LoadStateLoad", "LoadStateDOMContentLoaded", "LoadStateNetworkIdle"],
      ["locator", "TypeScript", '"left"', '"middle"', '"right"'],
      ["locator", "Python", '"left"', '"middle"', '"right"'],
      ["locator", "Go", "MouseButtonLeft", "MouseButtonMiddle", "MouseButtonRight"],
      ["page", "TypeScript", '"attached"', '"detached"', '"visible"', '"hidden"'],
      ["page", "Python", '"attached"', '"detached"', '"visible"', '"hidden"'],
      [
        "page",
        "Go",
        "PageWaitForSelectorOptionsStateAttached",
        "PageWaitForSelectorOptionsStateDetached",
        "PageWaitForSelectorOptionsStateVisible",
        "PageWaitForSelectorOptionsStateHidden",
      ],
      [
        "page",
        "TypeScript",
        '"disabled"',
        '"allow"',
        '"hide"',
        '"initial"',
        '"css"',
        '"device"',
        '"png"',
        '"jpeg"',
      ],
      [
        "page",
        "Python",
        '"disabled"',
        '"allow"',
        '"hide"',
        '"initial"',
        '"css"',
        '"device"',
        '"png"',
        '"jpeg"',
      ],
      [
        "page",
        "Go",
        "PageScreenshotOptionsAnimationsDisabled",
        "PageScreenshotOptionsAnimationsAllow",
        "PageScreenshotOptionsCaretHide",
        "PageScreenshotOptionsCaretInitial",
        "PageScreenshotOptionsScaleCSS",
        "PageScreenshotOptionsScaleDevice",
        "PageScreenshotOptionsTypePNG",
        "PageScreenshotOptionsTypeJPEG",
      ],
      ["context", "TypeScript", '"Strict"', '"Lax"', '"None"'],
      ["context", "Python", '"Strict"', '"Lax"', '"None"'],
      [
        "context",
        "Go",
        "CookieParamSameSiteStrict",
        "CookieParamSameSiteLax",
        "CookieParamSameSiteNone",
      ],
      ["stagehand", "TypeScript", '"HIT"', '"MISS"', '"DISABLED"'],
      ["stagehand", "Python", '"HIT"', '"MISS"', '"DISABLED"'],
      ["stagehand", "Go", "CacheStatusHIT", "CacheStatusMISS", "CacheStatusDISABLED"],
      ["webmcp", "TypeScript", '"Completed"', '"Canceled"', '"Error"'],
      ["webmcp", "Python", '"Completed"', '"Canceled"', '"Error"'],
      [
        "webmcp",
        "Go",
        "WebMCPInvocationStatusCompleted",
        "WebMCPInvocationStatusCanceled",
        "WebMCPInvocationStatusError",
      ],
    ] as const;
    const problems: string[] = [];
    for (const [slug, language, ...values] of cases) {
      const content = await readFile(resolve(REFERENCE_ROOT, `${slug}.mdx`), "utf8");
      const tab = languageTabSource(content, language);
      const missing = values.filter((value) => !tab.includes(value));
      if (missing.length > 0) problems.push(`${slug} ${language}: ${missing.join(", ")}`);
    }

    expect(problems, "Every supported value must appear in its owning language tab").toEqual([]);
  });

  it("resolves every internal v4 reference link and anchor", async () => {
    const contentPages = (await listFiles(V4_DOCS_ROOT, shouldInspectDocsDirectory)).filter(
      (filePath) => extname(filePath) === ".mdx",
    );
    const anchors = new Map<string, Set<string>>();
    for (const filePath of await listFiles(REFERENCE_ROOT, () => false)) {
      if (extname(filePath) !== ".mdx") continue;
      const slug = relative(DOCS_ROOT, filePath)
        .split(sep)
        .join("/")
        .replace(/\.mdx$/u, "");
      const content = await readFile(filePath, "utf8");
      anchors.set(
        slug,
        new Set(
          [...content.matchAll(/^#{1,6}\s+(.+)$/gmu)].map((match) =>
            referenceAnchor(match[1] as string),
          ),
        ),
      );
    }
    const problems: string[] = [];
    for (const filePath of contentPages) {
      const content = await readFile(filePath, "utf8");
      for (const match of content.matchAll(
        /(?:href=["']|\]\()\/((?:v4\/reference\/)[A-Za-z0-9_-]+)(#[A-Za-z0-9_-]+)?/gu,
      )) {
        const target = match[1] as string;
        const anchor = match[2]?.slice(1);
        if (!anchors.has(target)) problems.push(`${relative(DOCS_ROOT, filePath)}: /${target}`);
        else if (anchor && !anchors.get(target)?.has(anchor)) {
          problems.push(`${relative(DOCS_ROOT, filePath)}: /${target}#${anchor}`);
        }
      }
    }

    expect(problems, "Internal v4 reference links must resolve to a page and heading").toEqual([]);
  });

  it("documents callable helper members as methods and metadata as properties", async () => {
    const webmcpPath = resolve(REFERENCE_ROOT, "webmcp.mdx");
    const pagePath = resolve(REFERENCE_ROOT, "page.mdx");
    const [webmcpDocs, pageDocs, typescriptSource, pythonSource, goSource] = await Promise.all([
      readFile(webmcpPath, "utf8"),
      readFile(pagePath, "utf8"),
      readFile(resolve(TYPESCRIPT_ROOT, "webmcp.ts"), "utf8"),
      readFile(resolve(PYTHON_ROOT, "webmcp.py"), "utf8"),
      readFile(resolve(GO_ROOT, "webmcp.go"), "utf8"),
    ]);
    const surfaces = new Map<Language, ResponseReferenceMember[]>([
      [
        "TypeScript",
        ["WebMCPTool", "WebMCPInvocation"].flatMap((className) =>
          readTypescriptHelperMembers(typescriptSource, className),
        ),
      ],
      [
        "Python",
        ["WebMCPTool", "WebMCPInvocation"].flatMap((className) =>
          readPythonClassMembers(pythonSource, className, webmcpPath),
        ),
      ],
      [
        "Go",
        parseGoFunctions(goSource)
          .filter(
            ({ name, receiverType }) =>
              /^[A-Z]/u.test(name) &&
              (receiverType === "WebMCPTool" || receiverType === "WebMCPInvocation"),
          )
          .map(({ name, parameters, returnType }) => ({
            isProperty: false,
            name,
            parameters: parameters.map(({ name: parameter }) => parameter),
            returnType,
          })),
      ],
    ]);
    const problems: string[] = [];
    for (const [language, members] of surfaces) {
      const tab = languageTabSource(webmcpDocs, language);
      for (const member of members) {
        const propertyRow = `| \`${member.name}\` |`;
        const methodHeading = `### ${member.name}()`;
        if (member.isProperty && !tab.includes(propertyRow)) {
          problems.push(`${language}: missing property ${member.name}`);
        }
        if (!member.isProperty && !tab.includes(methodHeading)) {
          problems.push(`${language}: missing method ${member.name}()`);
        }
        if (!member.isProperty && tab.includes(propertyRow)) {
          problems.push(`${language}: method ${member.name}() is documented as a property`);
        }
      }
      const expectedMethods = responseMemberSignatures(
        members.filter(({ isProperty }) => !isProperty),
      );
      const documentedMethods = responseMemberSignatures(
        readDocumentedHelperMethods(tab, language).filter(({ isProperty }) => !isProperty),
      );
      if (!arraysEqual(documentedMethods, expectedMethods)) {
        problems.push(
          `${language}: expected method signatures [${expectedMethods.join(", ")}], received [${documentedMethods.join(", ")}]`,
        );
      }
    }

    const cdpMembers = new Map<Language, ResponseReferenceMember[]>([
      [
        "TypeScript",
        readTypescriptHelperMembers(
          await readFile(resolve(TYPESCRIPT_ROOT, "page.ts"), "utf8"),
          "CDPSubscription",
        ),
      ],
      [
        "Python",
        readPythonClassMembers(
          await readFile(resolve(PYTHON_ROOT, "page.py"), "utf8"),
          "CDPSubscription",
          pagePath,
        ),
      ],
      [
        "Go",
        parseGoFunctions(await readFile(resolve(GO_ROOT, "page.go"), "utf8"))
          .filter(
            ({ name, receiverType }) => receiverType === "CDPSubscription" && /^[A-Z]/u.test(name),
          )
          .map(({ name, parameters, returnType }) => ({
            isProperty: false,
            name,
            parameters: parameters.map(({ name: parameter }) => parameter),
            returnType,
          })),
      ],
    ]);
    for (const [language, members] of cdpMembers) {
      const tab = languageTabSource(pageDocs, language);
      for (const member of members) {
        if (!tab.includes(`${member.name}(`)) {
          problems.push(`${language}: missing CDPSubscription.${member.name}()`);
        }
      }
    }

    expect(problems, "Helper reference members must match their public SDK member kind").toEqual(
      [],
    );
  });

  it("uses the exact language-specific public method names as headings", async () => {
    const [typescriptMethods, pythonMethods, goMethods, referencePages] = await Promise.all([
      readTypescriptMethods(),
      readPythonMethods(),
      readGoMethods(),
      readReferencePages(),
    ]);
    const differences: string[] = [];

    for (const [language, methods] of [
      ["TypeScript", typescriptMethods],
      ["Python", pythonMethods],
      ["Go", sharedSurfaceMethods(goMethods, methodKeys(typescriptMethods))],
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
      "Use each language's exact public method name in its consolidated page tab",
    ).toEqual([]);
  });

  it("uses exactly one tab per SDK language on every reference page", async () => {
    const invalidPages = (await readReferencePages()).flatMap((page) => {
      const titles = page.views.map(({ title }) => title ?? "<missing title>").sort();
      return arraysEqual(titles, [...LANGUAGES].sort())
        ? []
        : [`${page.filePath}: ${titles.join(", ")}`];
    });

    expect(
      invalidPages,
      "Each reference page must contain exactly one TypeScript, Python, and Go tab",
    ).toEqual([]);
  });

  it("documents the exact direct signature parameters inside each language tab", async () => {
    const [typescriptMethods, pythonMethods, goMethods, referencePages] = await Promise.all([
      readTypescriptMethods(),
      readPythonMethods(),
      readGoMethods(),
      readReferencePages(),
    ]);
    const differences: string[] = [];

    for (const [language, methods] of [
      ["TypeScript", typescriptMethods],
      ["Python", pythonMethods],
      ["Go", goMethods],
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

  it("uses the public SDK type for every direct documented parameter", async () => {
    const [typescriptMethods, pythonMethods, referencePages, protocol, pythonAliases] =
      await Promise.all([
        readTypescriptMethods(),
        readPythonMethods(),
        readReferencePages(),
        readProtocolDocument(),
        readPythonTypeAliases(),
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
        const documented = new Map(
          reference.method.paramFields
            .filter(({ key }) => key !== undefined && !key.includes("."))
            .map((field) => [field.key as string, field]),
        );

        for (const parameter of method.parameters) {
          const field = documented.get(parameter);
          const sdkType = method.parameterTypes[parameter];
          if (!field || !sdkType) continue;
          const actual = normalizePublicType(field.type, language, field.optional, pythonAliases);
          const expected = publicTypeCandidates(
            sdkType,
            language,
            field.optional,
            protocol,
            pythonAliases,
            method,
          );
          if (!expected.has(actual)) {
            differences.push(
              `${methodKey(method)} ${language} ${parameter}: expected one of [${[...expected].join(", ")}], received ${actual || "<missing>"}`,
            );
          }
        }
      }
    }

    expect(
      differences,
      "Top-level ParamField types must match their public SDK parameter annotations",
    ).toEqual([]);
  });

  it("uses the exact Go SDK type for every direct documented parameter", async () => {
    // TypeScript and Python parameter types are checked against the protocol
    // schema projection. Go's option structs are generated from that same
    // protocol, so the declared signature type is itself canonical and the
    // documented type must reproduce it verbatim.
    const [goMethods, referencePages] = await Promise.all([readGoMethods(), readReferencePages()]);
    const differences: string[] = [];

    const documentedByMethod = documentedMethodMap(referencePages, "Go");
    for (const method of goMethods) {
      const reference = documentedByMethod.get(methodKey(method));
      if (!reference) continue;
      const documented = new Map(
        reference.method.paramFields
          .filter(({ key }) => key !== undefined && !key.includes("."))
          .map((field) => [field.key as string, field]),
      );
      for (const parameter of method.parameters) {
        const field = documented.get(parameter);
        const expected = method.parameterTypes[parameter];
        if (!field || !expected) continue;
        const actual = field.type?.replace(/\s+/gu, " ").trim() ?? "";
        if (actual !== expected) {
          differences.push(
            `${methodKey(method)} Go ${parameter}: expected ${expected}, received ${actual || "<missing>"}`,
          );
        }
      }
    }

    expect(differences, "Go ParamField types must match the declared Go signature types").toEqual(
      [],
    );
  });

  it("documents every exported field of each Go parameter struct", async () => {
    // Nested TypeScript and Python fields are checked against the protocol
    // projection. Go parameter structs declare the same surface directly, so
    // the documented nested paths and types must match the struct fields
    // verbatim. Handle and union types export no fields, so recursion stops
    // at them, and parameters of such types are skipped entirely.
    const [goMethods, referencePages, goStructs] = await Promise.all([
      readGoMethods(),
      readReferencePages(),
      readGoStructs(),
    ]);
    const differences: string[] = [];

    const documentedByMethod = documentedMethodMap(referencePages, "Go");
    for (const method of goMethods) {
      const reference = documentedByMethod.get(methodKey(method));
      if (!reference) continue;
      for (const parameter of method.parameters) {
        const expected = new Map(
          exportedGoFieldPaths(parameter, method.parameterTypes[parameter] ?? "", goStructs).map(
            ({ key, type }) => [key, type],
          ),
        );
        if (expected.size === 0) continue;
        const documented = new Map(
          reference.method.paramFields
            .filter(({ key }) => key !== undefined && key.startsWith(`${parameter}.`))
            .map((field) => [field.key as string, field.type ?? "<missing>"]),
        );
        for (const [key, type] of expected) {
          const actual = documented.get(key);
          if (actual === undefined) {
            differences.push(`${methodKey(method)} Go ${key}: missing ParamField of type ${type}`);
          } else if (actual !== type) {
            differences.push(
              `${methodKey(method)} Go ${key}: expected type ${type}, received ${actual}`,
            );
          }
        }
        for (const key of documented.keys()) {
          if (!expected.has(key)) {
            differences.push(
              `${methodKey(method)} Go ${key}: documents a field the Go SDK does not declare`,
            );
          }
        }
      }
    }

    expect(
      differences,
      "Nested Go ParamFields must exactly match the exported Go struct fields",
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
          const expectedType =
            publicReferenceFieldType(method, language, field.key) ??
            (language === "TypeScript" &&
            method.operationName === "stagehand.callback_batch" &&
            field.key === "options.page"
              ? "Page"
              : canonicalSchemaType(field.schema, language, protocol));
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

  it("documents public wrapper inputs rather than internal wire shapes", async () => {
    const [typescriptMethods, pythonMethods, referencePages, protocol, pythonAliases] =
      await Promise.all([
        readTypescriptMethods(),
        readPythonMethods(),
        readReferencePages(),
        readProtocolDocument(),
        readPythonTypeAliases(),
      ]);
    const differences: string[] = [];

    const typescriptDocumented = documentedMethodMap(referencePages, "TypeScript");
    for (const method of typescriptMethods) {
      const publicFields = method.localInputFields.filter(({ complete }) => complete);
      if (publicFields.length === 0) continue;
      const reference = typescriptDocumented.get(methodKey(method));
      if (!reference) continue;
      const documented = new Map(
        reference.method.paramFields
          .filter(({ key }) => key !== undefined)
          .map((field) => [field.key as string, field]),
      );
      const localRoots = new Set(publicFields.map(({ key }) => key.split(".", 1)[0] as string));
      const actualPaths = reference.method.paramPaths
        .filter(
          (path): path is string =>
            path !== undefined &&
            path.includes(".") &&
            localRoots.has(path.split(".", 1)[0] as string),
        )
        .sort();
      const expectedPaths = publicFields.map(({ key }) => key).sort();
      if (!arraysEqual(actualPaths, expectedPaths)) {
        differences.push(
          `${reference.filePath} TypeScript ${method.methodName}: expected public wrapper fields [${expectedPaths.join(", ")}], received [${actualPaths.join(", ")}]`,
        );
      }

      for (const field of publicFields) {
        const actual = documented.get(field.key);
        if (!actual) continue;
        const normalized = normalizePublicType(
          actual.type,
          "TypeScript",
          actual.optional,
          pythonAliases,
        );
        const expected = publicTypeCandidates(
          field.type,
          "TypeScript",
          field.optional,
          protocol,
          pythonAliases,
          method,
        );
        if (!expected.has(normalized)) {
          differences.push(
            `${methodKey(method)} TypeScript ${field.key}: expected one of [${[...expected].join(", ")}], received ${normalized || "<missing>"}`,
          );
        }
      }
    }

    const pythonDocumented = documentedMethodMap(referencePages, "Python");
    for (const method of pythonMethods) {
      const reference = pythonDocumented.get(methodKey(method));
      if (!reference) continue;
      const publicFields = method.localInputFields.filter(({ complete }) => complete);
      if (publicFields.length > 0) {
        const documented = new Map(
          reference.method.paramFields
            .filter(({ key }) => key !== undefined)
            .map((field) => [field.key as string, field]),
        );
        const localRoots = new Set(publicFields.map(({ key }) => key.split(".", 1)[0] as string));
        const actualPaths = reference.method.paramPaths
          .filter(
            (path): path is string =>
              path !== undefined &&
              path.includes(".") &&
              localRoots.has(path.split(".", 1)[0] as string),
          )
          .sort();
        const expectedPaths = publicFields.map(({ key }) => key).sort();
        if (!arraysEqual(actualPaths, expectedPaths)) {
          differences.push(
            `${reference.filePath} Python ${method.methodName}: expected public wrapper fields [${expectedPaths.join(", ")}], received [${actualPaths.join(", ")}]`,
          );
        }
        for (const field of publicFields) {
          const actual = documented.get(field.key);
          if (!actual) continue;
          const normalized = normalizePublicType(
            actual.type,
            "Python",
            actual.optional,
            pythonAliases,
          );
          const expected = publicTypeCandidates(
            field.type,
            "Python",
            field.optional,
            protocol,
            pythonAliases,
            method,
          );
          if (!expected.has(normalized)) {
            differences.push(
              `${methodKey(method)} Python ${field.key}: expected one of [${[...expected].join(", ")}], received ${normalized || "<missing>"}`,
            );
          }
        }
      }
      for (const [parameter, type] of Object.entries(method.parameterTypes)) {
        if (!isScalarPublicType(type, "Python")) continue;
        const nestedPaths = reference.method.paramPaths.filter(
          (path): path is string => path?.startsWith(`${parameter}.`) ?? false,
        );
        if (nestedPaths.length > 0) {
          differences.push(
            `${reference.filePath} Python ${method.methodName}.${parameter}: scalar public type ${type} must not expose wire fields [${nestedPaths.join(", ")}]`,
          );
        }
      }
    }

    expect(
      differences,
      "Reference inputs must describe values accepted by the public SDK wrappers, not serialized protocol objects",
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

  it("documents one public response root inside every method tab", async () => {
    const invalidTabs = (await readReferencePages()).flatMap((page) =>
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
      invalidTabs,
      "Each SDK method tab must contain exactly one top-level ResponseField named result",
    ).toEqual([]);
  });

  it("uses the public SDK return type for every documented result root", async () => {
    const [typescriptMethods, pythonMethods, referencePages, protocol, pythonAliases] =
      await Promise.all([
        readTypescriptMethods(),
        readPythonMethods(),
        readReferencePages(),
        readProtocolDocument(),
        readPythonTypeAliases(),
      ]);
    const differences: string[] = [];

    for (const [language, methods] of [
      ["TypeScript", typescriptMethods],
      ["Python", pythonMethods],
    ] as const satisfies ReadonlyArray<readonly [Language, SdkMethod[]]>) {
      const documentedByMethod = documentedMethodMap(referencePages, language);
      for (const method of methods) {
        const reference = documentedByMethod.get(methodKey(method));
        if (!reference || !method.returnType) continue;
        const result = reference.method.responseFields.find(({ key }) => key === "result");
        if (!result) continue;
        const actual = normalizePublicType(result.type, language, false, pythonAliases);
        // extract's implementation accepts either a schema or options so it can support both
        // public overloads; the documented return type reflects the schema-bearing overload.
        const returnType =
          language === "TypeScript" && method.operationName === "stagehand.extract"
            ? "Promise<ExtractResult<Schema>>"
            : method.returnType;
        const expected = publicTypeCandidates(
          returnType,
          language,
          false,
          protocol,
          pythonAliases,
          method,
        );
        if (!expected.has(actual)) {
          differences.push(
            `${methodKey(method)} ${language}: expected one of [${[...expected].join(", ")}], received ${actual || "<missing>"}`,
          );
        }
      }
    }

    expect(
      differences,
      "Top-level ResponseField result types must match public SDK return annotations",
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
          const expectedType =
            publicReferenceFieldType(method, language, field.key) ??
            (method.operationName === "stagehand.extract" && field.key === "result.data"
              ? language === "TypeScript"
                ? "StagehandSchemaOutput<Schema>"
                : "ResultModel"
              : canonicalSchemaType(field.schema, language, protocol));
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
  it("uses SDK-native field spellings inside each language tab", async () => {
    const [typescriptNames, pythonNames, contentPages] = await Promise.all([
      readTypescriptPublicFieldNames(),
      readPythonPublicFieldNames(),
      listFiles(V4_DOCS_ROOT, shouldInspectDocsDirectory),
    ]);
    const typescriptSpellings = uniqueSpellingsByWireName(typescriptNames);
    const pythonSpellings = uniqueSpellingsByWireName(pythonNames);
    const sharedNames = new Set(
      [...typescriptSpellings.keys()].filter(
        (wireName) =>
          wireName.includes("_") &&
          pythonSpellings.has(wireName) &&
          typescriptSpellings.get(wireName) !== pythonSpellings.get(wireName),
      ),
    );
    const differences: string[] = [];

    for (const filePath of contentPages.filter((path) => extname(path) === ".mdx")) {
      const tree = createProcessor({ format: "mdx" }).parse(
        await readFile(filePath, "utf8"),
      ) as MdxNode;
      const pagePath = relative(DOCS_ROOT, filePath).split(sep).join("/");
      for (const view of findLanguageTabs(tree)) {
        const language = stringAttribute(view, "title");
        if (language !== "TypeScript" && language !== "Python") continue;
        const spellings = language === "TypeScript" ? typescriptSpellings : pythonSpellings;
        const invalid = new Set<string>();
        for (const value of mdxSpellingValues(view)) {
          if (value.includes("TypeScript") && value.includes("Python")) continue;
          for (const token of value.match(/[A-Za-z_][A-Za-z0-9_]*/gu) ?? []) {
            const wireName = snakeCase(token);
            const expected = spellings.get(wireName);
            if (sharedNames.has(wireName) && expected && token !== expected) {
              invalid.add(`${token} -> ${expected}`);
            }
          }
        }
        if (invalid.size > 0) {
          differences.push(`${pagePath} ${language}: ${[...invalid].sort().join(", ")}`);
        }
      }
    }

    expect(
      differences,
      "Language-scoped documentation must use field names derived from that SDK's public source",
    ).toEqual([]);
  });

  it("includes every indexed MDX content page in docs.json navigation", async () => {
    const docsConfig = JSON.parse(
      await readFile(resolve(DOCS_ROOT, "docs.json"), "utf8"),
    ) as unknown;
    const navigatedPages = [...collectNavigationPages(docsConfig)]
      .filter((page) => page.startsWith("v4/"))
      .sort();
    const contentFiles = (await listFiles(V4_DOCS_ROOT, shouldInspectDocsDirectory)).filter(
      (filePath) => extname(filePath) === ".mdx",
    );
    const indexedContentPages = (
      await Promise.all(
        contentFiles.map(async (filePath) => ({
          indexed: !hasNoIndexFrontmatter(await readFile(filePath, "utf8")),
          page: relative(DOCS_ROOT, filePath)
            .split(sep)
            .join("/")
            .replace(/\.mdx$/u, ""),
        })),
      )
    )
      .filter(({ indexed }) => indexed)
      .map(({ page }) => page)
      .sort();

    expect(
      navigatedPages,
      "Every indexed MDX content page must be reachable from docs.json",
    ).toStrictEqual(indexedContentPages);
  });

  it("gives every language tab group the same complete language set", async () => {
    const contentPages = (await listFiles(V4_DOCS_ROOT, shouldInspectDocsDirectory)).filter(
      (filePath) => extname(filePath) === ".mdx",
    );
    const problems = (
      await Promise.all(
        contentPages.map(async (filePath) => {
          const tree = createProcessor({ format: "mdx" }).parse(
            await readFile(filePath, "utf8"),
          ) as MdxNode;
          const views = findLanguageTabs(tree).map((view) => ({
            title: stringAttribute(view, "title"),
            icon: stringAttribute(view, "icon"),
          }));
          const pagePath = relative(DOCS_ROOT, filePath).split(sep).join("/");
          const found: string[] = [];

          const titled = views.filter(
            (view): view is { title: string; icon: string | undefined } => view.title !== undefined,
          );
          if (titled.length !== views.length) {
            found.push(`${pagePath}: a language tab is missing a title`);
          }
          if (titled.length === 0) return found;

          // Every language present on the page must appear the same number of times
          const counts = new Map<string, number>();
          for (const { title } of titled) {
            counts.set(title, (counts.get(title) ?? 0) + 1);
          }
          const missing = LANGUAGES.filter((language) => !counts.has(language));
          if (missing.length > 0) {
            found.push(`${pagePath}: missing ${missing.join(", ")} snippets`);
          }
          const tallies = [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
          const expected = Math.max(...counts.values());
          const short = tallies.filter(([, count]) => count !== expected);
          if (short.length > 0) {
            found.push(
              `${pagePath}: uneven language tab groups (${tallies
                .map(([title, count]) => `${title} x${count}`)
                .join(", ")})`,
            );
          }

          // One icon per title, so the selector labels stay stable.
          const icons = new Map<string, Set<string>>();
          for (const { title, icon } of titled) {
            if (icon === undefined) continue;
            if (!icons.has(title)) icons.set(title, new Set());
            icons.get(title)?.add(icon);
          }
          for (const [title, set] of icons) {
            if (set.size > 1) {
              found.push(`${pagePath}: ${title} uses more than one icon (${[...set].join(", ")})`);
            }
          }

          // Two adjacent language tabs sharing a title means a malformed group.
          for (let index = 1; index < titled.length; index += 1) {
            if (titled[index].title === titled[index - 1].title) {
              found.push(
                `${pagePath}: two adjacent language tabs both titled ${titled[index].title}`,
              );
              break;
            }
          }

          return found;
        }),
      )
    ).flat();

    expect(
      problems,
      "Every language tab group must offer the same languages, so switching never hides a snippet",
    ).toEqual([]);
  });

  it("never mixes language tabs with other tabs in one group", async () => {
    const contentPages = (await listFiles(V4_DOCS_ROOT, shouldInspectDocsDirectory)).filter(
      (filePath) => extname(filePath) === ".mdx",
    );
    const problems = (
      await Promise.all(
        contentPages.map(async (filePath) => {
          const tree = createProcessor({ format: "mdx" }).parse(
            await readFile(filePath, "utf8"),
          ) as MdxNode;
          const pagePath = relative(DOCS_ROOT, filePath).split(sep).join("/");

          return findElements(tree, "Tabs").flatMap((group) => {
            const tabs = (group.children ?? []).filter((child) => child.name === "Tab");
            const languages = tabs.filter(isLanguageTab);
            if (languages.length === 0 || languages.length === tabs.length) return [];
            const titles = tabs.map((tab) => stringAttribute(tab, "title") ?? "<missing title>");
            return [`${pagePath}: ${titles.join(", ")}`];
          });
        }),
      )
    ).flat();

    expect(
      problems,
      "A tab group switches on exactly one axis: either language or something else, never both",
    ).toEqual([]);
  });

  it("uses no custom presentation code", async () => {
    const customPresentationFiles = (await listFiles(V4_DOCS_ROOT, shouldInspectDocsDirectory))
      .map((filePath) => relative(V4_DOCS_ROOT, filePath).split(sep).join("/"))
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
  const localAliases = await readTypescriptLocalTypeAliases();
  const methods = await Promise.all(
    SDK_OBJECTS.map(async ({ className, classSlug, typescriptFile }) => {
      const filePath = resolve(TYPESCRIPT_ROOT, typescriptFile);
      const root = parse(Lang.TypeScript, await readFile(filePath, "utf8")).root();
      const aliases = new Map(localAliases);
      for (const alias of root.findAll({ rule: { kind: "type_alias_declaration" } })) {
        const name = alias.field("name")?.text();
        const value = alias.field("value");
        if (name && value) aliases.set(name, value);
      }
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
              localTypescriptInputFields(method, aliases),
            ),
          ];
        });
    }),
  );

  return deduplicateMethods(methods.flat(), "TypeScript").filter(participatesInReferenceParity);
}

async function readTypescriptLocalTypeAliases(): Promise<Map<string, SgNode>> {
  const aliases = new Map<string, SgNode>();
  const filePath = resolve(TYPESCRIPT_ROOT, "fileUpload.ts");
  const root = parse(Lang.TypeScript, await readFile(filePath, "utf8")).root();
  for (const alias of root.findAll({ rule: { kind: "type_alias_declaration" } })) {
    const name = alias.field("name")?.text();
    const value = alias.field("value");
    if (name && value) aliases.set(name, value);
  }
  return aliases;
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
  const localTypes = await readPythonLocalTypeFields();
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
            localPythonInputFields(method, localTypes),
          ),
        ];
      });
    }),
  );

  return deduplicateMethods(methods.flat(), "Python").filter(participatesInReferenceParity);
}

async function readPythonLocalTypeFields(): Promise<{
  aliases: Map<string, string>;
  classes: Map<string, PublicInputField[]>;
}> {
  const aliases = await readPythonTypeAliases();
  const classes = new Map<string, PublicInputField[]>();
  for (const filePath of await listFiles(PYTHON_ROOT)) {
    if (extname(filePath) !== ".py") continue;
    const root = parse("python", await readFile(filePath, "utf8")).root();
    for (const classNode of root.findAll({ rule: { kind: "class_definition" } })) {
      const decorated = classNode
        .ancestors()
        .find((ancestor) => ancestor.kind() === "decorated_definition");
      const isDataclass = decorated
        ?.findAll({ rule: { kind: "decorator" } })
        .some((decorator) => decorator.text().startsWith("@dataclass"));
      const className = classNode.field("name")?.text();
      const body = classNode.field("body");
      if (!isDataclass || !className || !body) continue;
      const fields = namedChildren(body).flatMap((statement): PublicInputField[] => {
        const assignment =
          statement.kind() === "assignment" || statement.kind() === "annotated_assignment"
            ? statement
            : namedChildren(statement).find(
                (child) => child.kind() === "assignment" || child.kind() === "annotated_assignment",
              );
        const name = assignment?.field("left")?.text();
        const type = assignment?.field("type")?.text();
        if (!name || !type || name.startsWith("_")) return [];
        return [
          {
            complete: true,
            key: name,
            optional: splitTopLevelUnion(type.replace(/\s+/gu, "")).includes("None"),
            type,
          },
        ];
      });
      if (fields.length > 0) classes.set(className, fields);
    }
  }
  return { aliases, classes };
}

function localPythonInputFields(
  method: SgNode,
  localTypes: {
    aliases: ReadonlyMap<string, string>;
    classes: ReadonlyMap<string, PublicInputField[]>;
  },
): PublicInputField[] {
  const fields = Object.entries(readParameterTypes(method, pythonParameterName)).flatMap(
    ([parameter, type]) =>
      pythonTypeReferences(type, localTypes.aliases).flatMap((reference) =>
        (localTypes.classes.get(reference) ?? []).map((field) => ({
          ...field,
          key: `${parameter}.${field.key}`,
        })),
      ),
  );
  return uniquePublicInputFields(fields);
}

function pythonTypeReferences(
  type: string,
  aliases: ReadonlyMap<string, string>,
  seen = new Set<string>(),
): string[] {
  const references = type.match(/\b[A-Za-z_][A-Za-z0-9_]*\b/gu) ?? [];
  const expanded = references.flatMap((reference): string[] => {
    const alias = aliases.get(reference);
    if (!alias || seen.has(reference)) return [reference];
    return pythonTypeReferences(alias, aliases, new Set([...seen, reference]));
  });
  return [...new Set(expanded)];
}

async function readTypescriptResponseMembers(): Promise<ResponseReferenceMember[]> {
  const filePath = resolve(TYPESCRIPT_ROOT, "response.ts");
  const root = parse(Lang.TypeScript, await readFile(filePath, "utf8")).root();
  const classNode = findClass(root, "class_declaration", "Response", filePath);
  const classBody = classNode.field("body");
  if (!classBody) throw new Error(`Response has no class body in ${filePath}`);

  return namedChildren(classBody).flatMap((method): ResponseReferenceMember[] => {
    if (method.kind() !== "method_definition") return [];
    const nameNode = method.field("name");
    const name = nameNode?.text();
    const access = namedChildren(method).find((child) => child.kind() === "accessibility_modifier");
    if (
      !name ||
      name === "constructor" ||
      nameNode?.kind() === "private_property_identifier" ||
      access?.text() === "private" ||
      access?.text() === "protected"
    ) {
      return [];
    }
    const returnType = method.field("return_type")?.text().replace(/^:\s*/u, "");
    if (!returnType) throw new Error(`Response.${name} has no return type in ${filePath}`);
    return [
      {
        isProperty: false,
        name,
        parameters: readParameterNames(method, typescriptParameterName, filePath),
        returnType,
      },
    ];
  });
}

function readTypescriptHelperMembers(source: string, className: string): ResponseReferenceMember[] {
  const classStart = source.indexOf(`export class ${className} {`);
  if (classStart < 0) throw new Error(`Could not find ${className}`);
  const bodyStart = source.indexOf("{", classStart);
  const bodyEnd = matchingBrace(source, bodyStart);
  const body = source.slice(bodyStart + 1, bodyEnd);
  const properties = [
    ...body.matchAll(/^\s+readonly ([A-Za-z_$][A-Za-z0-9_$]*):\s*([^;]+);/gmu),
  ].map((match) => ({
    isProperty: true,
    name: match[1] as string,
    parameters: [],
    returnType: (match[2] as string).trim(),
  }));
  const methods = [
    ...body.matchAll(/^\s+(?:async\s+)?([A-Za-z_$][A-Za-z0-9_$]*)\(([^)]*)\):\s*([^\n{]+)\s*\{/gmu),
  ]
    .filter((match) => match[1] !== "constructor")
    .map((match) => ({
      isProperty: false,
      name: match[1] as string,
      parameters: responseSignatureParameters(match[2] as string),
      returnType: (match[3] as string).trim(),
    }));
  return [...properties, ...methods];
}

async function readPythonResponseMembers(): Promise<ResponseReferenceMember[]> {
  const filePath = resolve(PYTHON_ROOT, "response.py");
  return readPythonClassMembers(await readFile(filePath, "utf8"), "Response", filePath);
}

function readPythonClassMembers(
  source: string,
  className: string,
  filePath: string,
): ResponseReferenceMember[] {
  const root = parse("python", source).root();
  const classNode = findClass(root, "class_definition", className, filePath);
  const classBody = classNode.field("body");
  if (!classBody) throw new Error(`${className} has no class body in ${filePath}`);

  return namedChildren(classBody).flatMap((member): ResponseReferenceMember[] => {
    const decorators =
      member.kind() === "decorated_definition"
        ? namedChildren(member).filter((child) => child.kind() === "decorator")
        : [];
    const method = member.kind() === "decorated_definition" ? member.field("definition") : member;
    if (!method || method.kind() !== "function_definition") return [];
    const name = method.field("name")?.text();
    if (!name || name.startsWith("_")) return [];
    const decoratorNames = decorators.map((decorator) =>
      decorator.text().slice(1).split("(", 1)[0]?.split(".").at(-1),
    );
    if (decoratorNames.includes("overload")) return [];
    const returnType = method.field("return_type")?.text();
    if (!returnType) throw new Error(`${className}.${name} has no return type in ${filePath}`);
    return [
      {
        isProperty: decoratorNames.includes("property"),
        name,
        parameters: readParameterNames(method, pythonParameterName, filePath).filter(
          (parameter) => parameter !== "self" && parameter !== "cls",
        ),
        returnType,
      },
    ];
  });
}

async function readGoMethods(): Promise<SdkMethod[]> {
  const methods: SdkMethod[] = [];
  for (const filePath of await listFiles(GO_ROOT, () => false)) {
    if (extname(filePath) !== ".go" || filePath.endsWith("_test.go")) continue;
    for (const declaration of parseGoFunctions(await readFile(filePath, "utf8"))) {
      if (!/^[A-Z]/u.test(declaration.name)) continue;
      const sdkObject = goDeclarationObject(declaration);
      if (!sdkObject) continue;
      // Every Go call threads context.Context, so it is not a documentable
      // parameter. Object handles taken by package-level callables such as
      // Extract are documented like any other parameter.
      const parameters = declaration.parameters.filter(({ type }) => type !== "context.Context");
      methods.push(
        sdkMethod(
          sdkObject.classSlug,
          declaration.name,
          parameters.map(({ name }) => name),
          undefined,
          declaration.returnType,
          Object.fromEntries(parameters.map(({ name, type }) => [name, type])),
        ),
      );
    }
  }
  return deduplicateMethods(methods, "Go");
}

// A package-level function belongs to the object it constructs or extends,
// such as Create returning *Stagehand or the generic Extract taking one.
function goDeclarationObject(declaration: GoFunctionDeclaration): SdkObject | undefined {
  if (declaration.receiverType !== undefined) {
    return SDK_OBJECTS.find(({ goClassName }) => goClassName === declaration.receiverType);
  }
  return SDK_OBJECTS.find(({ goClassName }) => {
    const pointer = new RegExp(`\\*${goClassName}\\b`, "u");
    return (
      declaration.parameters.some(({ type }) => pointer.test(type)) ||
      pointer.test(declaration.returnType)
    );
  });
}

// The Go SDK also exports Go-specific surface: handle accessors such as
// Stagehand.Browser(), union constructors, and generic helpers such as
// EvaluateAs. Reference parity is judged on the surface shared with TypeScript.
function sharedSurfaceMethods(methods: SdkMethod[], expected: readonly string[]): SdkMethod[] {
  const surface = new Set(expected);
  return methods.filter((method) => surface.has(methodKey(method)));
}

async function readGoResponseMembers(): Promise<ResponseReferenceMember[]> {
  const filePath = resolve(GO_ROOT, "response.go");
  return parseGoFunctions(await readFile(filePath, "utf8"))
    .filter(
      (declaration) => declaration.receiverType === "Response" && /^[A-Z]/u.test(declaration.name),
    )
    .map((declaration) => ({
      isProperty: false,
      name: declaration.name,
      parameters: declaration.parameters.map(({ name }) => name),
      returnType: declaration.returnType,
    }));
}

// Parses gofmt-formatted Go struct declarations into their exported fields.
// Comment lines, unexported fields, and struct tags are dropped.
async function readGoStructs(): Promise<Map<string, GoParameter[]>> {
  const structs = new Map<string, GoParameter[]>();
  for (const filePath of await listFiles(GO_ROOT, () => false)) {
    if (extname(filePath) !== ".go" || filePath.endsWith("_test.go")) continue;
    const source = await readFile(filePath, "utf8");
    for (const match of source.matchAll(/^type (\w+)(?:\[[^\]]*\])? struct \{\n([\s\S]*?)^\}/gmu)) {
      const fields = (match[2] as string).split("\n").flatMap((line): GoParameter[] => {
        const field = line.match(/^\t([A-Z]\w*)\s+(.+?)(?:\s+`[^`]*`)?$/u);
        return field ? [{ name: field[1] as string, type: field[2] as string }] : [];
      });
      structs.set(match[1] as string, fields);
    }
  }
  return structs;
}

// Expands a Go parameter into the `parameter.Field` paths a reference page
// must document: the exported fields of its struct type, recursing while the
// field type is itself a locally declared struct with exported fields.
function exportedGoFieldPaths(
  prefix: string,
  type: string,
  structs: ReadonlyMap<string, GoParameter[]>,
  seen: ReadonlySet<string> = new Set(),
): Array<{ key: string; type: string }> {
  const base = type.replace(/^(?:\.\.\.|\*|\[\])+/u, "");
  const fields = structs.get(base);
  if (!fields || seen.has(base)) return [];
  const nextSeen = new Set([...seen, base]);
  return fields.flatMap((field) => [
    { key: `${prefix}.${field.name}`, type: field.type },
    ...exportedGoFieldPaths(`${prefix}.${field.name}`, field.type, structs, nextSeen),
  ]);
}

// Parses gofmt-formatted Go function and method declarations. The SDK's
// signatures never nest braces or comments inside a declaration, so balanced
// scanning is enough; documented signatures in MDX code fences parse the same
// way because they end at a newline instead of a body brace.
function parseGoFunctions(source: string): GoFunctionDeclaration[] {
  const declarations: GoFunctionDeclaration[] = [];
  const starts =
    /^func (?:\((?:\w+ )?\*?(\w+)(?:\[[^\]]*\])?\) )?([A-Za-z_]\w*)(?:\[[^\]]*\])?\(/gmu;
  for (const match of source.matchAll(starts)) {
    const parameterStart = match.index + match[0].length;
    const parameterEnd = matchingParenthesis(source, parameterStart - 1);
    declarations.push({
      name: match[2] as string,
      parameters: parseGoParameters(source.slice(parameterStart, parameterEnd)),
      receiverType: match[1],
      returnType: source
        .slice(parameterEnd + 1, goDeclarationEnd(source, parameterEnd + 1))
        .replace(/\s+/gu, " ")
        .trim(),
    });
  }
  return declarations;
}

function matchingParenthesis(source: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    if (source[index] === ")") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`Unbalanced Go declaration: ${source.slice(openIndex, openIndex + 80)}`);
}

function matchingBrace(source: string, openIndex: number): number {
  let depth = 0;
  for (let index = openIndex; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }
  throw new Error(`Unbalanced TypeScript class: ${source.slice(openIndex, openIndex + 80)}`);
}

// A return type ends at the body brace (SDK source) or at the end of the
// line (documented signatures carry no body).
function goDeclarationEnd(source: string, start: number): number {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    const character = source[index];
    if (character === "(" || character === "[") depth += 1;
    if (character === ")" || character === "]") depth -= 1;
    if ((character === "{" || character === "\n") && depth === 0) return index;
  }
  return source.length;
}

function parseGoParameters(text: string): GoParameter[] {
  const parameters = splitTopLevelGo(text)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part): GoParameter => {
      const space = part.indexOf(" ");
      return space < 0
        ? { name: part, type: "" }
        : { name: part.slice(0, space), type: part.slice(space + 1).replace(/\s+/gu, " ") };
    });
  // Grouped parameters (`a, b string`) take the next declared type.
  for (let index = parameters.length - 2; index >= 0; index -= 1) {
    const parameter = parameters[index] as GoParameter;
    if (!parameter.type) parameter.type = (parameters[index + 1] as GoParameter).type;
  }
  return parameters;
}

function splitTopLevelGo(text: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === "(" || character === "[" || character === "{") depth += 1;
    if (character === ")" || character === "]" || character === "}") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function readDocumentedResponseMembers(
  view: MdxNode,
  language: Language,
): ResponseReferenceMember[] {
  if (language === "Go") {
    return findNodeValues(view, "code").flatMap((value) =>
      parseGoFunctions(value)
        .filter((declaration) => declaration.receiverType === "Response")
        .map((declaration) => ({
          isProperty: false,
          name: declaration.name,
          parameters: declaration.parameters.map(({ name }) => name),
          returnType: declaration.returnType,
        })),
    );
  }

  const members: ResponseReferenceMember[] = [];
  for (const line of findNodeValues(view, "code").flatMap((value) => value.split("\n"))) {
    const trimmed = line.trim();
    if (language === "TypeScript") {
      const match = trimmed.match(
        /^response\.([A-Za-z_$][A-Za-z\d_$]*)(?:<[^>]+>)?\(([^)]*)\):\s*(.+)$/u,
      );
      if (!match) continue;
      members.push({
        isProperty: false,
        name: match[1] as string,
        parameters: responseSignatureParameters(match[2] as string),
        returnType: match[3] as string,
      });
      continue;
    }

    const property = trimmed.match(/^response\.([A-Za-z_][A-Za-z\d_]*):\s*(.+)$/u);
    if (property) {
      members.push({
        isProperty: true,
        name: property[1] as string,
        parameters: [],
        returnType: property[2] as string,
      });
      continue;
    }
    const method = trimmed.match(
      /^await response\.([A-Za-z_][A-Za-z\d_]*)\(([^)]*)\)\s*->\s*(.+)$/u,
    );
    if (method) {
      members.push({
        isProperty: false,
        name: method[1] as string,
        parameters: responseSignatureParameters(method[2] as string),
        returnType: method[3] as string,
      });
    }
  }
  return members;
}

function responseSignatureParameters(value: string): string[] {
  if (!value.trim()) return [];
  return value.split(",").map((parameter) => parameter.trim().split(/[:=]/u, 1)[0] as string);
}

function responseMemberSignatures(members: ResponseReferenceMember[]): string[] {
  return members
    .map(
      ({ isProperty, name, parameters, returnType }) =>
        `${isProperty ? "property" : "method"}:${name}(${parameters.join(",")}):${returnType.replaceAll(/\s/g, "")}`,
    )
    .sort();
}

async function readTypescriptRootExports(): Promise<Set<string>> {
  const source = await readFile(resolve(TYPESCRIPT_ROOT, "index.ts"), "utf8");
  const names = [...source.matchAll(/export(?:\s+type)?\s*\{([\s\S]*?)\}\s*from/gu)].flatMap(
    (match) =>
      (match[1] as string)
        .split(",")
        .map((entry) => entry.replace(/\/\/.*$/gu, "").trim())
        .filter(Boolean)
        .map(
          (entry) =>
            entry
              .replace(/^type\s+/u, "")
              .split(/\s+as\s+/u)
              .at(-1) as string,
        ),
  );
  return new Set(names);
}

function languageTabSource(content: string, language: Language): string {
  const start = content.indexOf(`<Tab title="${language}">`);
  if (start < 0) throw new Error(`Missing ${language} tab`);
  const end = content.indexOf("</Tab>", start);
  if (end < 0) throw new Error(`Unclosed ${language} tab`);
  return content.slice(start, end);
}

function referenceAnchor(heading: string): string {
  return heading
    .replace(/<[^>]+>/gu, "")
    .replace(/`/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/gu, "")
    .trim()
    .replace(/\s+/gu, "-");
}

function readDocumentedHelperMethods(tab: string, language: Language): ResponseReferenceMember[] {
  if (language === "Go") {
    return parseGoFunctions(tab)
      .filter(
        ({ receiverType }) => receiverType === "WebMCPTool" || receiverType === "WebMCPInvocation",
      )
      .map(({ name, parameters, returnType }) => ({
        isProperty: false,
        name,
        parameters: parameters.map(({ name: parameter }) => parameter),
        returnType,
      }));
  }
  if (language === "TypeScript") {
    return [...tab.matchAll(/^([A-Za-z_$][A-Za-z0-9_$]*)\(([^)]*)\):\s*(.+)$/gmu)].map((match) => ({
      isProperty: false,
      name: match[1] as string,
      parameters: responseSignatureParameters(match[2] as string),
      returnType: match[3] as string,
    }));
  }
  return [
    ...tab.matchAll(/async def\s+([A-Za-z_][A-Za-z0-9_]*)\(([\s\S]*?)\)\s*->\s*([^\n]+)/gu),
  ].map((match) => ({
    isProperty: false,
    name: match[1] as string,
    parameters: signatureParameterNames(match[2] as string).filter(
      (parameter) => parameter !== "*",
    ),
    returnType: (match[3] as string).trim(),
  }));
}

function signatureParameterNames(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (character === "[" || character === "(" || character === "{") depth += 1;
    if (character === "]" || character === ")" || character === "}") depth -= 1;
    if (character === "," && depth === 0) {
      parts.push(value.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(value.slice(start));
  return parts.map((parameter) => parameter.trim().split(/[:=]/u, 1)[0] as string).filter(Boolean);
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

function localTypescriptInputFields(
  method: SgNode,
  aliases: ReadonlyMap<string, SgNode>,
): PublicInputField[] {
  const parameters = method.field("parameters");
  if (!parameters) return [];

  const fields = namedChildren(parameters).flatMap((parameter): PublicInputField[] => {
    const name = typescriptParameterName(parameter);
    const type = parameter.field("type");
    if (!name || !type) return [];
    const referencedAliases = type
      .findAll({ rule: { kind: "type_identifier" } })
      .map((identifier) => identifier.text())
      .filter((identifier) => aliases.has(identifier));
    return referencedAliases.flatMap((alias) =>
      localTypePropertyFields(alias, aliases).map((field) => ({
        ...field,
        complete: isLocallyCompleteTypeAlias(alias, aliases),
        key: `${name}.${field.key}`,
      })),
    );
  });
  return uniquePublicInputFields(fields);
}

function localTypePropertyFields(
  aliasName: string,
  aliases: ReadonlyMap<string, SgNode>,
  seen = new Set<string>(),
): PublicInputField[] {
  if (seen.has(aliasName)) return [];
  const value = aliases.get(aliasName);
  if (!value) return [];
  const nextSeen = new Set([...seen, aliasName]);
  const directProperties = value
    .findAll({ rule: { kind: "property_signature" } })
    .flatMap((property): PublicInputField[] => {
      const name = property.field("name")?.text();
      const type = property.field("type")?.text().replace(/^:\s*/u, "");
      return name && type
        ? [
            {
              complete: true,
              key: name,
              optional: property.children().some((child) => child.text() === "?"),
              type,
            },
          ]
        : [];
    });
  const inheritedProperties = value
    .findAll({ rule: { kind: "type_identifier" } })
    .map((identifier) => identifier.text())
    .filter((identifier) => aliases.has(identifier))
    .flatMap((identifier) => localTypePropertyFields(identifier, aliases, nextSeen));
  return uniquePublicInputFields([...directProperties, ...inheritedProperties]);
}

function isLocallyCompleteTypeAlias(
  aliasName: string,
  aliases: ReadonlyMap<string, SgNode>,
  seen = new Set<string>(),
): boolean {
  if (seen.has(aliasName)) return true;
  const value = aliases.get(aliasName);
  if (!value) return false;
  const nextSeen = new Set([...seen, aliasName]);
  const compositionReferences = value
    .findAll({ rule: { kind: "type_identifier" } })
    .filter(
      (identifier) =>
        !identifier
          .ancestors()
          .some(
            (ancestor) =>
              ancestor.range().start.index !== value.range().start.index &&
              ancestor.kind() === "property_signature",
          ),
    )
    .map((identifier) => identifier.text());
  return compositionReferences.every(
    (reference) =>
      aliases.has(reference) && isLocallyCompleteTypeAlias(reference, aliases, nextSeen),
  );
}

function sdkMethod(
  classSlug: string,
  methodName: string,
  parameters: string[],
  operationName?: string,
  returnType?: string,
  parameterTypes: Record<string, string> = {},
  localInputFields: PublicInputField[] = [],
): SdkMethod {
  const normalizedName = snakeCase(methodName);
  return {
    classSlug,
    localInputFields,
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
      .filter((filePath) => {
        const classSlug = relative(REFERENCE_ROOT, filePath).replace(/\.mdx$/u, "");
        return !SUPPLEMENTAL_REFERENCE_PAGES.has(classSlug);
      })
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
        const views = findLanguageTabs(tree).map((view): ReferenceTab => {
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

// Sections of a reference page that document something other than a method, so
// they carry no signature to check against the SDK.
const NON_METHOD_SECTIONS = new Set(["Quick start", "Properties"]);

function readReferenceMethods(view: MdxNode, filePath: string): ReferenceMethod[] {
  const children = view.children ?? [];
  return children.flatMap((child, index): ReferenceMethod[] => {
    if (child.type !== "heading" || child.depth !== 2) return [];
    const heading = mdxText(child).trim();
    if (NON_METHOD_SECTIONS.has(heading)) return [];
    const methodName = heading.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\(\)$/u)?.[1];
    if (!methodName) {
      throw new Error(
        `${filePath} language tab headings must be an exact method name ending in (), or one of: ${[...NON_METHOD_SECTIONS].join(", ")}. Got: ${heading}`,
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

function isLanguageTab(node: MdxNode): boolean {
  const title = stringAttribute(node, "title");
  return title !== undefined && LANGUAGE_TAB_TITLES.has(title);
}

// Document-order language tabs, ignoring tabs that switch on any other axis.
function findLanguageTabs(node: MdxNode): MdxNode[] {
  return findElements(node, "Tab").filter(isLanguageTab);
}

function mdxText(node: MdxNode): string {
  return `${node.value ?? ""}${node.children?.map(mdxText).join("") ?? ""}`;
}

function mdxSpellingValues(node: MdxNode): string[] {
  const pathValues =
    node.attributes?.flatMap(({ name, value }) =>
      name === "path" && typeof value === "string" ? [value] : [],
    ) ?? [];
  if (node.type === "paragraph") {
    const text = mdxText(node);
    return text.includes("TypeScript") && text.includes("Python")
      ? pathValues
      : [...pathValues, ...findNodeValues(node, "inlineCode")];
  }
  if (node.type === "code") return [...pathValues, node.value ?? ""];
  return [...pathValues, ...(node.children?.flatMap(mdxSpellingValues) ?? [])];
}

function findNodeValues(node: MdxNode, type: string): string[] {
  return [
    ...(node.type === type && node.value !== undefined ? [node.value] : []),
    ...(node.children?.flatMap((child) => findNodeValues(child, type)) ?? []),
  ];
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

function participatesInReferenceParity({
  classSlug,
  methodSlug,
}: Pick<SdkMethod, "classSlug" | "methodSlug">): boolean {
  return classSlug !== "stagehand" || !STAGEHAND_LIFECYCLE_METHODS.has(methodSlug);
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
        methods
          .filter((method) =>
            participatesInReferenceParity({
              classSlug: page.classSlug,
              methodSlug: method.methodSlug,
            }),
          )
          .map((method) => ({
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

async function readPythonTypeAliases(): Promise<Map<string, string>> {
  const aliases = new Map<string, string>();
  for (const filePath of await listFiles(PYTHON_ROOT)) {
    if (extname(filePath) !== ".py") continue;
    const root = parse("python", await readFile(filePath, "utf8")).root();
    for (const assignment of root.findAll({ rule: { kind: "assignment" } })) {
      if (
        assignment
          .ancestors()
          .some(
            (ancestor) =>
              ancestor.kind() === "function_definition" || ancestor.kind() === "class_definition",
          )
      ) {
        continue;
      }
      const [name, value] = namedChildren(assignment);
      if (name?.kind() === "identifier" && value && /^[A-Z]/u.test(name.text())) {
        aliases.set(name.text(), value.text());
      }
    }
    for (const classNode of root.findAll({ rule: { kind: "class_definition" } })) {
      const name = classNode.field("name")?.text();
      const body = classNode.field("body");
      if (!name || !body || !classNode.text().split("\n", 1)[0]?.includes("(StrEnum)")) continue;
      const values = namedChildren(body).flatMap((statement): string[] => {
        const assignment =
          statement.kind() === "expression_statement" ? namedChildren(statement)[0] : statement;
        if (assignment?.kind() !== "assignment") return [];
        const value = namedChildren(assignment)[1];
        return value?.kind() === "string" ? [stringLiteral(value)] : [];
      });
      if (values.length > 0) {
        aliases.set(name, `Literal[${values.map((value) => `'${value}'`).join(", ")}]`);
      }
    }
  }
  return aliases;
}

function publicTypeCandidates(
  type: string,
  language: Language,
  optional: boolean,
  protocol: ProtocolDocument,
  pythonAliases: ReadonlyMap<string, string>,
  method: SdkMethod,
): Set<string> {
  const candidates = new Set([normalizePublicType(type, language, optional, pythonAliases)]);
  if (language === "TypeScript") {
    const indexedAccess = type.match(/\b([A-Za-z_$][A-Za-z0-9_$]*)\s*\[\s*["']([^"']+)["']\s*\]/u);
    if (indexedAccess) {
      const [, modelName, propertyName] = indexedAccess;
      const model = modelName ? protocol.$defs[modelName] : undefined;
      const property =
        model && propertyName ? resolvedProperties(model, protocol)[propertyName] : undefined;
      if (property) {
        candidates.add(
          normalizePublicType(
            canonicalDirectSchemaType(property, language, protocol),
            language,
            optional,
            pythonAliases,
          ),
        );
        if (property.enum?.every((value) => typeof value === "string")) {
          candidates.add(
            normalizePublicType(
              property.enum.map((value) => `'${value as string}'`).join(" | "),
              language,
              optional,
              pythonAliases,
            ),
          );
        }
      }
    }
    if (type.includes("this")) {
      const className = SDK_OBJECTS.find(
        ({ classSlug }) => classSlug === method.classSlug,
      )?.className;
      if (className) {
        candidates.add(
          normalizePublicType(
            type.replace(/\bthis\b/gu, className),
            language,
            optional,
            pythonAliases,
          ),
        );
      }
    }
  }
  return candidates;
}

function canonicalDirectSchemaType(
  schema: JsonSchema,
  language: Language,
  protocol: ProtocolDocument,
): string {
  if (
    schema.type === "object" &&
    typeof schema.additionalProperties === "object" &&
    schema.additionalProperties !== null
  ) {
    const value = canonicalSchemaType(schema.additionalProperties, language, protocol);
    return language === "TypeScript" ? `Record<string, ${value}>` : `dict[str, ${value}]`;
  }
  return canonicalSchemaType(schema, language, protocol);
}

function normalizePublicType(
  type: string | undefined,
  language: Language,
  optional: boolean,
  pythonAliases: ReadonlyMap<string, string>,
): string {
  if (!type) return "";
  let normalized = type
    .replace(/\s+/gu, "")
    .replaceAll('"', "'")
    .replace(/\b(?:builtins|re)\./gu, "");
  if (language === "Python") {
    normalized = expandPythonAliases(normalized, pythonAliases);
    const optionalMatch = normalized.match(/^Optional\[(.*)\]$/u);
    if (optionalMatch?.[1]) normalized = `${optionalMatch[1]}|None`;
  }
  const union = splitTopLevelUnion(normalized);
  const withoutOptional = optional
    ? union.filter((part) => part !== "None" && part !== "undefined")
    : union;
  return [...new Set(withoutOptional)].sort().join("|");
}

function expandPythonAliases(
  type: string,
  aliases: ReadonlyMap<string, string>,
  seen = new Set<string>(),
): string {
  return type.replace(/\b[A-Z][A-Za-z0-9_]*\b/gu, (name) => {
    const alias = aliases.get(name);
    if (!alias || seen.has(name)) return name;
    return expandPythonAliases(
      alias.replace(/\s+/gu, "").replaceAll('"', "'"),
      aliases,
      new Set([...seen, name]),
    );
  });
}

function splitTopLevelUnion(type: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < type.length; index += 1) {
    const character = type[index];
    if (character === "[" || character === "(" || character === "{") depth += 1;
    if (character === "]" || character === ")" || character === "}") depth -= 1;
    if (character === "|" && depth === 0) {
      parts.push(type.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(type.slice(start));
  return parts;
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
    const parameterType = method.parameterTypes[parameter];
    if (
      matchedIndex > 0 &&
      wirePath.length > matchedIndex + 1 &&
      parameterType &&
      isScalarPublicType(parameterType, language)
    ) {
      return [];
    }
    const path = [
      parameter,
      ...wirePath
        .slice(matchedIndex + 1)
        .map((segment) => projectedInputFieldName(method, segment, language)),
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
  const localInputPaths = method.localInputFields.map(({ key }) => key);
  const completeLocalInputRoots = new Set(
    method.localInputFields
      .filter(({ complete }) => complete)
      .map(({ key }) => key.split(".", 1)[0] as string),
  );
  const publicProjection = projected.filter(
    (path) =>
      !completeLocalInputRoots.has(path.split(".", 1)[0] as string) &&
      !isNestedSdkLocatorInputField(method, path),
  );
  return [...new Set([...publicProjection, ...wrappedParams, ...localInputPaths])]
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
    const parameterType = method.parameterTypes[parameter];
    if (
      matchedIndex > 0 &&
      field.path.length > matchedIndex + 1 &&
      parameterType &&
      isScalarPublicType(parameterType, language)
    ) {
      return [];
    }
    const path = [
      parameter,
      ...field.path
        .slice(matchedIndex + 1)
        .map((segment) => projectedInputFieldName(method, segment, language)),
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
  const completeLocalInputRoots = new Set(
    method.localInputFields
      .filter(({ complete }) => complete)
      .map(({ key }) => key.split(".", 1)[0] as string),
  );
  return uniqueProjectedFields(
    [...projected, ...wrapped].filter(
      ({ key }) =>
        !completeLocalInputRoots.has(key.split(".", 1)[0] as string) &&
        !isNestedSdkLocatorInputField(method, key),
    ),
  );
}

function isNestedSdkLocatorInputField(method: SdkMethod, path: string): boolean {
  if (
    method.classSlug === "page" &&
    method.methodName === "screenshot" &&
    (path.startsWith("options.mask.") || path.startsWith("mask."))
  ) {
    return true;
  }
  if (method.classSlug !== "stagehand") return false;
  if (!["act", "observe", "extract"].includes(method.methodName)) return false;
  return new Set([
    "options.locator.selector",
    "options.locator.nth",
    "options.ignoreLocators.selector",
    "options.ignoreLocators.nth",
    "locator.selector",
    "locator.nth",
    "ignore_locators.selector",
    "ignore_locators.nth",
  ]).has(path);
}

function publicReferenceFieldType(
  method: SdkMethod,
  language: Language,
  field: string,
): string | undefined {
  return PUBLIC_REFERENCE_FIELD_TYPES.get(`${method.operationName}:${language}:${field}`);
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
        optional: !field.required && field.schema.default === undefined,
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

function uniquePublicInputFields(fields: PublicInputField[]): PublicInputField[] {
  return [...new Map(fields.map((field) => [field.key, field])).values()].sort((left, right) =>
    left.key.localeCompare(right.key),
  );
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
  return (
    TYPESCRIPT_FIELD_SPELLINGS.get(wireName) ??
    wireName.replace(/_([a-z\d])/gu, (_, character: string) => character.toUpperCase())
  );
}

function projectedInputFieldName(method: SdkMethod, wireName: string, language: Language): string {
  if (
    language === "TypeScript" &&
    method.operationName === "stagehand.callback_batch" &&
    wireName === "page_id"
  ) {
    return "page";
  }
  return publicFieldName(wireName, language);
}

async function readTypescriptPublicFieldNames(): Promise<Set<string>> {
  const sourceFiles = [
    PROTOCOL_SCHEMA_SOURCE,
    resolve(TYPESCRIPT_ROOT, "clientSchemas.ts"),
    ...SDK_OBJECTS.map(({ typescriptFile }) => resolve(TYPESCRIPT_ROOT, typescriptFile)),
  ];
  const names = new Set<string>();
  for (const filePath of sourceFiles) {
    const root = parse(Lang.TypeScript, await readFile(filePath, "utf8")).root();
    for (const property of root.findAll({ rule: { kind: "property_identifier" } })) {
      const parentKind = property.parent()?.kind();
      if (parentKind === "pair" || parentKind === "property_signature") {
        names.add(property.text());
      }
    }
  }
  for (const method of await readTypescriptMethods()) {
    for (const parameter of method.parameters) names.add(parameter);
    for (const field of method.localInputFields) {
      const name = field.key.split(".").at(-1);
      if (name) names.add(name);
    }
  }
  return names;
}

async function readPythonPublicFieldNames(): Promise<Set<string>> {
  const names = new Set<string>();
  for (const filePath of await listFiles(PYTHON_ROOT)) {
    if (extname(filePath) !== ".py") continue;
    const root = parse("python", await readFile(filePath, "utf8")).root();
    for (const method of root.findAll({ rule: { kind: "function_definition" } })) {
      const parameters = method.field("parameters");
      if (!parameters) continue;
      for (const parameter of namedChildren(parameters)) {
        const name = pythonParameterName(parameter);
        if (name && name !== "self" && name !== "cls") names.add(name);
      }
    }
    for (const assignment of root.findAll({ rule: { kind: "assignment" } })) {
      if (!assignment.ancestors().some((ancestor) => ancestor.kind() === "class_definition")) {
        continue;
      }
      const name = namedChildren(assignment)[0];
      if (name?.kind() === "identifier" && !name.text().startsWith("_")) {
        names.add(name.text());
      }
    }
  }
  return names;
}

function uniqueSpellingsByWireName(names: ReadonlySet<string>): Map<string, string> {
  const candidates = new Map<string, Set<string>>();
  for (const name of names) {
    const wireName = snakeCase(name);
    const spellings = candidates.get(wireName) ?? new Set<string>();
    spellings.add(name);
    candidates.set(wireName, spellings);
  }
  return new Map(
    [...candidates].flatMap(([wireName, spellings]) =>
      spellings.size === 1 ? [[wireName, [...spellings][0] as string] as const] : [],
    ),
  );
}

function isScalarPublicType(type: string, language: Language): boolean {
  const normalized = type
    .replace(/\s+/gu, "")
    .replace(/\b(?:builtins|re)\./gu, "")
    .replace(/^Optional\[(.*)\]$/u, "$1|None");
  const parts = splitTopLevelUnion(normalized).filter(
    (part) => part !== "None" && part !== "undefined",
  );
  const scalar =
    language === "TypeScript"
      ? /^(?:string|number|boolean|RegExp|Literal<.*>)$/u
      : /^(?:str|int|float|bool|Pattern\[.*\]|Literal\[.*\])$/u;
  return parts.length > 0 && parts.every((part) => scalar.test(part));
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

function hasNoIndexFrontmatter(source: string): boolean {
  const frontmatter = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(source)?.[1];
  return frontmatter !== undefined && /^noindex:\s*true\s*$/mu.test(frontmatter);
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
