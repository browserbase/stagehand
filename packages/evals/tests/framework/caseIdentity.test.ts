import { describe, expect, it } from "vitest";
import {
  caseDisplayName,
  describeCase,
  domainOf,
  rowKey,
  shortCaseId,
} from "../../framework/caseIdentity.js";

const MODEL = "openai/gpt-5.4-mini" as const;

describe("describeCase", () => {
  it("reads hardbenchmark/webtailbench/webvoyager params (id, web, ques)", () => {
    expect(
      describeCase({
        params: {
          id: "47e314cc452c540524ffb7cf520285a3",
          web: "https://www.recreation.gov/",
          ques: "Find the park that offers the cheapest paddling permits.",
        },
      }),
    ).toEqual({
      id: "47e314cc452c540524ffb7cf520285a3",
      shortId: "47e314cc",
      domain: "recreation.gov",
      question: "Find the park that offers the cheapest paddling permits.",
    });
  });

  it("reads onlineMind2Web/odysseysbench params (task_id, website, confirmed_task)", () => {
    expect(
      describeCase({
        params: { task_id: "b7a3c1", website: "united.com", confirmed_task: "Cheapest SFO→JFK" },
      }),
    ).toEqual({
      id: "b7a3c1",
      shortId: "b7a3c1",
      domain: "united.com",
      question: "Cheapest SFO→JFK",
    });
  });

  it("is empty for plain tasks", () => {
    expect(describeCase({})).toEqual({});
    expect(describeCase({ params: { toolSurface: "browse_cli" } })).toEqual({});
  });
});

describe("helpers", () => {
  it("shortens only hash-like ids", () => {
    expect(shortCaseId("47e314cc452c540524ffb7cf520285a3")).toBe("47e314cc");
    expect(shortCaseId("heb_comparison_shopping_1")).toBe("heb_comparison_shopping_1");
    expect(shortCaseId("Allrecipes--3")).toBe("Allrecipes--3");
  });

  it("extracts a bare host from URLs and hosts", () => {
    expect(domainOf("https://www.heb.com/search?q=x")).toBe("heb.com");
    expect(domainOf("imgur.com")).toBe("imgur.com");
    expect(domainOf(undefined)).toBeUndefined();
  });

  it("names suite rows by case and plain rows by task", () => {
    expect(
      caseDisplayName({
        name: "agent/hardbenchmark",
        params: { id: "47e314cc452c540524ffb7cf520285a3", web: "https://www.recreation.gov/" },
      }),
    ).toBe("47e314cc recreation.gov");
    expect(caseDisplayName({ name: "act/dropdown" })).toBe("act/dropdown");
  });

  it("keys rows by cell, case and trial", () => {
    const a = { name: "agent/hardbenchmark", modelName: MODEL, params: { id: "a" } };
    const b = { name: "agent/hardbenchmark", modelName: MODEL, params: { id: "b" } };
    const keys = new Set([rowKey(a, 0), rowKey(a, 1), rowKey(b, 0), rowKey(b, 1)]);
    expect(keys.size).toBe(4);
    expect(rowKey({ ...a, modelName: "anthropic/claude-sonnet-4-6" as never }, 0)).not.toBe(
      rowKey(a, 0),
    );
    expect(rowKey(a)).toBe(rowKey(a, 0));
  });
});
