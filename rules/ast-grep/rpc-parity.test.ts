import { readFile } from "node:fs/promises";
import go from "@ast-grep/lang-go";
import python from "@ast-grep/lang-python";
import { parse, registerDynamicLanguage, type SgNode } from "@ast-grep/napi";
import { describe, expect, it } from "vitest";

registerDynamicLanguage({ go, python });

type Language = "go" | "python" | "typescript";

const clients = {
  typescript: {
    file: new URL("../../packages/sdk-ts/src/rpcClient.ts", import.meta.url),
    typeName: "RPCClient",
  },
  python: {
    file: new URL("../../packages/sdk-python/src/stagehand/rpc_client.py", import.meta.url),
    typeName: "RPCClient",
  },
  go: {
    file: new URL("../../packages/sdk-go/rpc_client.go", import.meta.url),
    typeName: "rpcClient",
  },
} as const satisfies Record<Language, { file: URL; typeName: string }>;

const capabilities = [
  {
    name: "outbound requests",
    methods: { typescript: "send", python: "send", go: "call" },
  },
  {
    name: "inbound request handlers",
    methods: { typescript: "onRequest", python: "on_request", go: "onRequest" },
  },
  {
    name: "notification listeners",
    methods: {
      typescript: "onNotification",
      python: "on_notification",
      go: "onNotification",
    },
  },
  {
    name: "incoming message processing",
    methods: { typescript: "receive", python: "_read", go: "receive" },
  },
  {
    name: "deterministic shutdown",
    methods: { typescript: "close", python: "close", go: "close" },
  },
] as const;

describe("JSON-RPC clients retain the same core behavior", () => {
  it("keeps the same lifecycle capabilities in TypeScript, Python, and Go", async () => {
    const methods = new Map<Language, Set<string>>();

    for (const language of ["typescript", "python", "go"] as const) {
      const client = clients[language];
      const root = parse(language, await readFile(client.file, "utf8")).root();
      methods.set(language, clientMethods(root, language, client.typeName));
    }

    for (const capability of capabilities) {
      for (const language of ["typescript", "python", "go"] as const) {
        expect(
          methods.get(language)?.has(capability.methods[language]),
          `${language} RPC client must implement ${capability.name}`,
        ).toBe(true);
      }
    }
  });

  it("uses the protocol error codes and notification buffer bound in every client", async () => {
    const [protocol, typescript, pythonSource, goSource] = await Promise.all([
      readFile(new URL("../../packages/protocol/json-rpc/schemas.ts", import.meta.url), "utf8"),
      readFile(clients.typescript.file, "utf8"),
      readFile(clients.python.file, "utf8"),
      readFile(clients.go.file, "utf8"),
    ]);

    const errorCodes = [
      { code: "-32700", typescriptName: "parseError" },
      { code: "-32600", typescriptName: "invalidRequest" },
      { code: "-32601", typescriptName: "methodNotFound" },
      { code: "-32602", typescriptName: "invalidParams" },
      { code: "-32603", typescriptName: "internalError" },
    ] as const;
    for (const { code, typescriptName } of errorCodes) {
      expect(protocol, `protocol must declare JSON-RPC error ${code}`).toContain(code);
      expect(typescript, `TypeScript must use JSON-RPC error ${code}`).toContain(
        `JSONRPCErrorCodes.${typescriptName}`,
      );
      expect(pythonSource, `Python must use JSON-RPC error ${code}`).toContain(code);
      expect(goSource, `Go must use JSON-RPC error ${code}`).toContain(code);
    }
    expect(typescript).toMatch(/MAX_PENDING_NOTIFICATIONS\s*=\s*100/u);
    expect(pythonSource).toMatch(/_MAX_PENDING_NOTIFICATIONS\s*=\s*100/u);
    expect(goSource).toMatch(/maxPendingNotifications\s*=\s*100/u);
  });
});

function clientMethods(root: SgNode, language: Language, typeName: string): Set<string> {
  if (language === "go") {
    return new Set(
      namedChildren(root)
        .filter((node) => node.kind() === "method_declaration")
        .filter((method) => {
          const receiver = namedChildren(method)[0]?.text() ?? "";
          return new RegExp(`\\*?${typeName}\\b`, "u").test(receiver);
        })
        .flatMap((method) => {
          const name = namedChildren(method).find((child) => child.kind() === "field_identifier");
          return name ? [name.text()] : [];
        }),
    );
  }

  const classKind = language === "typescript" ? "class_declaration" : "class_definition";
  const bodyKind = language === "typescript" ? "class_body" : "block";
  const methodKind = language === "typescript" ? "method_definition" : "function_definition";
  const nameKind = language === "typescript" ? "property_identifier" : "identifier";
  const classNode = root
    .findAll({ rule: { kind: classKind } })
    .find((node) => namedChildren(node).some((child) => child.text() === typeName));
  const body = classNode
    ? namedChildren(classNode).find((child) => child.kind() === bodyKind)
    : undefined;

  return new Set(
    (body ? namedChildren(body) : [])
      .filter((method) => method.kind() === methodKind)
      .flatMap((method) => {
        const name = namedChildren(method).find((child) => child.kind() === nameKind);
        return name ? [name.text()] : [];
      }),
  );
}

function namedChildren(node: SgNode): SgNode[] {
  return node.children().filter((child) => child.isNamed());
}
