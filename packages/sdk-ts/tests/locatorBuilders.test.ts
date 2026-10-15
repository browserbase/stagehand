import { describe, expect, expectTypeOf, it } from "vitest";
import { z } from "zod/v4";
import type { RPCMethod } from "@browserbasehq/stagehand-protocol/json-rpc/schemas";
import { decodeLocatorQuery } from "@browserbasehq/stagehand-protocol/locator-query";
import {
  Locator,
  Page,
  type AriaRole,
  type GetByRoleOptions,
  type GetByTextOptions,
} from "../src/index.js";
import { RPCClient } from "../src/rpcClient.js";

class FakeLocatorClient extends RPCClient {
  readonly calls: Array<{ method: string; params: unknown }> = [];

  constructor() {
    super({
      serviceWorker: {
        targetId: "worker-target",
        url: "chrome-extension://stagehand/service-worker.js",
        title: "Stagehand",
        extensionId: "stagehand",
      },
      send: async () => {},
      close: () => {},
    });
  }

  async send<Method extends RPCMethod>(
    method: Method,
    params: z.input<Method["params"]>,
  ): Promise<z.output<Method["result"]>> {
    this.calls.push({ method: method.name, params });
    return method.result.parse(method.name === "locator.count" ? 2 : undefined) as z.output<
      Method["result"]
    >;
  }
}

function setup() {
  const client = new FakeLocatorClient();
  const page = new Page(client, { pageId: "page-1", url: "https://example.test/" });
  return { client, page };
}

describe("TypeScript semantic locator builders", () => {
  it("exports native Playwright-style option types", () => {
    expectTypeOf<GetByRoleOptions["name"]>().toEqualTypeOf<string | RegExp | undefined>();
    expectTypeOf<GetByRoleOptions["description"]>().toEqualTypeOf<string | RegExp | undefined>();
    expectTypeOf<GetByRoleOptions["checked"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<GetByRoleOptions["pressed"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<GetByTextOptions["exact"]>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<AriaRole>().extract<"button" | "mark">().toEqualTypeOf<"button">();
  });

  it("constructs role and text locators without sending RPCs", () => {
    const { client, page } = setup();
    const role = page.getByRole("button", { name: "Save", exact: true });
    const text = page.getByText("Draft", { exact: false });
    expect(role).toBeInstanceOf(Locator);
    expect(decodeLocatorQuery(role.descriptor.selector)).toEqual([
      { kind: "role", role: "button", options: { name: "Save", exact: true } },
    ]);
    expect(decodeLocatorQuery(text.descriptor.selector)).toEqual([
      { kind: "text", text: "Draft", exact: false },
    ]);
    expect(client.calls).toEqual([]);
  });

  it("keeps ordinary page.locator selectors unchanged", () => {
    const { page } = setup();
    expect(page.locator("iframe >> xpath=//button").descriptor).toEqual({
      pageId: "page-1",
      selector: "iframe >> xpath=//button",
    });
  });

  it("preserves nth ordering while mixing CSS, XPath, role, and text descendants", () => {
    const { page } = setup();
    const parent = page.locator("iframe >> css=section").nth(1);
    const child = parent
      .getByRole("group", { name: "Settings" })
      .first()
      .getByText("Account")
      .nth(2)
      .locator("xpath=.//button")
      .nth(3);
    expect(decodeLocatorQuery(child.descriptor.selector)).toEqual([
      { kind: "selector", selector: "iframe >> css=section" },
      { kind: "nth", index: 1 },
      { kind: "role", role: "group", options: { name: "Settings" } },
      { kind: "nth", index: 0 },
      { kind: "text", text: "Account" },
      { kind: "nth", index: 2 },
      { kind: "selector", selector: "xpath=.//button" },
    ]);
    expect(child.descriptor.nth).toBe(3);
    expect(parent.descriptor).toEqual({
      pageId: "page-1",
      selector: "iframe >> css=section",
      nth: 1,
    });
  });

  it("serializes native regular expressions without changing their state", () => {
    const { page } = setup();
    const pattern = /save\s+"draft"\/\[x\]/giy;
    pattern.lastIndex = 9;
    const role = page.getByRole("button", { name: pattern, description: /Only when ready/i });
    const text = page.getByText(pattern, { exact: true });
    const encodedPattern = { source: pattern.source, flags: pattern.flags };
    expect(decodeLocatorQuery(role.descriptor.selector)).toEqual([
      {
        kind: "role",
        role: "button",
        options: { name: encodedPattern, description: { source: "Only when ready", flags: "i" } },
      },
    ]);
    expect(decodeLocatorQuery(text.descriptor.selector)).toEqual([
      { kind: "text", text: encodedPattern, exact: true },
    ]);
    expect(pattern.lastIndex).toBe(9);
  });

  it("keeps quotes, iframe delimiters, Unicode, and prototype names as literal user text", () => {
    const { page } = setup();
    const text = 'Save "draft" >> [name="__proto__"] \\ \n café 😀 constructor';
    const locator = page.getByRole("button", { name: text }).getByText(text);
    expect(decodeLocatorQuery(locator.descriptor.selector)).toEqual([
      { kind: "role", role: "button", options: { name: text } },
      { kind: "text", text },
    ]);
  });

  it("snapshots options and uses standard wire casing inside the selector envelope", () => {
    const { page } = setup();
    const options: GetByRoleOptions = {
      name: "Publish",
      description: "Publishes the current draft",
      includeHidden: true,
      disabled: false,
      expanded: false,
      selected: false,
      checked: false,
      pressed: false,
      exact: false,
    };
    const locator = page.getByRole("button", options);
    options.name = "Changed";
    expect(locator.descriptor.selector).toContain('"include_hidden":true');
    expect(locator.descriptor.selector).not.toContain("includeHidden");
    expect(decodeLocatorQuery(locator.descriptor.selector)).toEqual([
      { kind: "role", role: "button", options: { ...options, name: "Publish" } },
    ]);
  });

  it("uses the existing locator action and descriptor with no new builder RPC", async () => {
    const { client, page } = setup();
    const locator = page
      .getByRole("heading", { level: 2 })
      .getByText(/publish/i)
      .first();
    await expect(locator.count({ timeout: 123 })).resolves.toBe(2);
    expect(client.calls).toEqual([
      { method: "locator.count", params: { ...locator.descriptor, options: { timeout: 123 } } },
    ]);
  });

  it("validates invalid options locally and does not send RPCs", () => {
    const { client, page } = setup();
    expect(() => page.getByRole("heading", { level: 0 })).toThrow();
    expect(() => page.getByRole("heading", { level: 1.5 })).toThrow();
    expect(() => page.getByText("body").locator("")).toThrow();
    expect(() =>
      page.getByText("body").locator(page.getByRole("button").descriptor.selector),
    ).toThrow("Selector steps cannot contain another semantic locator query");
    expect(() => page.locator("internal:locator=not-json").getByText("text")).toThrow(
      "Invalid semantic locator query",
    );
    expect(client.calls).toEqual([]);
  });

  it("treats explicit undefined option fields as omitted", () => {
    const { page } = setup();
    expect(
      decodeLocatorQuery(
        page.getByRole("button", {
          name: undefined,
          description: undefined,
          includeHidden: undefined,
        }).descriptor.selector,
      ),
    ).toEqual([{ kind: "role", role: "button", options: {} }]);
    expect(
      decodeLocatorQuery(page.getByText("Save", { exact: undefined }).descriptor.selector),
    ).toEqual([{ kind: "text", text: "Save" }]);
  });
});
