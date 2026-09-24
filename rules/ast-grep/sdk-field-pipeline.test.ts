import { readdir, readFile } from "node:fs/promises";
import { basename } from "node:path";
import go from "@ast-grep/lang-go";
import python from "@ast-grep/lang-python";
import { parse, registerDynamicLanguage, type SgNode } from "@ast-grep/napi";
import { describe, expect, it } from "vitest";

registerDynamicLanguage({ go, python });

type Language = "go" | "python" | "typescript";

type JsonSchema = {
  $ref?: string;
  allOf?: JsonSchema[];
  anyOf?: JsonSchema[];
  const?: unknown;
  oneOf?: JsonSchema[];
  properties?: Record<string, JsonSchema>;
  type?: string | string[];
};

type ProtocolMethod = {
  properties: {
    params: JsonSchema;
    result: JsonSchema;
  };
};

type ProtocolDocument = JsonSchema & {
  $defs: Record<string, JsonSchema>;
  properties: {
    methods: { properties: Record<string, ProtocolMethod> };
  };
};

type RpcCall = {
  call: SgNode;
  file: string;
  language: Language;
  module: SgNode;
  params: SgNode;
  result?: SgNode;
  scope: SgNode;
  wireMethod: string;
};

const sources = {
  typescript: new URL("../../packages/sdk-ts/src/", import.meta.url),
  python: new URL("../../packages/sdk-python/src/stagehand/", import.meta.url),
  go: new URL("../../packages/sdk-go/", import.meta.url),
} as const;
const protocolUrl = new URL("../../packages/protocol/stagehand.v4.json", import.meta.url);
const registryUrl = new URL("../../packages/protocol/schema-registry.ts", import.meta.url);
const referenceUrl = new URL("../../packages/docs/v4/reference/", import.meta.url);

describe("Every public SDK field participates in the protocol pipeline", () => {
  it("constructs every declared request field in every SDK", async () => {
    const [protocol, calls, helperBodies] = await Promise.all([
      protocolDocument(),
      publicRpcCalls(),
      callableBodies(),
    ]);
    const missing: string[] = [];

    for (const call of calls) {
      const method = protocol.properties.methods.properties[call.wireMethod];
      if (!method) continue;
      const params = resolveSchema(protocol, method.properties.params);
      const topLevelFields = Object.keys(schemaProperties(protocol, params));
      if (topLevelFields.length === 0 || isWholeParamsReference(call.params)) continue;

      const scopeText = call.scope.text();
      const tokens = semanticTokens(
        `${scopeText}\n${relatedHelperBodies(call.scope, call.language, helperBodies)}`,
      );
      const descriptorFields = Object.keys(
        schemaProperties(protocol, protocol.$defs.LocatorDescriptor ?? {}),
      );

      for (const field of topLevelFields) {
        const normalized = snakeCase(field);
        const coveredByDescriptor =
          /descriptor/u.test(scopeText) &&
          descriptorFields.some((descriptorField) => snakeCase(descriptorField) === normalized);
        if (!tokens.has(normalized) && !coveredByDescriptor) {
          missing.push(`${call.language} ${call.wireMethod}: request field ${field}`);
        }
      }

      for (const [field, fieldSchema] of Object.entries(schemaProperties(protocol, params))) {
        const nestedFields = nestedFieldNames(protocol, fieldSchema);
        if (nestedFields.length === 0) continue;
        if (directlyForwardsParameter(call.params, field, scopeText)) continue;

        const extendedText = `${scopeText}\n${relatedHelperBodies(
          call.scope,
          call.language,
          helperBodies,
        )}`;
        // A rest spread forwards newly added fields automatically. Explicitly transformed
        // fields remain visible beside the spread.
        if (/\.\.\.[A-Za-z_$][A-Za-z0-9_$]*\b/u.test(extendedText)) continue;
        const extendedTokens = semanticTokens(extendedText);
        for (const nestedField of nestedFields) {
          if (!extendedTokens.has(snakeCase(nestedField))) {
            missing.push(
              `${call.language} ${call.wireMethod}: nested request field ${field}.${nestedField}`,
            );
          }
        }
      }
    }

    expect(
      missing.sort(),
      "Every protocol request field must be visibly constructed, forwarded wholesale, or handled by a complete adapter",
    ).toEqual([]);
  }, 15_000);

  it("consumes every declared result field in every SDK", async () => {
    const [protocol, calls] = await Promise.all([protocolDocument(), publicRpcCalls()]);
    const missing: string[] = [];

    for (const call of calls) {
      const method = protocol.properties.methods.properties[call.wireMethod];
      if (!method) continue;
      const fields = Object.entries(
        schemaProperties(protocol, resolveSchema(protocol, method.properties.result)),
      )
        .filter(([, schema]) => resolveSchema(protocol, schema).const === undefined)
        .map(([field]) => field);
      if (fields.length === 0 || callReturnsTransportResult(call)) continue;

      const resultName = resultBinding(call);
      if (!resultName) continue;
      const scopeText = call.scope.text();
      if (
        returnsOrSpreads(scopeText, resultName) ||
        passesResultWhole(call, resultName) ||
        assignsResultWhole(call, resultName)
      ) {
        continue;
      }

      for (const field of fields) {
        if (!usesResultField(scopeText, resultName, field)) {
          missing.push(`${call.language} ${call.wireMethod}: result field ${field}`);
        }
      }
    }

    expect(
      missing.sort(),
      "Every protocol result field must be returned wholesale, spread, or visibly consumed by the public wrapper",
    ).toEqual([]);
  });

  it("discovers every RPC-backed TypeScript object from source and gives it a reference page", async () => {
    const exportedModules = await typescriptExportedModules();
    const calls = (await publicRpcCalls()).filter(
      ({ file, language }) => language === "typescript" && exportedModules.has(file),
    );
    const discoveredPages = [
      ...new Set(
        calls.map(({ file }) =>
          snakeCase(basename(file, ".ts"))
            .replace(/^browser_/u, "")
            .replaceAll("_", "-"),
        ),
      ),
    ].sort();
    const referencePages = (await readdir(referenceUrl))
      .filter((file) => file.endsWith(".mdx"))
      .map((file) => basename(file, ".mdx"))
      .sort();

    expect(
      discoveredPages,
      "Every source file containing a public RPC-backed TypeScript method must have a reference page, and stale reference pages must be removed or classified elsewhere",
    ).toStrictEqual(referencePages);
  });
});

async function protocolDocument(): Promise<ProtocolDocument> {
  return JSON.parse(await readFile(protocolUrl, "utf8")) as ProtocolDocument;
}

function resolveSchema(protocol: ProtocolDocument, schema: JsonSchema): JsonSchema {
  if (!schema.$ref) return schema;
  const name = schema.$ref.match(/^#\/\$defs\/(.+)$/u)?.[1];
  if (!name || !protocol.$defs[name]) throw new Error(`Unknown schema reference ${schema.$ref}`);
  return protocol.$defs[name];
}

function schemaProperties(
  protocol: ProtocolDocument,
  schema: JsonSchema,
  seen = new Set<JsonSchema>(),
): Record<string, JsonSchema> {
  const resolved = resolveSchema(protocol, schema);
  if (seen.has(resolved)) return {};
  const nextSeen = new Set([...seen, resolved]);
  return Object.assign(
    {},
    resolved.properties ?? {},
    ...(resolved.allOf ?? []).map((part) => schemaProperties(protocol, part, nextSeen)),
    ...(resolved.anyOf ?? []).map((part) => schemaProperties(protocol, part, nextSeen)),
    ...(resolved.oneOf ?? []).map((part) => schemaProperties(protocol, part, nextSeen)),
  );
}

function nestedFieldNames(protocol: ProtocolDocument, schema: JsonSchema): string[] {
  const properties = schemaProperties(protocol, schema);
  return [...new Set(Object.keys(properties))];
}

async function sdkSourceFiles(source: URL, language: Language): Promise<string[]> {
  const extension = language === "typescript" ? ".ts" : language === "python" ? ".py" : ".go";
  return (await readdir(source, { recursive: true }))
    .filter(
      (file) =>
        file.endsWith(extension) &&
        !file.endsWith(`_test${extension}`) &&
        !file.endsWith(`.test${extension}`) &&
        !file.split("/").includes("tests") &&
        !file.split("/").includes("_generated"),
    )
    .sort();
}

async function publicRpcCalls(): Promise<RpcCall[]> {
  const [registry, exportedTypescriptModules] = await Promise.all([
    registryNames(),
    typescriptExportedModules(),
  ]);
  const calls = await Promise.all(
    (Object.entries(sources) as Array<[Language, URL]>).map(async ([language, source]) => {
      const files = await sdkSourceFiles(source, language);
      const languageCalls: RpcCall[] = [];

      for (const file of files) {
        if (language === "typescript" && !exportedTypescriptModules.has(file)) continue;
        const module = parse(language, await readFile(new URL(file, source), "utf8")).root();
        const callKind = language === "python" ? "call" : "call_expression";
        for (const call of module.findAll({ rule: { kind: callKind } })) {
          const called = namedChildren(call)[0]?.text();
          const isOutbound =
            language === "go"
              ? called?.endsWith(".call") === true
              : called?.endsWith(".send") === true || called?.endsWith("?.send") === true;
          if (!isOutbound) continue;
          const arguments_ = callArguments(call);
          const methodNode = language === "go" ? arguments_[1] : arguments_[0];
          const params = language === "go" ? arguments_[2] : arguments_[1];
          const result = language === "go" ? arguments_[3] : arguments_[2];
          const wireMethod = wireMethodName(methodNode, language, registry);
          const scope = enclosingScope(call, language);
          if (!wireMethod || !params || !scope || !isPublicScope(scope, language)) continue;
          languageCalls.push({
            call,
            file,
            language,
            module,
            params,
            result,
            scope,
            wireMethod,
          });
        }
      }
      return languageCalls;
    }),
  );
  return calls.flat();
}

async function registryNames(): Promise<Map<string, string>> {
  const root = parse("typescript", await readFile(registryUrl, "utf8")).root();
  const declaration = root.find({ rule: { pattern: "const StagehandMethods = $METHODS" } });
  const registry = declaration?.getMatch("METHODS")?.find({ rule: { kind: "object" } });
  if (!registry) throw new Error("StagehandMethods was not found");
  return new Map(
    namedChildren(registry).flatMap((entry) => {
      if (entry.kind() !== "pair") return [];
      const [key, value] = namedChildren(entry);
      const name = value
        ? namedChildren(value).find(
            (property) =>
              property.kind() === "pair" && namedChildren(property)[0]?.text() === "name",
          )
        : undefined;
      const wireName = name && namedChildren(name)[1];
      return key && wireName ? [[key.text(), stringLiteral(wireName)] as const] : [];
    }),
  );
}

function wireMethodName(
  method: SgNode | undefined,
  language: Language,
  registry: ReadonlyMap<string, string>,
): string | undefined {
  if (!method) return undefined;
  if (language === "typescript") {
    if (!method.text().startsWith("StagehandMethods.")) return undefined;
    return registry.get(method.text().slice("StagehandMethods.".length));
  }
  const expectedKind = language === "python" ? "string" : "interpreted_string_literal";
  return method.kind() === expectedKind ? stringLiteral(method) : undefined;
}

function enclosingScope(call: SgNode, language: Language): SgNode | undefined {
  const kinds =
    language === "typescript"
      ? new Set<string>(["method_definition", "function_declaration"])
      : language === "python"
        ? new Set<string>(["function_definition"])
        : new Set<string>(["method_declaration", "function_declaration"]);
  const scopes = call.ancestors().filter((ancestor) => kinds.has(String(ancestor.kind())));
  return language === "python" ? scopes.at(-1) : scopes[0];
}

function isPublicScope(scope: SgNode, language: Language): boolean {
  const name = scope.field("name")?.text() ?? firstNamedIdentifier(scope)?.text();
  if (!name) return false;
  if (language === "python") return !name.startsWith("_");
  if (language === "go") return /^[A-Z]/u.test(name);
  if (name === "constructor" || name.startsWith("#")) return false;
  const prefix = scope.text().slice(0, scope.text().indexOf(name));
  return !/\b(?:private|protected)\b/u.test(prefix);
}

function firstNamedIdentifier(node: SgNode): SgNode | undefined {
  return node
    .findAll({ rule: { kind: "identifier" } })
    .find((identifier) => identifier.text() !== "func" && identifier.text() !== "async");
}

function directlyForwardsParameter(params: SgNode, field: string, scopeText: string): boolean {
  const normalized = snakeCase(field);
  if (new RegExp(`["']?${field}["']?\\s*:\\s*${field}\\b`, "iu").test(scopeText)) {
    return true;
  }
  const occurrences = (params.text().match(/[A-Za-z_][A-Za-z0-9_]*/gu) ?? [])
    .map(snakeCase)
    .filter((token) => token === normalized).length;
  if (occurrences >= 2) return true;
  if (
    new RegExp(`(?:[{,]\\s*${field}\\s*[,}]|\\.\\.\\.[^{]*\\{\\s*${field}\\s*[,}])`, "u").test(
      params.text(),
    )
  ) {
    return true;
  }
  return [
    ...scopeText.matchAll(/["']?([A-Za-z_][A-Za-z0-9_]*)["']?\s*[:=]\s*([A-Za-z_][A-Za-z0-9_]*)/gu),
  ].some(
    (match) =>
      snakeCase(match[1] as string) === normalized && snakeCase(match[2] as string) === normalized,
  );
}

function isWholeParamsReference(params: SgNode): boolean {
  return (
    params.kind() === "member_expression" ||
    params.kind() === "attribute" ||
    params.kind() === "selector_expression"
  );
}

function callReturnsTransportResult(call: RpcCall): boolean {
  return call.call.ancestors().some((ancestor) => {
    if (ancestor.range().start.index < call.scope.range().start.index) return false;
    return ancestor.kind() === "return_statement";
  });
}

function resultBinding(call: RpcCall): string | undefined {
  if (call.language === "go") {
    return call.result
      ?.text()
      .replace(/^&/u, "")
      .match(/[A-Za-z_][A-Za-z0-9_]*/u)?.[0];
  }
  const assignmentKinds =
    call.language === "python"
      ? new Set<string>(["assignment"])
      : new Set<string>(["variable_declarator", "assignment_expression"]);
  const assignment = call.call
    .ancestors()
    .find(
      (ancestor) =>
        ancestor.range().start.index >= call.scope.range().start.index &&
        assignmentKinds.has(String(ancestor.kind())),
    );
  if (!assignment) return undefined;
  const left = assignment.field("name") ?? assignment.field("left") ?? namedChildren(assignment)[0];
  return left?.text().match(/[A-Za-z_][A-Za-z0-9_]*/u)?.[0];
}

function returnsOrSpreads(scopeText: string, resultName: string): boolean {
  return (
    new RegExp(`\\breturn(?:\\s+await)?\\s+${resultName}\\b`, "u").test(scopeText) ||
    new RegExp(`\\.\\.\\.${resultName}\\b`, "u").test(scopeText)
  );
}

function usesResultField(scopeText: string, resultName: string, field: string): boolean {
  return [
    ...scopeText.matchAll(new RegExp(`\\b${resultName}\\.([A-Za-z_][A-Za-z0-9_]*)`, "gu")),
  ].some((match) => snakeCase(match[1] as string) === snakeCase(field));
}

function passesResultWhole(call: RpcCall, resultName: string): boolean {
  const callKind = call.language === "python" ? "call" : "call_expression";
  const calls = [
    ...call.scope.findAll({ rule: { kind: callKind } }),
    ...(call.language === "typescript"
      ? call.scope.findAll({ rule: { kind: "new_expression" } })
      : []),
  ];
  return calls.some((candidate) => {
    if (candidate.range().start.index === call.call.range().start.index) return false;
    const called = namedChildren(candidate)[0]?.text();
    return (
      called?.startsWith(`${resultName}.`) === true ||
      callArguments(candidate).some(
        (argument) => argument.text().replace(/^[&*]/u, "") === resultName,
      )
    );
  });
}

function assignsResultWhole(call: RpcCall, resultName: string): boolean {
  const text = call.scope.text();
  if (
    new RegExp(
      `(?:[.#][A-Za-z_$][A-Za-z0-9_$]*[^\\n=]*?(?:\\?\\?=|=)|\\b[A-Za-z_$][A-Za-z0-9_$]*\\s*:)\\s*[&*]?${resultName}\\b`,
      "u",
    ).test(text)
  ) {
    return true;
  }
  const assignmentKinds =
    call.language === "python"
      ? ["assignment"]
      : call.language === "go"
        ? ["assignment_statement"]
        : ["assignment_expression"];
  return assignmentKinds.some((kind) =>
    call.scope.findAll({ rule: { kind } }).some((assignment) => {
      const children = namedChildren(assignment);
      const left = assignment.field("left") ?? children[0];
      const right = assignment.field("right") ?? children.at(-1);
      return left?.text() !== resultName && right?.text().replace(/^&/u, "") === resultName;
    }),
  );
}

async function callableBodies(): Promise<Map<Language, Map<string, string>>> {
  const entries = await Promise.all(
    (Object.entries(sources) as Array<[Language, URL]>).map(async ([language, source]) => {
      const files = await sdkSourceFiles(source, language);
      const bodies = new Map<string, string>();
      for (const file of files) {
        const root = parse(language, await readFile(new URL(file, source), "utf8")).root();
        const kinds =
          language === "typescript"
            ? ["function_declaration", "method_definition"]
            : language === "python"
              ? ["function_definition"]
              : ["function_declaration", "method_declaration"];
        for (const kind of kinds) {
          for (const callable of root.findAll({ rule: { kind } })) {
            const name = callable.field("name")?.text() ?? firstNamedIdentifier(callable)?.text();
            if (name) bodies.set(name, `${bodies.get(name) ?? ""}\n${callable.text()}`);
          }
        }
      }
      return [language, bodies] as const;
    }),
  );
  return new Map(entries);
}

function relatedHelperBodies(
  scope: SgNode,
  language: Language,
  helperBodies: ReadonlyMap<Language, ReadonlyMap<string, string>>,
): string {
  const bodies = helperBodies.get(language);
  if (!bodies) return "";
  const callKind = language === "python" ? "call" : "call_expression";
  return scope
    .findAll({ rule: { kind: callKind } })
    .flatMap((call) => {
      const called = namedChildren(call)[0]?.text().split(".").at(-1)?.replace(/^\?\./u, "");
      const body = called && bodies.get(called);
      return body ? [body] : [];
    })
    .join("\n");
}

async function typescriptExportedModules(): Promise<Set<string>> {
  const root = parse(
    "typescript",
    await readFile(new URL("index.ts", sources.typescript), "utf8"),
  ).root();
  const modules = new Set<string>();
  for (const statement of root.findAll({ rule: { kind: "export_statement" } })) {
    const source = statement
      .findAll({ rule: { kind: "string" } })
      .map(stringLiteral)
      .find((value) => value.startsWith("./"));
    if (!source) continue;
    modules.add(source.replace(/^\.\//u, "").replace(/\.js$/u, ".ts"));
  }
  return modules;
}

function semanticTokens(text: string): Set<string> {
  return new Set((text.match(/[A-Za-z_][A-Za-z0-9_]*/gu) ?? []).map(snakeCase));
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

function callArguments(call: SgNode): SgNode[] {
  const argumentsNode =
    call.field("arguments") ??
    namedChildren(call).find(
      (child) => child.kind() === "arguments" || child.kind() === "argument_list",
    );
  return argumentsNode ? namedChildren(argumentsNode) : [];
}

function namedChildren(node: SgNode): SgNode[] {
  return node.children().filter((child) => child.isNamed());
}

function stringLiteral(node: SgNode): string {
  return node.text().replace(/^['"`]|['"`]$/gu, "");
}
