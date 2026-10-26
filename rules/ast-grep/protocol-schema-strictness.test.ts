import { readFile } from "node:fs/promises";
import { parse } from "@ast-grep/napi";
import { describe, expect, it } from "vitest";

const protocolSchemasUrl = new URL("../../packages/protocol/schemas.ts", import.meta.url);

describe("Protocol schema object strictness", () => {
  it("uses z.strictObject for every object schema in schemas.ts", async () => {
    const root = parse("typescript", await readFile(protocolSchemasUrl, "utf8")).root();

    // Dynamic data must live in explicit z.json() or z.record() fields inside a strict object.
    const forbiddenObjectApis = [
      ["z.object", "z.object($$$ARGS)"],
      ["z.looseObject", "z.looseObject($$$ARGS)"],
      [".strict()", "$SCHEMA.strict()"],
      [".loose()", "$SCHEMA.loose()"],
      [".passthrough()", "$SCHEMA.passthrough()"],
      [".catchall()", "$SCHEMA.catchall($$$ARGS)"],
    ] as const;

    const violations = forbiddenObjectApis.flatMap(([name, pattern]) =>
      root.findAll({ rule: { pattern } }).map(() => name),
    );

    expect(violations, "All object schemas in schemas.ts must use z.strictObject").toStrictEqual(
      [],
    );
  });
});
