import { readFile } from "node:fs/promises";
import go from "@ast-grep/lang-go";
import python from "@ast-grep/lang-python";
import ruby from "@ast-grep/lang-ruby";
import { parse, registerDynamicLanguage, type SgNode } from "@ast-grep/napi";
import { describe, expect, it } from "vitest";

registerDynamicLanguage({ go, python, ruby });

type Language = "go" | "python" | "ruby" | "typescript";

const languages = ["typescript", "python", "go", "ruby"] as const;

const clients = {
  typescript: {
    file: new URL("../../packages/sdk-ts/src/cdpClient.ts", import.meta.url),
    runtimeFile: new URL("../../packages/sdk-ts/src/runtimeCompatibility.ts", import.meta.url),
    typeName: "CDPClient",
  },
  python: {
    file: new URL("../../packages/sdk-python/src/stagehand/cdp_client.py", import.meta.url),
    runtimeFile: undefined,
    typeName: "CDPClient",
  },
  go: {
    file: new URL("../../packages/sdk-go/cdp_client.go", import.meta.url),
    runtimeFile: new URL("../../packages/sdk-go/runtime_compatibility.go", import.meta.url),
    typeName: "cdpClient",
  },
  ruby: {
    file: new URL("../../packages/sdk-ruby/lib/stagehand/cdp_client.rb", import.meta.url),
    runtimeFile: undefined,
    typeName: "CDPClient",
  },
} as const satisfies Record<
  Language,
  { file: URL; runtimeFile: URL | undefined; typeName: string }
>;

const capabilities = [
  {
    name: "outbound JSON-RPC transport",
    methods: { typescript: "send", python: "send", go: "Send", ruby: "send" },
  },
  {
    name: "correlated CDP commands",
    methods: {
      typescript: "sendCommand",
      python: "send_command",
      go: "sendCommand",
      ruby: "send_command",
    },
  },
  {
    name: "incoming CDP dispatch",
    methods: {
      typescript: "handleMessage",
      python: "_handle_message",
      go: "handleMessage",
      ruby: "handle_message",
    },
  },
  {
    name: "deterministic shutdown",
    methods: { typescript: "close", python: "close", go: "Close", ruby: "close" },
  },
] as const;

const sharedCDPCommands = [
  "Extensions.loadUnpacked",
  "Target.getTargets",
  "Target.attachToTarget",
  "Target.createTarget",
  "Target.closeTarget",
  "Runtime.enable",
  "Runtime.addBinding",
  "Runtime.evaluate",
] as const;

const runtimeBindingTokens = {
  typescript: "STAGEHAND_SEND_TO_HOST_BINDING",
  python: "__stagehandSendToHost",
  go: "__stagehandSendToHost",
  ruby: "__stagehandSendToHost",
} as const satisfies Record<Language, string>;

const pages = {
  typescript: {
    file: new URL("../../packages/sdk-ts/src/page.ts", import.meta.url),
    typeName: "Page",
    method: "on",
  },
  python: {
    file: new URL("../../packages/sdk-python/src/stagehand/page.py", import.meta.url),
    typeName: "Page",
    method: "on",
  },
  go: {
    file: new URL("../../packages/sdk-go/page.go", import.meta.url),
    typeName: "Page",
    method: "On",
  },
  ruby: {
    file: new URL("../../packages/sdk-ruby/lib/stagehand/page.rb", import.meta.url),
    typeName: "Page",
    method: "on",
  },
} as const satisfies Record<Language, { file: URL; typeName: string; method: string }>;

const subscriptions = {
  typescript: {
    file: new URL("../../packages/sdk-ts/src/page.ts", import.meta.url),
    typeName: "CDPSubscription",
    method: "unsubscribe",
  },
  python: {
    file: new URL("../../packages/sdk-python/src/stagehand/page.py", import.meta.url),
    typeName: "CDPSubscription",
    method: "unsubscribe",
  },
  go: {
    file: new URL("../../packages/sdk-go/page.go", import.meta.url),
    typeName: "CDPSubscription",
    method: "Close",
  },
  ruby: {
    file: new URL("../../packages/sdk-ruby/lib/stagehand/page.rb", import.meta.url),
    typeName: "CDPSubscription",
    method: "unsubscribe",
  },
} as const satisfies Record<Language, { file: URL; typeName: string; method: string }>;

describe("CDP clients retain the same core behavior", () => {
  it("exposes page event subscriptions in TypeScript, Python, Go, and Ruby", async () => {
    for (const language of languages) {
      const page = pages[language];
      const root = parse(language, await readFile(page.file, "utf8")).root();
      expect(
        clientMethods(root, language, page.typeName).has(page.method),
        `${language} Page must expose ${page.method}`,
      ).toBe(true);
    }
  });

  it("returns removable subscription handles in TypeScript, Python, Go, and Ruby", async () => {
    for (const language of languages) {
      const subscription = subscriptions[language];
      const root = parse(language, await readFile(subscription.file, "utf8")).root();
      expect(
        clientMethods(root, language, subscription.typeName).has(subscription.method),
        `${language} CDPSubscription must expose ${subscription.method}`,
      ).toBe(true);
    }
  });

  it("keeps the same transport lifecycle in TypeScript, Python, Go, and Ruby", async () => {
    const methods = new Map<Language, Set<string>>();

    for (const language of languages) {
      const client = clients[language];
      const root = parse(language, await readFile(client.file, "utf8")).root();
      methods.set(language, clientMethods(root, language, client.typeName));
    }

    for (const capability of capabilities) {
      for (const language of languages) {
        expect(
          methods.get(language)?.has(capability.methods[language]),
          `${language} CDP client must implement ${capability.name}`,
        ).toBe(true);
      }
    }
  });

  it("keeps extension discovery and runtime bridging aligned", async () => {
    const sources = await Promise.all(
      languages.map(async (language) => ({
        language,
        source: (
          await Promise.all(
            [clients[language].file, clients[language].runtimeFile]
              .filter((file): file is URL => file !== undefined)
              .map((file) => readFile(file, "utf8")),
          )
        ).join("\n"),
      })),
    );

    for (const { language, source } of sources) {
      for (const command of sharedCDPCommands) {
        expect(source, `${language} CDP client must issue ${command}`).toContain(command);
      }
      expect(source, `${language} must install the Stagehand runtime binding`).toContain(
        runtimeBindingTokens[language],
      );
      expect(source, `${language} must invoke the Stagehand runtime receiver`).toContain(
        "__stagehandReceiveFromHost",
      );
      expect(source, `${language} must verify the Stagehand runtime name`).toContain("stagehand");
      expect(source, `${language} must negotiate the protocol version`).toContain(
        "protocolVersion",
      );
      expect(source, `${language} must inspect runtime implementation metadata`).toContain(
        "serverInfo",
      );
      expect(source, `${language} must not use the legacy fixed runtime marker`).not.toContain(
        "stagehand.v4",
      );
      expect(source, `${language} must discover service workers`).toContain("service_worker");
      expect(source, `${language} must resolve browser HTTP endpoints`).toContain("/json/version");
    }
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

  if (language === "ruby") {
    const classNode = root
      .findAll({ rule: { kind: "class" } })
      .find((node) => namedChildren(node)[0]?.text() === typeName);
    // findAll instead of direct children: `public def x` wraps the method in
    // a visibility call node, and `class << self` nests class-level methods.
    return new Set(
      (classNode ? classNode.findAll({ rule: { kind: "method" } }) : []).flatMap((method) => {
        const name = namedChildren(method).find((child) => child.kind() === "identifier");
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
