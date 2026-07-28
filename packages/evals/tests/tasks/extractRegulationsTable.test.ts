import { describe, expect, it, vi } from "vitest";
import type { BenchTaskContext } from "../../framework/types.js";
import { EvalLogger } from "../../logger.js";
import task from "../../tasks/bench/extract/extract_regulations_table.js";

const allottee = {
  allottee_name: "Example Telecom",
  area: "Example Area",
  area_code: "012",
  access_code: "345",
};

function makeContext(
  expectedAllottees: (typeof allottee)[],
  extractedAllottees: (typeof allottee)[],
) {
  return {
    stagehand: {
      extract: vi.fn(async () => ({
        data: { allottee_list: extractedAllottees },
      })),
    },
    page: {
      goto: vi.fn(async () => {}),
      evaluate: vi.fn(async () => expectedAllottees),
    },
    logger: new EvalLogger(false),
    input: {
      name: "extract/extract_regulations_table",
      modelName: "openai/gpt-4.1-mini",
    },
    modelName: "openai/gpt-4.1-mini",
    debugUrl: "",
    sessionUrl: "",
  } as unknown as BenchTaskContext;
}

describe("extract_regulations_table", () => {
  it("rejects empty page-derived ground truth instead of passing empty extraction", async () => {
    const result = await task.fn(makeContext([], []));

    expect(result).toMatchObject({
      _success: false,
      error: "Error: Expected regulations table contained no allottee rows",
    });
  });

  it("passes when extracted rows exactly match the page-derived ground truth", async () => {
    const result = await task.fn(makeContext([allottee], [allottee]));

    expect(result).toMatchObject({ _success: true });
  });
});
