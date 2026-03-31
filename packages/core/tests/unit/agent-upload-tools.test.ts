import { describe, expect, it, vi } from "vitest";
import { V3 } from "../../lib/v3/v3.js";
import {
  createAgentTools,
  createCuaAgentTools,
} from "../../lib/v3/agent/tools/index.js";

function createStubV3(): V3 {
  return {
    logger: vi.fn(),
    browserbaseApiKey: undefined,
    isAgentReplayActive: () => false,
    recordAgentReplayStep: vi.fn(),
  } as unknown as V3;
}

describe("agent upload tool registration", () => {
  it("includes upload in DOM and hybrid toolsets", () => {
    const v3 = createStubV3();

    expect(createAgentTools(v3, { mode: "dom" })).toHaveProperty("upload");
    expect(createAgentTools(v3, { mode: "hybrid" })).toHaveProperty("upload");
  });

  it("adds built-in upload to CUA tools", () => {
    const v3 = createStubV3();
    const tools = createCuaAgentTools(v3);

    expect(tools).toHaveProperty("upload");
  });

  it("lets user-provided CUA tools override the built-in upload tool", () => {
    const v3 = createStubV3();
    const customUpload = { description: "custom upload tool" };
    const tools = createCuaAgentTools(v3, {
      upload: customUpload as never,
    });

    expect(tools.upload).toBe(customUpload);
  });
});
