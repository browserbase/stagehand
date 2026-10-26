import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { StagehandRpcRequestSchema } from "../../schema-registry.js";

const fixtureUrl = new URL("../fixtures/callback-batch-wire.json", import.meta.url);

describe("callback batch wire fixtures", () => {
  it("accepts page-omitted and page-provided SDK packets", async () => {
    const fixtures = JSON.parse(await readFile(fixtureUrl, "utf8")) as Record<string, unknown>;

    expect(Object.keys(fixtures).sort()).toStrictEqual(["pageOmitted", "pageProvided"]);
    for (const request of Object.values(fixtures)) {
      expect(() => StagehandRpcRequestSchema.parse(request)).not.toThrow();
    }
  });
});
