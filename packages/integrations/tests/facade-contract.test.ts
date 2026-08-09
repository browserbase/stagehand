import { describe, expect, it } from "vitest";
import {
  CodeModeRunInputSchema,
  FACADE_TOOLS,
  NAVIGATED_SNAPSHOT_ERROR,
  NO_HYDRATED_SNAPSHOT_ERROR,
  STALE_SNAPSHOT_ID_ERROR,
} from "../src/facade/contract.js";

describe("Stagehand facade contract", () => {
  it("pins the three tool names and descriptions", () => {
    expect(FACADE_TOOLS.map((tool) => tool.name)).toStrictEqual(["run", "snapshot", "screenshot"]);
    expect(FACADE_TOOLS[0].description).toContain('"op" (never "kind")');
    expect(FACADE_TOOLS[0].description).toContain('"id" (never "ref")');
    expect(FACADE_TOOLS[0].description).toContain('{"actions":[{"op":"click","id":"1-42"}]}');
    expect(FACADE_TOOLS[0].description).toContain(
      '{"actions":[{"op":"fill","id":"2-14","value":"Miami"}]}',
    );
    expect(FACADE_TOOLS[0].description).toContain(
      '{"actions":[{"op":"select","id":"3-9","values":"Lowest price"}]}',
    );
  });

  it("pins snapshot error punctuation", () => {
    expect(NO_HYDRATED_SNAPSHOT_ERROR).toBe(
      "No hydrated snapshot exists for the active page; call snapshot first.",
    );
    expect(NAVIGATED_SNAPSHOT_ERROR).toBe(
      "The active page navigated after its snapshot; call snapshot again.",
    );
    expect(STALE_SNAPSHOT_ID_ERROR).toBe(
      'Snapshot ID "${id}" is stale or not actionable; call snapshot again.',
    );
  });

  it("pins the run JSON schema", () => {
    const runSchema = FACADE_TOOLS[0].inputSchema;
    expect(Object.keys(runSchema.properties)).toStrictEqual(["code", "actions"]);
    expect(runSchema.oneOf).toStrictEqual([{ required: ["code"] }, { required: ["actions"] }]);
    expect(runSchema.additionalProperties).toBe(false);

    const actions = runSchema.properties.actions.items.oneOf;
    expect(actions.map((action) => Object.keys(action.properties))).toStrictEqual([
      ["op", "id"],
      ["op", "id"],
      ["op", "id", "value"],
      ["op", "id", "text", "delay"],
      ["op", "id", "key"],
      ["op", "id", "values"],
    ]);
    expect(actions.map((action) => action.required)).toStrictEqual([
      ["op", "id"],
      ["op", "id"],
      ["op", "id", "value"],
      ["op", "id", "text"],
      ["op", "id", "key"],
      ["op", "id", "values"],
    ]);
    expect(actions.every((action) => action.additionalProperties === false)).toBe(true);
    expect(actions[0].properties.op.description).toContain('never use a "kind" field');
    expect(actions[0].properties.id.description).toContain('never use "ref"');
  });

  it("pins snapshot and screenshot JSON schema properties", () => {
    expect(Object.keys(FACADE_TOOLS[1].inputSchema.properties)).toStrictEqual(["includeIframes"]);
    expect(Object.keys(FACADE_TOOLS[2].inputSchema.properties)).toStrictEqual([
      "fullPage",
      "type",
      "quality",
    ]);
    expect(FACADE_TOOLS[1].inputSchema.additionalProperties).toBe(false);
    expect(FACADE_TOOLS[2].inputSchema.additionalProperties).toBe(false);
  });

  it("requires exactly one of code or actions", () => {
    expect(CodeModeRunInputSchema.safeParse({ code: "return 1" }).success).toBe(true);
    expect(
      CodeModeRunInputSchema.safeParse({ actions: [{ op: "click", id: "1-42" }] }).success,
    ).toBe(true);
    expect(CodeModeRunInputSchema.safeParse({}).success).toBe(false);
    expect(
      CodeModeRunInputSchema.safeParse({
        code: "return 1",
        actions: [{ op: "click", id: "1-42" }],
      }).success,
    ).toBe(false);
  });
});
