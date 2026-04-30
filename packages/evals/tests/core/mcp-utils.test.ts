import { describe, expect, it } from "vitest";
import {
  extractMcpText,
  parseChromeDevtoolsListedPages,
  parseLooseJson,
} from "../../core/tools/mcpUtils.js";

describe("mcpUtils", () => {
  it("extracts text content across text and resource blocks", () => {
    const text = extractMcpText({
      content: [
        { type: "text", text: "hello" },
        { type: "resource", resource: { text: "world" } },
      ],
    });

    expect(text).toBe("hello\nworld");
  });

  it("parses loose JSON from fenced blocks", () => {
    expect(
      parseLooseJson<{ ok: boolean }>('```json\n{"ok":true}\n```'),
    ).toEqual({
      ok: true,
    });
  });

  it("parses double-stringified JSON from wrapped result sections", () => {
    expect(
      parseLooseJson<{ url: string }>(
        `### Result\n"{\\"url\\":\\"about:blank\\"}"\n### Ran Playwright code`,
      ),
    ).toEqual({
      url: "about:blank",
    });
  });

  it("parses double-stringified JSON from fenced return sections", () => {
    expect(
      parseLooseJson<{ title: string }>(
        'Script ran on page and returned:\n```json\n"{\\"title\\":\\"Example\\"}"\n```',
      ),
    ).toEqual({
      title: "Example",
    });
  });

  it("preserves scalar strings that look like JSON scalars", () => {
    expect(parseLooseJson<string>('### Result\n"true"')).toBe("true");
    expect(parseLooseJson<string>('### Result\n"123"')).toBe("123");
    expect(parseLooseJson<string>('### Result\n"null"')).toBe("null");
  });

  it("parses list_pages output from markdown table rows", () => {
    const listed = parseChromeDevtoolsListedPages(`
| pageId | title | url |
| 1 | Example | about:blank |
| 2 | Dropdown | http://127.0.0.1:3456/dropdown |
    `);

    expect(listed).toEqual([
      { toolPageId: 1, url: "about:blank" },
      { toolPageId: 2, url: "http://127.0.0.1:3456/dropdown" },
    ]);
  });

  it("parses list_pages output from descriptive lines", () => {
    const listed = parseChromeDevtoolsListedPages(`
Selected pageId: 3 url: http://127.0.0.1:3456/dropdown
pageId: 4 url: about:blank
    `);

    expect(listed).toEqual([
      { toolPageId: 3, url: "http://127.0.0.1:3456/dropdown" },
      { toolPageId: 4, url: "about:blank" },
    ]);
  });

  it("parses list_pages output from numbered page summaries", () => {
    const listed = parseChromeDevtoolsListedPages(`
## Pages
1: about:blank [selected]
2: http://127.0.0.1:3456/dropdown
    `);

    expect(listed).toEqual([
      { toolPageId: 1, url: "about:blank" },
      { toolPageId: 2, url: "http://127.0.0.1:3456/dropdown" },
    ]);
  });
});
