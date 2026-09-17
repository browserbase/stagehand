import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const config = JSON.parse(readFileSync(new URL("../docs.json", import.meta.url), "utf8"));
const spec = JSON.parse(readFileSync(new URL("../v3/openapi.json", import.meta.url), "utf8"));
const endpoints = [
  ["POST /v1/sessions/start", "Start a new browser session"],
  ["POST /v1/sessions/{id}/navigate", "Navigate to a URL"],
  ["POST /v1/sessions/{id}/act", "Perform an action"],
  ["POST /v1/sessions/{id}/observe", "Observe available actions"],
  ["POST /v1/sessions/{id}/extract", "Extract data from the page"],
  ["POST /v1/sessions/{id}/agentExecute", "Execute an AI agent"],
  ["POST /v1/sessions/{id}/end", "End a browser session"],
  ["GET /v1/sessions/{id}/replay", "Replay session metrics"],
];

function findReferences(value: unknown): string[] {
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value).flatMap(([key, entry]) =>
    key === "$ref" && typeof entry === "string" ? [entry] : findReferences(entry),
  );
}

describe("v3 API reference", () => {
  it("uses the local spec for all four existing API navigation sections", () => {
    expect(config.api.openapi).toBe("v3/openapi.json");
    const version = config.navigation.versions.find(
      (entry: { version: string }) => entry.version === "v3",
    );
    const apiSections = version.dropdowns.filter(
      (entry: { dropdown: string }) => entry.dropdown !== "TypeScript",
    );
    expect(apiSections.map((entry: { dropdown: string }) => entry.dropdown)).toEqual([
      "Python",
      "Java",
      "Go",
      "Ruby",
    ]);
    for (const section of apiSections) {
      const reference = section.groups.find(
        (group: { group: string }) => group.group === "API Reference",
      );
      expect(reference.openapi).toEqual({
        source: "v3/openapi.json",
        directory: `v3/api-reference/${section.dropdown.toLowerCase()}`,
      });
      expect(reference.pages).toEqual(endpoints.map(([endpoint]) => endpoint));
    }
  });

  it.each(endpoints)("preserves the title and code sample languages for %s", (endpoint, title) => {
    const [method, path] = endpoint.split(" ");
    const operation = spec.paths[path][method.toLowerCase()];
    expect(operation.summary).toBe(title);
    expect(operation.description).toBeTruthy();
    expect(operation.responses["200"]).toBeDefined();
    expect(operation["x-codeSamples"].map((sample: { lang: string }) => sample.lang)).toEqual([
      "JavaScript",
      "Python",
      "Go",
      "Java",
      "Kotlin",
      "Ruby",
      "PHP",
      "C#",
    ]);
    for (const sample of operation["x-codeSamples"]) {
      expect(sample.source.trim()).not.toBe("");
    }
  });

  it("resolves every schema reference without fetching an external document", () => {
    const references = findReferences(spec);
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(reference).toMatch(/^#\//);
      const resolved = reference
        .slice(2)
        .split("/")
        .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
        .reduce((value, key) => value?.[key], spec);
      expect(resolved, reference).toBeDefined();
    }
  });

  it("preserves the API server and authentication schemes", () => {
    expect(spec.servers).toEqual([{ url: "https://api.stagehand.browserbase.com" }]);
    expect(spec.security).toEqual([{ BrowserbaseApiKey: [], BrowserbaseProjectId: [] }]);
    expect(spec.components.securitySchemes.BrowserbaseApiKey).toMatchObject({
      type: "apiKey",
      in: "header",
      name: "x-bb-api-key",
    });
    expect(spec.components.securitySchemes.BrowserbaseProjectId).toMatchObject({
      type: "apiKey",
      in: "header",
      name: "x-bb-project-id",
    });
  });
});
