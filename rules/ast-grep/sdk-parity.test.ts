import { readdir, readFile } from "node:fs/promises";
import python from "@ast-grep/lang-python";
import { parse, registerDynamicLanguage, type SgNode } from "@ast-grep/napi";
import { describe, expect, it } from "vite-plus/test";

registerDynamicLanguage({ python });

const sdkObjects = [
  ["Stagehand", "stagehand.ts", "stagehand.py"],
  ["BrowserContext", "browserContext.ts", "browser_context.py"],
  ["BrowserClipboard", "browserClipboard.ts", "browser_clipboard.py"],
  ["Page", "page.ts", "page.py"],
  ["Locator", "locator.ts", "locator.py"],
] as const;

const typescriptSource = new URL("../../packages/sdk-ts/src/", import.meta.url);
const pythonSource = new URL("../../packages/sdk-python/src/stagehand/", import.meta.url);
const protocolUrl = new URL("../../packages/protocol/stagehand.v4.json", import.meta.url);
const registryUrl = new URL("../../packages/protocol/schema-registry.ts", import.meta.url);

type SdkLanguage = "typescript" | "python";

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

describe("All language SDK operations remain in sync", () => {
  it("references every registered protocol operation in each client", async () => {
    const registry = await stagehandMethodNames();
    const registeredOperations = [...registry.values()].sort();

    expect(
      await clientProtocolOperations("typescript", typescriptSource, registry),
      "TypeScript must reference every StagehandMethods operation",
    ).toStrictEqual(registeredOperations);
    expect(
      await clientProtocolOperations("python", pythonSource, registry),
      "Python must reference every StagehandMethods operation",
    ).toStrictEqual(registeredOperations);
  });

  it("keeps every registered notification in the generated protocol and both clients", async () => {
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
  });

  it("exposes the same RPC-backed operations in TypeScript and Python", async () => {
    const registry = await stagehandMethodNames();

    for (const [className, typescriptFile, pythonFile] of sdkObjects) {
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

      expect(python, `${className} must expose the same RPC-backed operations`).toStrictEqual(
        typescript,
      );
      expect(
        typescript.length,
        `${className} must expose at least one RPC operation`,
      ).toBeGreaterThan(0);
    }
  });

  it("exposes the same public callable surface in TypeScript and Python", async () => {
    for (const [className, typescriptFile, pythonFile] of sdkObjects) {
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

      expect(python, `${className} public methods must remain in sync`).toStrictEqual(typescript);
      expect(typescript.length, `${className} must expose public methods`).toBeGreaterThan(0);
    }
  });

  it("exposes every protocol-backed option through a typed public SDK parameter", async () => {
    const [protocol, registry] = await Promise.all([protocolDocument(), stagehandMethodNames()]);
    const mismatches: string[] = [];

    for (const language of ["typescript", "python"] as const) {
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
          const publicName = language === "python" ? snakeCase(optionName) : camelCase(optionName);
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

    for (const language of ["typescript", "python"] as const) {
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
          const publicName = language === "python" ? snakeCase(wireName) : camelCase(wireName);
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
    const [typescript, python] = await Promise.all([
      readFile(new URL("index.ts", typescriptSource), "utf8"),
      readFile(new URL("__init__.py", pythonSource), "utf8"),
    ]);

    expect(typescript).not.toMatch(/export\s*\{[^}]*\bRPCClient\b/u);
    expect(python).not.toMatch(/["']RPCClient["']/u);
  });

  it("only calls methods declared by the generated protocol", async () => {
    const methods = await protocolMethods();

    for (const call of await pythonRpcCalls()) {
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
      const expectedResult = referencedModel(protocolMethod.properties.result.$ref);
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

  return directClassMethods(classNode, language)
    .filter((method) => isPublicCallable(method, language))
    .flatMap((method) => {
      const publicMethod = methodName(method.node, language);
      if (!publicMethod) return [];

      return protocolCalls(method.node, language).map((call) => {
        const methodNode = callArguments(call)[0];
        if (!methodNode) throw new Error(`${publicMethod.text()} has an RPC call without a method`);

        const wireMethod = wireMethodForCall(methodNode, language, registry);

        return {
          publicMethod: snakeCase(publicMethod.text()),
          wireMethod,
        };
      });
    })
    .sort((left, right) =>
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

  return [
    ...new Set(
      directClassMethods(classNode, language)
        .filter((method) => isPublicCallable(method, language))
        .flatMap((method) => {
          const name = methodName(method.node, language);
          return name ? [snakeCase(name.text())] : [];
        }),
    ),
  ].sort();
}

async function clientProtocolOperations(
  language: SdkLanguage,
  source: URL,
  registry: ReadonlyMap<string, string>,
): Promise<string[]> {
  const extension = language === "typescript" ? ".ts" : ".py";
  const files = (await readdir(source, { recursive: true }))
    .filter((file) => file.endsWith(extension))
    .sort();
  const operations = new Set<string>();

  for (const file of files) {
    const root = parse(language, await readFile(new URL(file, source), "utf8")).root();
    for (const call of protocolCalls(root, language)) {
      const method = callArguments(call)[0];
      if (method) operations.add(wireMethodForCall(method, language, registry));
    }
  }

  return [...operations].sort();
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
  const extension = language === "typescript" ? ".ts" : ".py";
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

  for (const [className, typescriptFile, pythonFile] of sdkObjects) {
    const file = language === "typescript" ? typescriptFile : pythonFile;
    const fileUrl = new URL(file, language === "typescript" ? typescriptSource : pythonSource);
    const root = parse(language, await readFile(fileUrl, "utf8")).root();
    const classNode = findClass(root, language, className);
    if (!classNode) continue;

    for (const candidate of directClassMethods(classNode, language)) {
      if (!isPublicCallable(candidate, language)) continue;
      for (const call of protocolCalls(candidate.node, language)) {
        const methodNode = callArguments(call)[0];
        if (!methodNode) continue;
        methods.push({
          method: candidate.node,
          wireMethod: wireMethodForCall(methodNode, language, registry),
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

function protocolCalls(node: SgNode, language: SdkLanguage): SgNode[] {
  const callKind = language === "typescript" ? "call_expression" : "call";
  return node.findAll({ rule: { kind: callKind } }).filter((call) => {
    const calledFunction = namedChildren(call)[0]?.text();
    const isProtocolBoundary =
      calledFunction?.endsWith(".send") === true ||
      calledFunction?.endsWith("?.send") === true ||
      (language === "typescript" &&
        (calledFunction?.endsWith(".onRequest") === true ||
          calledFunction?.endsWith("?.onRequest") === true)) ||
      (language === "python" && calledFunction?.endsWith(".on_request") === true);
    if (!isProtocolBoundary) return false;
    const method = callArguments(call)[0];
    return language === "typescript"
      ? method?.text().startsWith("StagehandMethods.") === true
      : method?.kind() === "string";
  });
}

type DirectClassMethod = {
  node: SgNode;
  decoratedDefinition?: SgNode;
};

function findClass(root: SgNode, language: SdkLanguage, className: string): SgNode | undefined {
  const classKind = language === "typescript" ? "class_declaration" : "class_definition";
  return root
    .findAll({ rule: { kind: classKind } })
    .find((node) => namedChildren(node).some((child) => child.text() === className));
}

function directClassMethods(classNode: SgNode, language: SdkLanguage): DirectClassMethod[] {
  const bodyKind = language === "typescript" ? "class_body" : "block";
  const methodKind = language === "typescript" ? "method_definition" : "function_definition";
  const body = namedChildren(classNode).find((child) => child.kind() === bodyKind);
  if (!body) return [];

  return namedChildren(body).flatMap((child) => {
    if (child.kind() === methodKind) return [{ node: child }];
    if (language !== "python" || child.kind() !== "decorated_definition") return [];
    const method = namedChildren(child).find((nested) => nested.kind() === methodKind);
    return method ? [{ node: method, decoratedDefinition: child }] : [];
  });
}

function methodName(method: SgNode, language: SdkLanguage): SgNode | undefined {
  const nameKind = language === "typescript" ? "property_identifier" : "identifier";
  return namedChildren(method).find((child) => child.kind() === nameKind);
}

function publicParameterTypes(method: SgNode, language: SdkLanguage): Map<string, string> {
  const parameters = method.field("parameters");
  if (!parameters) return new Map();

  return new Map(
    namedChildren(parameters).flatMap((parameter) => {
      const name = parameterName(parameter, language);
      if (!name || name === "self" || name === "cls") return [];
      return [[name, parameter.field("type")?.text().replace(/^:\s*/u, "") ?? ""] as const];
    }),
  );
}

function parameterName(parameter: SgNode, language: SdkLanguage): string | undefined {
  if (language === "typescript") {
    const pattern = parameter.field("pattern") ?? parameter.field("name");
    if (pattern?.kind() === "identifier") return pattern.text();
    return parameter.kind() === "identifier" ? parameter.text() : undefined;
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
  if (language === "python") return stringLiteral(method);

  const registryKey = method.text().slice("StagehandMethods.".length);
  const wireMethod = registry.get(registryKey);
  if (!wireMethod) throw new Error(`Unknown StagehandMethods entry: ${method.text()}`);
  return wireMethod;
}

function callArguments(call: SgNode): SgNode[] {
  const argumentsNode = namedChildren(call)[1];
  return argumentsNode ? namedChildren(argumentsNode) : [];
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
    return model && /^[A-Z]/u.test(model) ? model : undefined;
  }

  if (expression.kind() === "attribute") {
    const model = expression.text().split(".").at(-1);
    return model && /^[A-Z]/u.test(model) ? model : undefined;
  }

  if (expression.kind() !== "identifier") return undefined;
  if (/^[A-Z]/u.test(expression.text())) return expression.text();
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

function referencedModel(reference: string): string {
  const model = reference.split("/").at(-1);
  if (!model) throw new Error(`Invalid local JSON Schema reference: ${reference}`);
  return model;
}

function stringLiteral(node: SgNode): string {
  const text = node.text();
  const quote = text[0];
  if ((quote !== '"' && quote !== "'") || text.at(-1) !== quote) {
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

function namedChildren(node: SgNode): SgNode[] {
  return node.children().filter((child) => child.isNamed());
}
