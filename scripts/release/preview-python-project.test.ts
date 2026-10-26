import { parse } from "smol-toml";
import { describe, expect, it } from "vitest";
import {
  parsePreviewPythonProject,
  updatePreviewPythonProjectVersion,
} from "./preview-python-project.js";

describe("preview Python project", () => {
  it.each([
    {
      name: "standard formatting",
      contents: `[project]
name = "stagehand"
version = "4.0.0"
`,
    },
    {
      name: "spacing, comments, and literal strings",
      contents: `[project] # package metadata
  name='stagehand' # distribution name
  version = '4.0.0' # stable version
`,
    },
    {
      name: "CRLF line endings",
      contents: '[project]\r\nname = "stagehand"\r\nversion = "4.0.0"\r\n',
    },
  ])("parses $name", ({ contents }) => {
    expect(parsePreviewPythonProject(contents)).toStrictEqual({
      name: "stagehand",
      version: "4.0.0",
    });
  });

  it("updates only the project version semantically", () => {
    const contents = `[project]
name='stagehand'
version = '4.0.0'

[tool.example]
version = "9.0.0"
`;

    const updated = parse(updatePreviewPythonProjectVersion(contents, "4.0.0.dev0+g0123"));

    expect(updated.project).toMatchObject({
      name: "stagehand",
      version: "4.0.0.dev0+g0123",
    });
    expect(updated.tool).toStrictEqual({ example: { version: "9.0.0" } });
  });
});
