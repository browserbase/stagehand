import { test, expect } from "@playwright/test";
import OpenAI from "openai";
import { V3 } from "../../lib/v3/v3.js";
import { v3TestConfig } from "./v3.config.js";

/**
 * Live integration test for the Navigator n1.5 expanded tool set
 * (browser_tools_expanded-20260403): extract_elements, find,
 * set_element_value, execute_js.
 *
 * Gated on YUTORI_API_KEY — skipped where the key is absent (e.g. CI without
 * Yutori credentials). It hits the real Navigator API, so it captures the
 * model's tool calls and asserts both that the expanded DOM tools are used and
 * that they actually mutate/read the page (ground-truth DOM end state).
 */
const hasKey = !!process.env.YUTORI_API_KEY;

test.describe("Yutori Navigator expanded tools (live)", () => {
  let v3: V3;
  let calledTools: string[];
  let toolCalls: Array<{ name: string; args: Record<string, unknown> }>;
  let toolSetsSent: Set<string>;
  let restore: (() => void) | undefined;

  test.beforeEach(async () => {
    calledTools = [];
    toolCalls = [];
    toolSetsSent = new Set();
    // Capture the OpenAI-compatible requests/responses the client makes so we
    // can assert which Navigator tools the model actually invoked.
    const orig = OpenAI.Chat.Completions.prototype.create;
    restore = () => {
      OpenAI.Chat.Completions.prototype.create = orig;
    };
    OpenAI.Chat.Completions.prototype.create = async function (
      body: Parameters<typeof orig>[0],
      ...rest: unknown[]
    ) {
      const b = body as unknown as { tool_set?: string };
      if (b?.tool_set) toolSetsSent.add(b.tool_set);
      const res = await (orig as (...a: unknown[]) => Promise<unknown>).call(
        this,
        body,
        ...rest,
      );
      const tcs =
        (res as { choices?: Array<{ message?: { tool_calls?: unknown[] } }> })
          ?.choices?.[0]?.message?.tool_calls ?? [];
      for (const tc of tcs) {
        const fn = (tc as { function?: { name?: string; arguments?: string } })
          ?.function;
        if (!fn?.name) continue;
        calledTools.push(fn.name);
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(fn.arguments || "{}");
        } catch {
          // ignore unparseable args
        }
        toolCalls.push({ name: fn.name, args });
      }
      return res as ReturnType<typeof orig>;
    } as typeof orig;

    v3 = new V3({ ...v3TestConfig });
    await v3.init();
  });

  test.afterEach(async () => {
    restore?.();
    await v3?.close?.().catch(() => {});
  });

  test("model fills an input via set_element_value and reads it back via execute_js", async () => {
    test.skip(!hasKey, "Requires YUTORI_API_KEY");
    test.setTimeout(180_000);

    const page = v3.context.pages()[0];
    await page.goto("https://www.selenium.dev/selenium/web/web-form.html");

    const agent = v3.agent({
      mode: "cua",
      model: {
        modelName: "yutori/n1.5-latest",
        apiKey: process.env.YUTORI_API_KEY,
        toolSet: "browser_tools_expanded-20260403",
      },
      systemPrompt:
        "Prefer the DOM tools (extract_elements/find to read, " +
        "set_element_value to fill, execute_js to inspect) over clicking by " +
        "coordinates. Do not ask follow-up questions.",
    });

    const result = await agent.execute({
      instruction:
        'Fill the "Text input" field with the value "navigator-n1.5", then ' +
        "read back the current value of that text input to confirm it was set.",
      maxSteps: 20,
    });

    // The expanded tool set must have been negotiated on the wire.
    expect([...toolSetsSent]).toContain("browser_tools_expanded-20260403");

    // The model used the expanded DOM tools: a read tool to discover the
    // field, set_element_value to fill it, and execute_js to read it back.
    expect(
      calledTools.some((t) => t === "extract_elements" || t === "find"),
    ).toBe(true);
    expect(calledTools).toContain("set_element_value");
    expect(calledTools).toContain("execute_js");

    // Ground-truth DOM end state, independent of the model's self-report.
    const textValue = await page
      .mainFrame()
      .evaluate(
        '(document.querySelector("input[name=my-text]") || {}).value || null',
      );
    expect(textValue).toBe("navigator-n1.5");
    expect(result.completed).toBe(true);
  });

  test("model clicks an element by ref, resolved to the element (not 0,0)", async () => {
    test.skip(!hasKey, "Requires YUTORI_API_KEY");
    test.setTimeout(180_000);

    const page = v3.context.pages()[0];
    await page.goto("https://www.selenium.dev/selenium/web/web-form.html");

    const agent = v3.agent({
      mode: "cua",
      model: {
        modelName: "yutori/n1.5-latest",
        apiKey: process.env.YUTORI_API_KEY,
        toolSet: "browser_tools_expanded-20260403",
      },
      systemPrompt:
        "Always interact with elements by their ref from extract_elements/find. " +
        "Never click by raw coordinates. Do not ask follow-up questions.",
    });

    const result = await agent.execute({
      instruction:
        "First call extract_elements to list the page elements, then click the " +
        "Submit button using its ref (use left_click with the ref).",
      maxSteps: 20,
    });

    // The model targeted the click by ref (Navigator sends an empty/omitted
    // `coordinates` and a `ref`); our client resolves the ref to the element's
    // on-screen center.
    const refClick = toolCalls.find(
      (c) => c.name === "left_click" && typeof c.args.ref === "string",
    );
    expect(refClick, "expected a left_click targeted by ref").toBeTruthy();

    // Submitting navigates to the confirmation page — proof the ref resolved to
    // the Submit button and the click landed (a ref left at (0,0) would not
    // submit the form).
    expect(page.url()).toContain("submitted-form");
    expect(result.completed).toBe(true);
  });

  test("model locates an element by text via the find tool", async () => {
    test.skip(!hasKey, "Requires YUTORI_API_KEY");
    test.setTimeout(180_000);

    const page = v3.context.pages()[0];
    await page.goto("https://en.wikipedia.org/wiki/Web_browser");

    const agent = v3.agent({
      mode: "cua",
      model: {
        modelName: "yutori/n1.5-latest",
        apiKey: process.env.YUTORI_API_KEY,
        toolSet: "browser_tools_expanded-20260403",
      },
      systemPrompt:
        "This page has hundreds of links; do not dump the whole page. Use the " +
        "find tool to locate elements by text. Do not ask follow-up questions.",
    });

    const result = await agent.execute({
      instruction:
        "Use the find tool to locate the link to the 'HTML' article, and " +
        "report its destination URL.",
      maxSteps: 20,
    });

    expect(calledTools).toContain("find");
    expect(result.completed).toBe(true);
    // The find result surfaces the href, so the model can report it.
    expect(result.message.toLowerCase()).toContain("html");
  });
});
