import { readdir, readFile } from "node:fs/promises";
import go from "@ast-grep/lang-go";
import python from "@ast-grep/lang-python";
import { parse, registerDynamicLanguage, type SgNode } from "@ast-grep/napi";
import { describe, expect, it } from "vitest";

registerDynamicLanguage({ go, python });

const sdkObjects = [
  ["Stagehand", "stagehand.ts", "stagehand.py", "stagehand.go", "Stagehand"],
  [
    "BrowserContext",
    "browserContext.ts",
    "browser_context.py",
    "browser_context.go",
    "BrowserContext",
  ],
  [
    "BrowserClipboard",
    "browserClipboard.ts",
    "browser_clipboard.py",
    "browser_clipboard.go",
    "BrowserClipboard",
  ],
  ["Page", "page.ts", "page.py", "page.go", "Page"],
  ["Locator", "locator.ts", "locator.py", "locator.go", "PageLocator"],
] as const;

const typescriptSource = new URL("../../packages/sdk-ts/src/", import.meta.url);
const pythonSource = new URL("../../packages/sdk-python/src/stagehand/", import.meta.url);
const goSource = new URL("../../packages/sdk-go/", import.meta.url);
const extensionRouterUrl = new URL("../../packages/extension/rpcRouter.ts", import.meta.url);
const protocolUrl = new URL("../../packages/protocol/stagehand.v4.json", import.meta.url);
const registryUrl = new URL("../../packages/protocol/schema-registry.ts", import.meta.url);

// Extracted JSON is intentionally decoded through a dedicated wire model so
// Pydantic receives raw JSON values instead of the generated JSON union.
const pythonWireResultModels: Readonly<Record<string, string>> = {
  "page.webmcp_invocation_result": "WireWebMCPToolResponse",
  "stagehand.extract": "_ExtractWireResult",
};

type SdkLanguage = "go" | "typescript" | "python";

type ProtocolMethod = {
  properties: {
    params: { $ref: string };
    result: { $ref: string };
  };
};

type ProtocolNotification = {
  properties: {
    params: { $ref: string };
  };
};

type JsonSchema = {
  $ref?: string;
  enum?: unknown[];
  properties?: Record<string, JsonSchema>;
  type?: string | string[];
};

type ProtocolDocument = {
  $defs: Record<string, JsonSchema>;
  properties: {
    methods: { properties: Record<string, ProtocolMethod> };
    notifications: { properties: Record<string, ProtocolNotification> };
  };
};

type PublicRpcMethod = {
  method: SgNode;
  wireMethod: string;
};

type PythonRpcCall = {
  file: string;
  method: string;
  module: SgNode;
  params: SgNode;
  result: SgNode;
  scope: SgNode;
};

type GoRpcCall = PythonRpcCall;

const goAccessors: Readonly<Record<string, ReadonlySet<string>>> = {
  Stagehand: new Set(["Browser", "Initialized"]),
  BrowserContext: new Set(["Clipboard"]),
  BrowserClipboard: new Set(),
  Page: new Set(["PageID", "Ref"]),
  PageLocator: new Set(["Descriptor"]),
};

// Browser lifecycle construction is language-specific only in surface syntax now that all three
// v4 clients use create(); the legacy init() lifecycles are gone. RPC-backed
// feature methods remain subject to strict cross-language parity below.
const stagehandLifecycleMethods = new Set(["create", "init"]);
const internalTypescriptMethods = new Set(["create_with_client_for_test"]);

describe("All language SDK operations remain in sync", () => {
  it("sends protocol version and client identity in stagehand.init", async () => {
    const configurations = [
      {
        language: "typescript",
        file: new URL("stagehand.ts", typescriptSource),
        pattern: "StagehandInitParamsSchema.parse({ $$$FIELDS })",
        fields: [
          "protocolVersion:STAGEHAND_PROTOCOL_VERSION",
          "clientInfo:STAGEHAND_SDK_CLIENT_INFO",
        ],
      },
      {
        language: "go",
        file: new URL("stagehand.go", goSource),
        pattern: "StagehandInitParams{$$$FIELDS}",
        fields: ["ProtocolVersion:stagehandProtocolVersion", "ClientInfo:ImplementationInfo{"],
      },
    ] as const;

    for (const configuration of configurations) {
      const root = parse(configuration.language, await readFile(configuration.file, "utf8")).root();
      const construction = root.find({ rule: { pattern: configuration.pattern } });

      expect(
        construction,
        `${configuration.language} must construct stagehand.init params centrally`,
      ).not.toBeNull();
      const fields = construction
        ?.getMultipleMatches("FIELDS")
        .map((field) => field.text().replaceAll(/\s/g, ""));

      for (const requiredField of configuration.fields) {
        expect(
          fields?.some((field) => field.includes(requiredField)),
          `${configuration.language} stagehand.init must send ${requiredField}`,
        ).toBe(true);
      }
    }

    const pythonRoot = parse(
      "python",
      await readFile(new URL("stagehand.py", pythonSource), "utf8"),
    ).root();
    for (const pattern of [
      'values["protocol_version"] = STAGEHAND_PROTOCOL_VERSION',
      'values["client_info"] = STAGEHAND_SDK_CLIENT_INFO',
    ]) {
      expect(
        pythonRoot.find({ rule: { pattern } }),
        `python stagehand.init must set ${pattern}`,
      ).not.toBeNull();
    }
  });

  it("references every registered protocol operation in each client", async () => {
    const registry = await stagehandMethodNames();
    const registeredOperations = [...registry.values()].sort();

    expect(
      await protocolOperations("typescript", typescriptSource, registry),
      "TypeScript must reference every StagehandMethods operation",
    ).toStrictEqual(registeredOperations);
    expect(
      await protocolOperations("python", pythonSource, registry),
      "Python must reference every StagehandMethods operation",
    ).toStrictEqual(registeredOperations);
    expect(
      await protocolOperations("go", goSource, registry),
      "Go must reference every StagehandMethods operation",
    ).toStrictEqual(registeredOperations);
  });

  it("routes every protocol operation to exactly one receiving endpoint", async () => {
    const registry = await stagehandMethodNames();
    const [extensionInbound, typescriptInbound] = await Promise.all([
      extensionRouterOperations(),
      protocolOperations("typescript", typescriptSource, registry, "inbound"),
    ]);
    const registeredOperations = [...registry.values()].sort();
    const handledByBothEndpoints = extensionInbound.filter((method) =>
      typescriptInbound.includes(method),
    );
    const handledOperations = [...new Set([...extensionInbound, ...typescriptInbound])].sort();

    expect(
      handledByBothEndpoints,
      "A protocol operation must not be handled by both the extension and the SDKs",
    ).toEqual([]);
    expect(
      handledOperations,
      "Every StagehandMethods operation must have exactly one receiving endpoint",
    ).toStrictEqual(registeredOperations);

    for (const [language, source] of [
      ["typescript", typescriptSource],
      ["python", pythonSource],
      ["go", goSource],
    ] as const) {
      expect(
        await protocolOperations(language, source, registry, "outbound"),
        `${language} outbound operations must match the extension router`,
      ).toStrictEqual(extensionInbound);
      expect(
        await protocolOperations(language, source, registry, "inbound"),
        `${language} inbound request handlers must match TypeScript inbound request handlers`,
      ).toStrictEqual(typescriptInbound);
    }
  }, 15_000);

  it("keeps every registered notification in the generated protocol and every client", async () => {
    const [registry, protocol] = await Promise.all([
      stagehandNotificationNames(),
      protocolDocument(),
    ]);
    const registeredNotifications = [...registry.values()].sort();

    expect(
      Object.keys(protocol.properties.notifications.properties).sort(),
      "Generated notifications must match StagehandNotifications",
    ).toStrictEqual(registeredNotifications);
    expect(
      await clientProtocolNotifications("typescript", typescriptSource, registry),
      "TypeScript must handle every StagehandNotifications entry",
    ).toStrictEqual(registeredNotifications);
    expect(
      await clientProtocolNotifications("python", pythonSource, registry),
      "Python must handle every StagehandNotifications entry",
    ).toStrictEqual(registeredNotifications);
    expect(
      await clientProtocolNotifications("go", goSource, registry),
      "Go must handle every StagehandNotifications entry",
    ).toStrictEqual(registeredNotifications);

    for (const binding of await pythonNotificationBindings()) {
      const notification = protocol.properties.notifications.properties[binding.notification];
      expect(
        notification,
        `Python handles unknown notification ${binding.notification}`,
      ).toBeDefined();
      if (!notification) continue;
      expect(
        binding.paramsModel,
        `Python must decode ${binding.notification} with its generated params model`,
      ).toBe(referencedModel(notification.properties.params.$ref));
    }
  }, 15_000);

  it("exposes the same RPC-backed operations in every SDK", async () => {
    const registry = await stagehandMethodNames();

    for (const [className, typescriptFile, pythonFile, goFile, goType] of sdkObjects) {
      const typescript = await publicOperations(
        "typescript",
        new URL(typescriptFile, typescriptSource),
        className,
        registry,
      );
      const python = await publicOperations(
        "python",
        new URL(pythonFile, pythonSource),
        className,
        registry,
      );
      const goClient = await publicOperations("go", new URL(goFile, goSource), goType, registry);

      expect(python, `${className} must expose the same RPC-backed operations`).toStrictEqual(
        typescript,
      );
      expect(
        goClient,
        `${className} must expose the same RPC-backed operations in Go`,
      ).toStrictEqual(typescript);
      expect(
        typescript.length,
        `${className} must expose at least one RPC operation`,
      ).toBeGreaterThan(0);
    }
  });

  it("exposes the same public callable surface in every SDK", async () => {
    for (const [className, typescriptFile, pythonFile, goFile, goType] of sdkObjects) {
      const typescript = await publicCallableMethods(
        "typescript",
        new URL(typescriptFile, typescriptSource),
        className,
      );
      const python = await publicCallableMethods(
        "python",
        new URL(pythonFile, pythonSource),
        className,
      );
      const goClient = await publicCallableMethods("go", new URL(goFile, goSource), goType);

      expect(python, `${className} public methods must remain in sync`).toStrictEqual(typescript);
      expect(goClient, `${className} Go public methods must remain in sync`).toStrictEqual(
        typescript,
      );
      expect(typescript.length, `${className} must expose public methods`).toBeGreaterThan(0);
    }
  });

  it("keeps Stagehand accessors aligned and every declared Go accessor present", async () => {
    const [className, typescriptFile, pythonFile, goFile, goType] = sdkObjects[0];
    const typescript = await publicAccessors(
      "typescript",
      new URL(typescriptFile, typescriptSource),
      className,
    );
    const python = await publicAccessors("python", new URL(pythonFile, pythonSource), className);
    const goClient = await publicAccessors("go", new URL(goFile, goSource), goType);

    expect(python, "Stagehand Python accessors must remain in sync").toStrictEqual(typescript);
    expect(goClient, "Stagehand Go accessors must remain in sync").toStrictEqual(typescript);
    expect(typescript.length, "Stagehand must expose public accessors").toBeGreaterThan(0);
    for (const [language, accessors] of [
      ["TypeScript", typescript],
      ["Python", python],
      ["Go", goClient],
    ] as const) {
      expect(accessors, `${language} Stagehand must not expose context`).not.toContain("context");
    }

    for (const [, , , goFile, goType] of sdkObjects) {
      const root = parse("go", await readFile(new URL(goFile, goSource), "utf8")).root();
      const classNode = findClass(root, "go", goType);

      expect(classNode, `${goType} must exist`).toBeDefined();
      if (!classNode) continue;
      const methods = new Set(
        directClassMethods(classNode, "go", goType).flatMap((method) => {
          const name = methodName(method.node, "go");
          return name ? [name.text()] : [];
        }),
      );
      for (const accessor of goAccessors[goType] ?? []) {
        expect(methods.has(accessor), `${goType}.${accessor} accessor must exist`).toBe(true);
      }
    }
  });

  it("exposes every protocol-backed option through a typed public SDK parameter", async () => {
    const [protocol, registry] = await Promise.all([protocolDocument(), stagehandMethodNames()]);
    const mismatches: string[] = [];

    for (const language of ["typescript", "python", "go"] as const) {
      for (const binding of await publicRpcMethods(language, registry)) {
        const protocolMethod = protocol.properties.methods.properties[binding.wireMethod];
        if (!protocolMethod) continue;
        const paramsModel = referencedModel(protocolMethod.properties.params.$ref);
        const paramsSchema = protocol.$defs[paramsModel];
        const optionsReference = paramsSchema?.properties?.options?.$ref;
        if (!optionsReference) continue;

        const optionsModel = referencedModel(optionsReference);
        const optionNames = Object.keys(protocol.$defs[optionsModel]?.properties ?? {});
        const parameters = publicParameterTypes(binding.method, language);
        const optionsType = parameters.get("options");
        if (optionsType !== undefined) {
          if (optionsType.trim() === "") {
            mismatches.push(`${language} ${binding.wireMethod}: untyped options`);
          }
          continue;
        }

        for (const optionName of optionNames) {
          const publicName =
            language === "python" &&
            binding.wireMethod === "stagehand.callback_batch" &&
            optionName === "page_id"
              ? "page"
              : language === "typescript"
                ? camelCase(optionName)
                : language === "python"
                  ? snakeCase(optionName)
                  : exportedGoName(optionName);
          const parameterType = parameters.get(publicName);
          if (parameterType === undefined) {
            mismatches.push(`${language} ${binding.wireMethod}: missing ${publicName}`);
          } else if (parameterType.trim() === "") {
            mismatches.push(`${language} ${binding.wireMethod}: untyped ${publicName}`);
          }
        }
      }
    }

    expect(
      mismatches,
      "Each SDK must expose every nested protocol option through a typed options object or typed flattened parameter",
    ).toEqual([]);
  });

  it("preserves primitive protocol types in flattened public SDK options", async () => {
    const [protocol, registry] = await Promise.all([protocolDocument(), stagehandMethodNames()]);
    const mismatches: string[] = [];

    for (const language of ["typescript", "python", "go"] as const) {
      for (const binding of await publicRpcMethods(language, registry)) {
        const protocolMethod = protocol.properties.methods.properties[binding.wireMethod];
        if (!protocolMethod) continue;
        const paramsModel = referencedModel(protocolMethod.properties.params.$ref);
        const paramsSchema = protocol.$defs[paramsModel];
        const optionsReference = paramsSchema?.properties?.options?.$ref;
        if (!optionsReference) continue;

        const parameters = publicParameterTypes(binding.method, language);
        if (parameters.has("options")) continue;
        const optionsModel = referencedModel(optionsReference);
        for (const [wireName, schema] of Object.entries(
          protocol.$defs[optionsModel]?.properties ?? {},
        )) {
          const expected = publicPrimitiveType(schema, language);
          if (!expected) continue;
          const publicName =
            language === "typescript"
              ? camelCase(wireName)
              : language === "python"
                ? snakeCase(wireName)
                : exportedGoName(wireName);
          const actual = parameters.get(publicName);
          if (actual && !typeCompatibleWithPrimitive(actual, expected, schema)) {
            mismatches.push(
              `${language} ${binding.wireMethod} ${publicName}: expected ${expected}, received ${actual}`,
            );
          }
        }
      }
    }

    expect(
      mismatches,
      "Flattened primitive option types must remain compatible with the protocol schema",
    ).toEqual([]);
  });

  it("keeps low-level RPC clients out of public SDK exports", async () => {
    const [typescript, python, goClient] = await Promise.all([
      readFile(new URL("index.ts", typescriptSource), "utf8"),
      readFile(new URL("__init__.py", pythonSource), "utf8"),
      readFile(new URL("client.go", goSource), "utf8"),
    ]);

    expect(typescript).not.toMatch(/export\s*\{[^}]*\bRPCClient\b/u);
    expect(python).not.toMatch(/["']RPCClient["']/u);
    expect(goClient).not.toMatch(/type\s+(?:RPCClient|ProtocolClient)\b/u);
  });

  it("only calls methods declared by the generated protocol", async () => {
    const methods = await protocolMethods();

    for (const call of await pythonRpcCalls()) {
      expect(
        methods[call.method],
        `${call.file} calls undeclared protocol method ${call.method}`,
      ).toBeDefined();
    }
    for (const call of await goRpcCalls()) {
      expect(
        methods[call.method],
        `${call.file} calls undeclared protocol method ${call.method}`,
      ).toBeDefined();
    }
  });

  it("uses the protocol parameter and result models at Python RPC boundaries", async () => {
    const methods = await protocolMethods();
    let staticallyVisibleParams = 0;

    for (const call of await pythonRpcCalls()) {
      const protocolMethod = methods[call.method];
      expect(
        protocolMethod,
        `${call.method} must be declared before checking its models`,
      ).toBeDefined();
      if (!protocolMethod) continue;

      const expectedParams = referencedModel(protocolMethod.properties.params.$ref);
      const expectedResult =
        pythonWireResultModels[call.method] ??
        referencedModel(protocolMethod.properties.result.$ref);
      const paramsModel = pythonModelName(call.params, call.scope, call.module);
      const resultModel = pythonModelName(call.result, call.scope, call.module);

      if (paramsModel) {
        staticallyVisibleParams += 1;
        expect(paramsModel, `${call.file} must send ${call.method} with ${expectedParams}`).toBe(
          expectedParams,
        );
      }
      expect(resultModel, `${call.file} must decode ${call.method} with ${expectedResult}`).toBe(
        expectedResult,
      );
    }

    expect(staticallyVisibleParams).toBeGreaterThan(0);
  });

  it("uses the protocol parameter and result models at Go RPC boundaries", async () => {
    const methods = await protocolMethods();
    let staticallyVisibleParams = 0;

    for (const call of await goRpcCalls()) {
      const protocolMethod = methods[call.method];
      expect(
        protocolMethod,
        `${call.method} must be declared before checking its models`,
      ).toBeDefined();
      if (!protocolMethod) continue;

      const expectedParams = referencedGoModel(protocolMethod.properties.params.$ref);
      const expectedResult = referencedGoModel(protocolMethod.properties.result.$ref);
      const paramsModel = goModelName(call.params, call.scope, call.module);
      const resultModel = goModelName(call.result, call.scope, call.module);

      if (paramsModel) {
        staticallyVisibleParams += 1;
        expect(paramsModel, `${call.file} must send ${call.method} with ${expectedParams}`).toBe(
          expectedParams,
        );
      }
      expect(resultModel, `${call.file} must decode ${call.method} with ${expectedResult}`).toBe(
        expectedResult,
      );
    }

    expect(staticallyVisibleParams).toBeGreaterThan(0);
  });

  it("returns full Go Stagehand result envelopes", async () => {
    const root = parse("go", await readFile(new URL("stagehand.go", goSource), "utf8")).root();
    const stagehand = findClass(root, "go", "Stagehand");

    expect(stagehand, "Go Stagehand must exist").toBeDefined();
    if (!stagehand) return;

    for (const [methodNameText, resultType] of [
      ["Act", "ActResult"],
      ["Observe", "ObserveResult"],
    ] as const) {
      const method = directClassMethods(stagehand, "go", "Stagehand").find(
        (candidate) => methodName(candidate.node, "go")?.text() === methodNameText,
      )?.node;
      expect(method, `Go Stagehand.${methodNameText} must exist`).toBeDefined();
      if (!method) continue;

      expect(method.field("result")?.text(), `Go Stagehand.${methodNameText} result type`).toBe(
        `(${resultType}, error)`,
      );
      const dataOnlyReturns = method
        .findAll({ rule: { kind: "return_statement" } })
        .filter((statement) => /\bresult\.Data\b/u.test(statement.text()));
      expect(
        dataOnlyReturns,
        `Go Stagehand.${methodNameText} must preserve result metadata`,
      ).toEqual([]);
    }
  });

  it("keeps Go act input typed and generic extract metadata intact", async () => {
    const stagehandRoot = parse(
      "go",
      await readFile(new URL("stagehand.go", goSource), "utf8"),
    ).root();
    const stagehand = findClass(stagehandRoot, "go", "Stagehand");

    expect(stagehand, "Go Stagehand must exist").toBeDefined();
    if (!stagehand) return;

    const act = directClassMethods(stagehand, "go", "Stagehand").find(
      (candidate) => methodName(candidate.node, "go")?.text() === "Act",
    )?.node;
    expect(act, "Go Stagehand.Act must exist").toBeDefined();
    expect(
      act ? publicParameterTypes(act, "go").get("instruction") : undefined,
      "Go Stagehand.Act must accept the generated instruction union",
    ).toBe("ActInstructionValue");

    const extractRoot = parse("go", await readFile(new URL("extract.go", goSource), "utf8")).root();
    const extract = extractRoot
      .findAll({ rule: { kind: "function_declaration" } })
      .find((function_) =>
        namedChildren(function_).some(
          (child) => child.kind() === "identifier" && child.text() === "Extract",
        ),
      );
    expect(extract, "Go generic Extract must exist").toBeDefined();
    expect(extract?.field("result")?.text(), "Go Extract result type").toBe(
      "(TypedExtractResult[T], error)",
    );
    expect(
      extract
        ?.findAll({ rule: { kind: "return_statement" } })
        .some((statement) => /\btypedResult\b/u.test(statement.text())),
      "Go Extract must return its typed result envelope",
    ).toBe(true);
    expect(
      extract
        ?.findAll({ rule: { kind: "assignment_statement" } })
        .some((assignment) => assignment.text() === "typedResult.Metadata = result.Metadata"),
      "Go Extract must preserve protocol result metadata",
    ).toBe(true);
  });
});

async function publicOperations(
  language: SdkLanguage,
  file: URL,
  className: string,
  registry: ReadonlyMap<string, string>,
): Promise<Array<{ publicMethod: string; wireMethod: string }>> {
  const root = parse(language, await readFile(file, "utf8")).root();
  const classNode = findClass(root, language, className);

  expect(classNode, `${className} must exist in ${file.pathname}`).toBeDefined();
  if (!classNode) return [];

  const operations = directClassMethods(classNode, language, className)
    .filter((method) => isPublicCallable(method, language))
    .flatMap((method) => {
      const publicMethod = methodName(method.node, language);
      if (!publicMethod) return [];
      const normalizedMethod = snakeCase(publicMethod.text());
      if (!participatesInSurfaceParity(className, language, normalizedMethod)) return [];

      return protocolCalls(method.node, language).map((call) => {
        const methodNode = protocolMethodNode(call, language);
        if (!methodNode) throw new Error(`${publicMethod.text()} has an RPC call without a method`);

        const wireMethod = wireMethodForCall(methodNode, language, registry);

        return {
          publicMethod: normalizedMethod,
          wireMethod,
        };
      });
    });
  if (language === "go" && className === "Stagehand") {
    const extract = await goExtractFunction();
    if (extract) {
      operations.push(
        ...protocolCalls(extract, "go").flatMap((call) => {
          const methodNode = protocolMethodNode(call, "go");
          return methodNode
            ? [
                {
                  publicMethod: "extract",
                  wireMethod: wireMethodForCall(methodNode, "go", registry),
                },
              ]
            : [];
        }),
      );
    }
  }

  return operations.sort((left, right) =>
    `${left.publicMethod}:${left.wireMethod}`.localeCompare(
      `${right.publicMethod}:${right.wireMethod}`,
    ),
  );
}

async function publicCallableMethods(
  language: SdkLanguage,
  file: URL,
  className: string,
): Promise<string[]> {
  const root = parse(language, await readFile(file, "utf8")).root();
  const classNode = findClass(root, language, className);

  expect(classNode, `${className} must exist in ${file.pathname}`).toBeDefined();
  if (!classNode) return [];

  const methods = [
    ...new Set(
      directClassMethods(classNode, language, className)
        .filter((method) => isPublicCallable(method, language))
        .flatMap((method) => {
          const name = methodName(method.node, language);
          if (!name) return [];
          const normalizedMethod = snakeCase(name.text());
          return participatesInSurfaceParity(className, language, normalizedMethod)
            ? [normalizedMethod]
            : [];
        }),
    ),
  ];
  if (language === "go" && className === "Stagehand" && (await goExtractFunction())) {
    methods.push("extract");
  }
  return [...new Set(methods)].sort();
}

async function goExtractFunction(): Promise<SgNode | undefined> {
  const root = parse("go", await readFile(new URL("extract.go", goSource), "utf8")).root();
  return root
    .findAll({ rule: { kind: "function_declaration" } })
    .find((function_) =>
      namedChildren(function_).some(
        (child) => child.kind() === "identifier" && child.text() === "Extract",
      ),
    );
}

function participatesInSurfaceParity(
  className: string,
  language: SdkLanguage,
  method: string,
): boolean {
  if (className === "Stagehand" && stagehandLifecycleMethods.has(method)) return false;
  return language !== "typescript" || !internalTypescriptMethods.has(method);
}

async function publicAccessors(
  language: SdkLanguage,
  file: URL,
  className: string,
): Promise<string[]> {
  const root = parse(language, await readFile(file, "utf8")).root();
  const classNode = findClass(root, language, className);

  expect(classNode, `${className} must exist in ${file.pathname}`).toBeDefined();
  if (!classNode) return [];

  return directClassMethods(classNode, language, className)
    .filter((method) => {
      const name = methodName(method.node, language);
      if (!name) return false;
      if (language === "go") return goAccessors[className]?.has(name.text()) === true;
      if (language === "python") {
        return (
          !name.text().startsWith("_") &&
          method.decoratedDefinition?.text().startsWith("@property") === true
        );
      }
      const declarationPrefix = method.node
        .text()
        .slice(0, method.node.text().indexOf(name.text()));
      return (
        !/\b(?:private|protected)\b/u.test(declarationPrefix) &&
        /\bget\s*$/u.test(declarationPrefix)
      );
    })
    .flatMap((method) => {
      const name = methodName(method.node, language);
      return name ? [snakeCase(name.text())] : [];
    })
    .sort();
}

type RequestBoundary = "inbound" | "outbound";

async function protocolOperations(
  language: SdkLanguage,
  source: URL,
  registry: ReadonlyMap<string, string>,
  boundary?: RequestBoundary,
): Promise<string[]> {
  const extension = language === "typescript" ? ".ts" : language === "python" ? ".py" : ".go";
  const files = (await readdir(source, { recursive: true }))
    .filter(
      (file) =>
        file.endsWith(extension) &&
        !file.endsWith(`_test${extension}`) &&
        !file.endsWith(`.test${extension}`) &&
        !file.split("/").includes("tests"),
    )
    .sort();
  const operations = new Set<string>();

  for (const file of files) {
    const root = parse(language, await readFile(new URL(file, source), "utf8")).root();
    for (const call of protocolCalls(root, language, boundary)) {
      const method = protocolMethodNode(call, language);
      if (method) operations.add(wireMethodForCall(method, language, registry));
    }
  }

  return [...operations].sort();
}

async function extensionRouterOperations(): Promise<string[]> {
  const root = parse("typescript", await readFile(extensionRouterUrl, "utf8")).root();
  const routeSwitches = root
    .findAll({ rule: { kind: "switch_statement" } })
    .filter((statement) => namedChildren(statement)[0]?.text() === "(request.method)");
  if (routeSwitches.length !== 1) {
    throw new Error(`Expected one request.method router switch, received ${routeSwitches.length}`);
  }

  return routeSwitches[0]!
    .findAll({ rule: { kind: "switch_case" } })
    .flatMap((case_) => {
      const method = namedChildren(case_)[0];
      return method?.kind() === "string" ? [stringLiteral(method)] : [];
    })
    .sort();
}

async function stagehandMethodNames(): Promise<Map<string, string>> {
  return stagehandRegistryNames("StagehandMethods");
}

async function stagehandNotificationNames(): Promise<Map<string, string>> {
  return stagehandRegistryNames("StagehandNotifications");
}

async function stagehandRegistryNames(
  registryName: "StagehandMethods" | "StagehandNotifications",
): Promise<Map<string, string>> {
  const root = parse("typescript", await readFile(registryUrl, "utf8")).root();
  const declaration = root.find({
    rule: { pattern: `const ${registryName} = $REGISTRY` },
  });
  const registry = declaration?.getMatch("REGISTRY")?.find({ rule: { kind: "object" } });
  if (!registry) throw new Error(`${registryName} registry was not found`);

  return new Map(
    namedChildren(registry).flatMap((entry) => {
      if (entry.kind() !== "pair") return [];
      const [key, value] = namedChildren(entry);
      const name =
        value &&
        namedChildren(value).find(
          (property) => property.kind() === "pair" && namedChildren(property)[0]?.text() === "name",
        );
      const wireName = name && namedChildren(name)[1];
      return key && wireName ? [[key.text(), stringLiteral(wireName)] as const] : [];
    }),
  );
}

async function clientProtocolNotifications(
  language: SdkLanguage,
  source: URL,
  registry: ReadonlyMap<string, string>,
): Promise<string[]> {
  const extension = language === "typescript" ? ".ts" : language === "python" ? ".py" : ".go";
  const files = (await readdir(source, { recursive: true }))
    .filter((file) => file.endsWith(extension))
    .sort();
  const notifications = new Set<string>();

  for (const file of files) {
    const root = parse(language, await readFile(new URL(file, source), "utf8")).root();
    if (language === "typescript") {
      for (const member of root.findAll({ rule: { kind: "member_expression" } })) {
        if (!member.text().startsWith("StagehandNotifications.")) continue;
        const registryKey = member.text().slice("StagehandNotifications.".length);
        const wireName = registry.get(registryKey);
        if (wireName) notifications.add(wireName);
      }
      continue;
    }

    if (language === "go") {
      for (const call of root.findAll({ rule: { kind: "call_expression" } })) {
        const calledFunction = namedChildren(call)[0]?.text();
        const arguments_ = callArguments(call);
        const notification = calledFunction?.endsWith(".onNotification")
          ? arguments_[0]
          : calledFunction === "registerNotification"
            ? arguments_[1]
            : undefined;
        if (notification?.kind() === "interpreted_string_literal") {
          notifications.add(stringLiteral(notification));
        }
      }
      continue;
    }

    for (const call of root.findAll({ rule: { kind: "call" } })) {
      const calledFunction = namedChildren(call)[0]?.text();
      if (!calledFunction?.endsWith(".on_notification")) continue;
      const notification = callArguments(call)[0];
      if (notification?.kind() === "string") notifications.add(stringLiteral(notification));
    }
  }

  return [...notifications].sort();
}

async function pythonNotificationBindings(): Promise<
  Array<{ notification: string; paramsModel: string }>
> {
  const files = (await readdir(pythonSource, { recursive: true }))
    .filter((file) => file.endsWith(".py"))
    .sort();
  const bindings: Array<{ notification: string; paramsModel: string }> = [];

  for (const file of files) {
    const root = parse("python", await readFile(new URL(file, pythonSource), "utf8")).root();
    for (const call of root.findAll({ rule: { kind: "call" } })) {
      const calledFunction = namedChildren(call)[0]?.text();
      if (!calledFunction?.endsWith(".on_notification")) continue;
      const [notification, paramsModel] = callArguments(call);
      if (notification?.kind() !== "string" || !paramsModel) continue;
      bindings.push({
        notification: stringLiteral(notification),
        paramsModel: paramsModel.text().split(".").at(-1) ?? paramsModel.text(),
      });
    }
  }

  return bindings;
}

async function protocolMethods(): Promise<Record<string, ProtocolMethod>> {
  return (await protocolDocument()).properties.methods.properties;
}

async function protocolDocument(): Promise<ProtocolDocument> {
  return JSON.parse(await readFile(protocolUrl, "utf8")) as ProtocolDocument;
}

async function publicRpcMethods(
  language: SdkLanguage,
  registry: ReadonlyMap<string, string>,
): Promise<PublicRpcMethod[]> {
  const methods: PublicRpcMethod[] = [];

  for (const [className, typescriptFile, pythonFile, goFile, goType] of sdkObjects) {
    const file =
      language === "typescript" ? typescriptFile : language === "python" ? pythonFile : goFile;
    const source =
      language === "typescript"
        ? typescriptSource
        : language === "python"
          ? pythonSource
          : goSource;
    const typeName = language === "go" ? goType : className;
    const fileUrl = new URL(file, source);
    const root = parse(language, await readFile(fileUrl, "utf8")).root();
    const classNode = findClass(root, language, typeName);
    if (!classNode) continue;

    for (const candidate of directClassMethods(classNode, language, typeName)) {
      if (!isPublicCallable(candidate, language)) continue;
      for (const call of protocolCalls(candidate.node, language)) {
        const methodNode = protocolMethodNode(call, language);
        if (!methodNode) continue;
        methods.push({
          method: candidate.node,
          wireMethod: wireMethodForCall(methodNode, language, registry),
        });
      }
    }
  }

  if (language === "go") {
    const extract = await goExtractFunction();
    if (extract) {
      for (const call of protocolCalls(extract, "go")) {
        const methodNode = protocolMethodNode(call, "go");
        if (!methodNode) continue;
        methods.push({
          method: extract,
          wireMethod: wireMethodForCall(methodNode, "go", registry),
        });
      }
    }
  }

  return methods;
}

async function pythonRpcCalls(): Promise<PythonRpcCall[]> {
  const files = (await readdir(pythonSource, { recursive: true }))
    .filter((file) => file.endsWith(".py"))
    .sort();
  const calls: PythonRpcCall[] = [];

  for (const file of files) {
    const root = parse("python", await readFile(new URL(file, pythonSource), "utf8")).root();
    for (const call of protocolCalls(root, "python")) {
      const [methodNode, params, result] = callArguments(call);
      const scope = call.ancestors().find((ancestor) => ancestor.kind() === "function_definition");
      if (!methodNode || !params || !result || !scope || methodNode.kind() !== "string") continue;

      calls.push({ file, method: stringLiteral(methodNode), module: root, params, result, scope });
    }
  }

  return calls;
}

async function goRpcCalls(): Promise<GoRpcCall[]> {
  const files = (await readdir(goSource, { recursive: true }))
    .filter((file) => file.endsWith(".go") && !file.endsWith("_test.go"))
    .sort();
  const calls: GoRpcCall[] = [];

  for (const file of files) {
    const root = parse("go", await readFile(new URL(file, goSource), "utf8")).root();
    for (const call of protocolCalls(root, "go")) {
      const arguments_ = callArguments(call);
      const methodNode = protocolMethodNode(call, "go");
      const calledFunction = namedChildren(call)[0]?.text();
      if (!calledFunction?.endsWith(".call")) continue;
      const params = arguments_[2];
      const result = arguments_[3];
      const scope = call
        .ancestors()
        .find(
          (ancestor) =>
            ancestor.kind() === "method_declaration" || ancestor.kind() === "function_declaration",
        );
      if (!methodNode || !params || !result || !scope) continue;

      calls.push({
        file,
        method: stringLiteral(methodNode),
        module: root,
        params,
        result,
        scope,
      });
    }
  }

  return calls;
}

function protocolCalls(node: SgNode, language: SdkLanguage, boundary?: RequestBoundary): SgNode[] {
  const callKind = language === "python" ? "call" : "call_expression";
  return node.findAll({ rule: { kind: callKind } }).filter((call) => {
    const calledFunction = namedChildren(call)[0]?.text();
    const isProtocolBoundary = boundary
      ? matchesProtocolBoundary(calledFunction, language, boundary)
      : matchesProtocolBoundary(calledFunction, language, "outbound") ||
        matchesProtocolBoundary(calledFunction, language, "inbound");
    if (!isProtocolBoundary) return false;
    const method = protocolMethodNode(call, language);
    return language === "typescript"
      ? method?.text().startsWith("StagehandMethods.") === true
      : language === "python"
        ? method?.kind() === "string"
        : method?.kind() === "interpreted_string_literal";
  });
}

function matchesProtocolBoundary(
  calledFunction: string | undefined,
  language: SdkLanguage,
  boundary: RequestBoundary,
): boolean {
  if (boundary === "outbound") {
    return language === "go"
      ? calledFunction?.endsWith(".call") === true
      : calledFunction?.endsWith(".send") === true || calledFunction?.endsWith("?.send") === true;
  }
  return language === "typescript"
    ? calledFunction?.endsWith(".onRequest") === true ||
        calledFunction?.endsWith("?.onRequest") === true
    : language === "python"
      ? calledFunction?.endsWith(".on_request") === true
      : calledFunction?.endsWith(".onRequest") === true;
}

type DirectClassMethod = {
  node: SgNode;
  decoratedDefinition?: SgNode;
  className: string;
};

function findClass(root: SgNode, language: SdkLanguage, className: string): SgNode | undefined {
  if (language === "go") {
    const declaration = root.findAll({ rule: { kind: "type_spec" } }).find((node) => {
      const name = namedChildren(node)[0];
      return name?.text() === className;
    });
    return declaration ? root : undefined;
  }
  const classKind = language === "typescript" ? "class_declaration" : "class_definition";
  return root
    .findAll({ rule: { kind: classKind } })
    .find((node) => namedChildren(node).some((child) => child.text() === className));
}

function directClassMethods(
  classNode: SgNode,
  language: SdkLanguage,
  className: string,
): DirectClassMethod[] {
  if (language === "go") {
    return namedChildren(classNode)
      .filter((child) => child.kind() === "method_declaration")
      .filter((method) => {
        const receiver = namedChildren(method)[0]?.text() ?? "";
        return new RegExp(`\\*?${className}\\b`, "u").test(receiver);
      })
      .map((node) => ({ node, className }));
  }
  const bodyKind = language === "typescript" ? "class_body" : "block";
  const methodKind = language === "typescript" ? "method_definition" : "function_definition";
  const body = namedChildren(classNode).find((child) => child.kind() === bodyKind);
  if (!body) return [];

  return namedChildren(body).flatMap((child) => {
    if (child.kind() === methodKind) return [{ node: child, className }];
    if (language !== "python" || child.kind() !== "decorated_definition") return [];
    const method = namedChildren(child).find((nested) => nested.kind() === methodKind);
    return method ? [{ node: method, decoratedDefinition: child, className }] : [];
  });
}

function methodName(method: SgNode, language: SdkLanguage): SgNode | undefined {
  const nameKind =
    language === "typescript"
      ? "property_identifier"
      : language === "python"
        ? "identifier"
        : "field_identifier";
  return namedChildren(method).find((child) => child.kind() === nameKind);
}

function publicParameterTypes(method: SgNode, language: SdkLanguage): Map<string, string> {
  const parameters = method.field("parameters");
  if (!parameters) return new Map();

  return new Map(
    namedChildren(parameters).flatMap((parameter) => {
      const name = parameterName(parameter, language);
      if (!name || name === "self" || name === "cls") return [];
      const type =
        language === "go"
          ? (namedChildren(parameter).at(-1)?.text() ?? "")
          : (parameter.field("type")?.text().replace(/^:\s*/u, "") ?? "");
      return [[name, type] as const];
    }),
  );
}

function parameterName(parameter: SgNode, language: SdkLanguage): string | undefined {
  if (language === "typescript") {
    const pattern = parameter.field("pattern") ?? parameter.field("name");
    if (pattern?.kind() === "identifier") return pattern.text();
    return parameter.kind() === "identifier" ? parameter.text() : undefined;
  }

  if (language === "go") {
    const name = namedChildren(parameter)[0];
    return name?.kind() === "identifier" ? name.text() : undefined;
  }

  if (parameter.kind() === "identifier") return parameter.text();
  const namedParameter = parameter.field("name") ?? parameter.field("pattern");
  const nameNode = namedParameter ?? parameter;
  if (nameNode.kind() === "identifier") return nameNode.text();
  return nameNode.find({ rule: { kind: "identifier" } })?.text();
}

function publicPrimitiveType(schema: JsonSchema, language: SdkLanguage): string | undefined {
  if (Array.isArray(schema.type) || !schema.type) return undefined;
  if (language === "typescript") {
    if (schema.type === "number" || schema.type === "integer") return "number";
    if (schema.type === "string") return "string";
    if (schema.type === "boolean") return "boolean";
    return undefined;
  }
  if (language === "go") {
    if (schema.type === "number") return "float64";
    if (schema.type === "integer") return "int";
    if (schema.type === "string") return "string";
    if (schema.type === "boolean") return "bool";
    return undefined;
  }
  if (schema.type === "number") return "float";
  if (schema.type === "integer") return "int";
  if (schema.type === "string") return "str";
  if (schema.type === "boolean") return "bool";
  return undefined;
}

function typeCompatibleWithPrimitive(type: string, expected: string, schema: JsonSchema): boolean {
  if (new RegExp(`(?:^|[^A-Za-z0-9_])${expected}(?:$|[^A-Za-z0-9_])`, "u").test(type)) {
    return true;
  }
  if (expected !== "str" || !schema.enum?.every((value) => typeof value === "string")) {
    return false;
  }
  const literal = type.match(/\bLiteral\[([^\]]+)\]/u)?.[1];
  if (!literal) return false;
  const values = [...literal.matchAll(/["']([^"']+)["']/gu)].map((match) => match[1]);
  return schema.enum.every((value) => values.includes(value as string));
}

function isPublicCallable(method: DirectClassMethod, language: SdkLanguage): boolean {
  const name = methodName(method.node, language);
  if (!name) return false;

  if (language === "go") {
    return /^[A-Z]/u.test(name.text()) && !goAccessors[method.className]?.has(name.text());
  }

  if (language === "python") {
    return (
      !name.text().startsWith("_") && !method.decoratedDefinition?.text().startsWith("@property")
    );
  }

  if (name.text() === "constructor") return false;

  const declarationPrefix = method.node.text().slice(0, method.node.text().indexOf(name.text()));
  return (
    !/\b(?:private|protected)\b/u.test(declarationPrefix) &&
    !/\b(?:get|set)\s*$/u.test(declarationPrefix)
  );
}

function wireMethodForCall(
  method: SgNode,
  language: SdkLanguage,
  registry: ReadonlyMap<string, string>,
): string {
  if (language === "python" || language === "go") return stringLiteral(method);

  const registryKey = method.text().slice("StagehandMethods.".length);
  const wireMethod = registry.get(registryKey);
  if (!wireMethod) throw new Error(`Unknown StagehandMethods entry: ${method.text()}`);
  return wireMethod;
}

function callArguments(call: SgNode): SgNode[] {
  const argumentsNode = namedChildren(call)[1];
  return argumentsNode ? namedChildren(argumentsNode) : [];
}

function protocolMethodNode(call: SgNode, language: SdkLanguage): SgNode | undefined {
  const arguments_ = callArguments(call);
  if (language !== "go") return arguments_[0];
  const calledFunction = namedChildren(call)[0]?.text();
  return calledFunction?.endsWith(".call") ? arguments_[1] : arguments_[0];
}

function pythonModelName(
  expression: SgNode,
  scope: SgNode,
  module: SgNode,
  seen = new Set<string>(),
): string | undefined {
  if (expression.kind() === "call") {
    const called = namedChildren(expression)[0];
    const model = called
      ?.text()
      .replace(/\.model_validate$/, "")
      .split(".")
      .at(-1);
    return model && /^_?[A-Z]/u.test(model) ? model : undefined;
  }

  if (expression.kind() === "attribute") {
    const model = expression.text().split(".").at(-1);
    return model && /^_?[A-Z]/u.test(model) ? model : undefined;
  }

  if (expression.kind() !== "identifier") return undefined;
  if (/^_?[A-Z]/u.test(expression.text())) return expression.text();
  if (seen.has(expression.text())) return undefined;
  seen.add(expression.text());
  const assignment = [
    ...scope.findAll({ rule: { kind: "assignment" } }),
    ...module
      .findAll({ rule: { kind: "assignment" } })
      .filter(
        (candidate) =>
          !candidate
            .ancestors()
            .some(
              (ancestor) =>
                ancestor.kind() === "function_definition" || ancestor.kind() === "class_definition",
            ),
      ),
  ].find((candidate) => namedChildren(candidate)[0]?.text() === expression.text());
  const assignedValue = assignment && namedChildren(assignment)[1];
  return assignedValue ? pythonModelName(assignedValue, scope, module, seen) : undefined;
}

function goModelName(
  expression: SgNode,
  scope: SgNode,
  module: SgNode,
  seen = new Set<string>(),
): string | undefined {
  if (expression.kind() === "unary_expression" || expression.kind() === "expression_list") {
    const nested = namedChildren(expression)[0];
    return nested ? goModelName(nested, scope, module, seen) : undefined;
  }

  if (expression.kind() === "composite_literal") {
    const type = namedChildren(expression)[0];
    return type?.kind() === "type_identifier" ? type.text() : undefined;
  }

  if (expression.kind() !== "identifier") return undefined;
  if (/^[A-Z]/u.test(expression.text())) return expression.text();
  if (seen.has(expression.text())) return undefined;
  seen.add(expression.text());

  const variable = scope
    .findAll({ rule: { kind: "var_spec" } })
    .find((candidate) => namedChildren(candidate)[0]?.text() === expression.text());
  if (variable) {
    const type = namedChildren(variable)[1];
    return type?.text();
  }

  const assignment = [
    ...scope.findAll({ rule: { kind: "short_var_declaration" } }),
    ...module
      .findAll({ rule: { kind: "short_var_declaration" } })
      .filter(
        (candidate) =>
          !candidate
            .ancestors()
            .some(
              (ancestor) =>
                ancestor.kind() === "method_declaration" ||
                ancestor.kind() === "function_declaration",
            ),
      ),
  ].find((candidate) => {
    const names = namedChildren(candidate)[0];
    return namedChildren(names).some((name) => name.text() === expression.text());
  });
  const assignedValues = assignment && namedChildren(assignment)[1];
  const assignedValue = assignedValues && namedChildren(assignedValues)[0];
  return assignedValue ? goModelName(assignedValue, scope, module, seen) : undefined;
}

function referencedModel(reference: string): string {
  const model = reference.split("/").at(-1);
  if (!model) throw new Error(`Invalid local JSON Schema reference: ${reference}`);
  return model;
}

function referencedGoModel(reference: string): string {
  return referencedModel(reference)
    .replaceAll("Html", "HTML")
    .replaceAll("Url", "URL")
    .replaceAll("Id", "ID");
}

function stringLiteral(node: SgNode): string {
  const text = node.text();
  const quote = text[0];
  if ((quote !== '"' && quote !== "'" && quote !== "`") || text.at(-1) !== quote) {
    throw new Error(`Expected a string literal, received ${text}`);
  }
  return text.slice(1, -1);
}

function snakeCase(name: string): string {
  return name
    .replace(/([A-Z]+)([A-Z][a-z])/gu, "$1_$2")
    .replace(/([a-z\d])([A-Z])/gu, "$1_$2")
    .toLowerCase();
}

function camelCase(name: string): string {
  return name.replace(/_([a-z])/gu, (_, letter: string) => letter.toUpperCase());
}

function exportedGoName(name: string): string {
  return name
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("")
    .replaceAll("Html", "HTML")
    .replaceAll("Url", "URL")
    .replaceAll("Id", "ID");
}

function namedChildren(node: SgNode): SgNode[] {
  return node.children().filter((child) => child.isNamed());
}
