import { afterEach, describe, expect, it, vi } from "vitest";

describe("zodCompat", () => {
  afterEach(() => {
    vi.resetModules();
    vi.doUnmock("zod");
    vi.doUnmock("zod/v4");
    vi.doUnmock("zod-to-json-schema");
  });

  it("uses zod/v4 JSON schema conversion when root zod lacks toJSONSchema", async () => {
    const schema = { _zod: { def: { type: "object" } } };
    const jsonSchema = {
      type: "object",
      properties: { ok: { type: "boolean" } },
    };
    const toJSONSchema = vi.fn(() => jsonSchema);

    vi.doMock("zod", () => ({ z: {} }));
    vi.doMock("zod/v4", () => ({ z: { toJSONSchema } }));
    vi.doMock("zod-to-json-schema", () => ({ default: vi.fn() }));

    const { toJsonSchema } = await import("../../lib/v3/zodCompat.js");

    expect(toJsonSchema(schema as never)).toBe(jsonSchema);
    expect(toJSONSchema).toHaveBeenCalledWith(schema);
  });
});
