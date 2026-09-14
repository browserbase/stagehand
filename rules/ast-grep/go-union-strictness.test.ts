import { readdir, readFile } from "node:fs/promises";
import go from "@ast-grep/lang-go";
import { parse, registerDynamicLanguage, type SgNode } from "@ast-grep/napi";
import { describe, expect, it } from "vitest";

registerDynamicLanguage({ go });

const goSource = new URL("../../packages/sdk-go/", import.meta.url);
const protocolUrl = new URL("../../packages/protocol/stagehand.v4.json", import.meta.url);
const handwrittenUnionFiles = [
  "flexible_objects.go",
  "llm_unions.go",
  "object_unions.go",
  "scalar_unions.go",
] as const;

type ProtocolDocument = {
  $defs: Record<string, { additionalProperties?: boolean }>;
};

describe("Go handwritten union strictness", () => {
  it("decodes closed object variants through the strict helper", async () => {
    const closedTypes = await closedProtocolObjectTypes();
    closedTypes.add("CacheOptions");
    const violations: string[] = [];
    let strictHelperCalls = 0;

    for (const file of handwrittenUnionFiles) {
      const root = parse("go", await readFile(new URL(file, goSource), "utf8")).root();
      strictHelperCalls += root.findAll({
        rule: { pattern: "decodeStrictVariantJSON($DATA, &$TARGET)" },
      }).length;
      for (const call of root.findAll({
        rule: { pattern: "json.Unmarshal($DATA, &$TARGET)" },
      })) {
        const target = call.getMatch("TARGET");
        const scope = call
          .ancestors()
          .find(
            (ancestor) =>
              ancestor.kind() === "method_declaration" ||
              ancestor.kind() === "function_declaration",
          );
        if (!target || !scope) continue;
        const declaration = scope.find({
          rule: { pattern: `var ${target.text()} $TYPE` },
        });
        const decodedType = declaration?.getMatch("TYPE")?.text();
        if (decodedType && closedTypes.has(decodedType)) {
          violations.push(`${file}: json.Unmarshal into ${decodedType}`);
        }
      }
    }

    expect(strictHelperCalls, "Handwritten unions must use the strict decoder").toBeGreaterThan(0);
    expect(violations, "Closed Go union variants must use decodeStrictVariantJSON").toStrictEqual(
      [],
    );
  });

  it("does not add AdditionalProperties to closed protocol models", async () => {
    const closedTypes = await closedProtocolObjectTypes();
    const files = (await readdir(goSource))
      .filter((file) => file.endsWith(".go") && !file.endsWith("_test.go"))
      .sort();
    const violations: string[] = [];
    let inspectedClosedTypes = 0;

    for (const file of files) {
      const root = parse("go", await readFile(new URL(file, goSource), "utf8")).root();
      for (const type of root.findAll({ rule: { kind: "type_spec" } })) {
        const name = namedChildren(type).find((child) => child.kind() === "type_identifier");
        if (!name || !closedTypes.has(name.text())) continue;
        inspectedClosedTypes++;
        if (/\bAdditionalProperties\b/u.test(type.text())) {
          violations.push(`${file}: ${name.text()}`);
        }
      }
    }

    expect(inspectedClosedTypes, "The rule must inspect generated closed models").toBeGreaterThan(
      0,
    );
    expect(
      violations,
      "additionalProperties: false models must not expose AdditionalProperties",
    ).toStrictEqual([]);
  });
});

async function closedProtocolObjectTypes(): Promise<Set<string>> {
  const protocol = JSON.parse(await readFile(protocolUrl, "utf8")) as ProtocolDocument;
  return new Set(
    Object.entries(protocol.$defs)
      .filter(([, schema]) => schema.additionalProperties === false)
      .map(([name]) => name),
  );
}

function namedChildren(node: SgNode): SgNode[] {
  return node.children().filter((child) => child.isNamed());
}
