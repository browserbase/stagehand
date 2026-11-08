import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

type CodeLayout = {
  name: string;
  attrs: string;
  advance: "sync" | "raf";
  inputType?: string;
};

function codePage({ attrs, advance, inputType = "text" }: CodeLayout, count = 4): string {
  const inputs = Array.from(
    { length: count },
    (_, i) => `<input id="d${i}" type="${inputType}" ${attrs} />`,
  ).join("");
  const focusNext =
    advance === "raf"
      ? "requestAnimationFrame(() => inputs[index + 1]?.focus());"
      : "inputs[index + 1]?.focus();";
  return (
    "data:text/html," +
    encodeURIComponent(`<!doctype html><html><body>
      <div id="code">${inputs}</div>
      <script>
        const inputs = [...document.querySelectorAll("#code input")];
        inputs.forEach((input, index) => {
          input.addEventListener("input", () => {
            if (input.value) ${focusNext}
          });
        });
      </script>
    </body></html>`)
  );
}

const layouts: CodeLayout[] = [
  { name: 'maxlength="1"', attrs: 'maxlength="1"', advance: "sync" },
  {
    name: 'maxlength="1" with focus moved in requestAnimationFrame',
    attrs: 'maxlength="1"',
    advance: "raf",
  },
  { name: 'size="1"', attrs: 'size="1"', advance: "sync" },
  { name: "adjacent inputs without maxlength", attrs: "", advance: "sync" },
  { name: "number inputs", attrs: "", advance: "sync", inputType: "number" },
];

async function codeValues(stagehand: Stagehand): Promise<string[]> {
  const page = await firstPage(stagehand);
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLInputElement>("#code input")].map((input) => input.value),
  );
}

describe("Locator.fill() and type() on auto-advancing code inputs", () => {
  let stagehand: Stagehand;

  beforeAll(async () => {
    stagehand = await createStagehand();
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
  });

  for (const layout of layouts) {
    it(`fill() spreads the code across ${layout.name}`, async () => {
      const page = await firstPage(stagehand);
      await page.goto(codePage(layout));
      await page.locator("#d0").fill("1234");
      expect(await codeValues(stagehand)).toEqual(["1", "2", "3", "4"]);
    });

    it(`type() spreads the code across ${layout.name}`, async () => {
      const page = await firstPage(stagehand);
      await page.goto(codePage(layout));
      await page.locator("#d0").type("1234");
      expect(await codeValues(stagehand)).toEqual(["1", "2", "3", "4"]);
    });
  }

  it("fill() leaves adjacent ordinary fields as one insertion", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      "data:text/html," +
        encodeURIComponent(`<!doctype html><html><body>
          <input id="first" /><input id="last" />
          <script>
            window.inputEvents = 0;
            document.getElementById("first").addEventListener("input", () => window.inputEvents++);
          </script>
        </body></html>`),
    );
    await page.locator("#first").fill("hello world");
    expect(await page.locator("#first").inputValue()).toBe("hello world");
    expect(await page.locator("#last").inputValue()).toBe("");
    expect(
      await page.evaluate(() => (window as unknown as { inputEvents: number }).inputEvents),
    ).toBe(1);
  });

  it("fill() follows focus when the page re-renders the inputs after each digit", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      "data:text/html," +
        encodeURIComponent(`<!doctype html><html><body>
          <div id="code"></div>
          <script>
            const digits = ["", "", "", ""];
            const root = document.getElementById("code");
            function render(focusIndex) {
              root.innerHTML = digits
                .map((digit, i) => '<input maxlength="1" data-index="' + i + '" value="' + digit + '" />')
                .join("");
              root.querySelectorAll("input").forEach((input) => {
                input.addEventListener("input", () => {
                  const i = Number(input.dataset.index);
                  digits[i] = input.value;
                  render(input.value ? i + 1 : i);
                });
              });
              root.children[focusIndex]?.focus();
            }
            render();
          </script>
        </body></html>`),
    );
    await page.locator("#code input").fill("1234");
    expect(await codeValues(stagehand)).toEqual(["1", "2", "3", "4"]);
  });

  it("fill() spreads a code across inputs in a shadow root", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      "data:text/html," +
        encodeURIComponent(`<!doctype html><html><body>
          <div id="host"></div>
          <script>
            const root = document.getElementById("host").attachShadow({ mode: "open" });
            root.innerHTML = '<input maxlength="1"><input maxlength="1"><input maxlength="1"><input maxlength="1">';
            const inputs = [...root.querySelectorAll("input")];
            inputs.forEach((input, index) => input.addEventListener("input", () => inputs[index + 1]?.focus()));
          </script>
        </body></html>`),
    );
    await page.locator("input").first().fill("1234");
    expect(
      await page.evaluate(() =>
        [...document.querySelector("#host")!.shadowRoot!.querySelectorAll("input")].map(
          (input) => input.value,
        ),
      ),
    ).toEqual(["1", "2", "3", "4"]);
  });

  it("fill() keeps a full-length single code field unchanged", async () => {
    const page = await firstPage(stagehand);
    await page.goto(
      "data:text/html," +
        encodeURIComponent(`<!doctype html><html><body>
          <input id="otp" maxlength="6" autocomplete="one-time-code" />
          <input id="other" />
        </body></html>`),
    );
    await page.locator("#otp").fill("123456");
    expect(await page.locator("#otp").inputValue()).toBe("123456");
    expect(await page.locator("#other").inputValue()).toBe("");
  });
});

describe("act() on auto-advancing code inputs", () => {
  let stagehand: Stagehand;

  afterAll(async () => {
    await closeStagehand(stagehand);
  });

  it("fills the whole code when the model picks the first input", async () => {
    stagehand = await createStagehand({
      model: {
        generate: async (params) => {
          const prompt = params.messages
            .flatMap(({ content }) => (Array.isArray(content) ? content : [content]))
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
          const elementId = prompt
            .split("\n")
            .find((line) => line.includes("textbox") && /\[\d+-\d+\]/.test(line))
            ?.match(/\[(\d+-\d+)\]/)?.[1];
          expect(elementId).toBeDefined();
          return {
            role: "assistant",
            content: { type: "text", text: "Fill the verification code" },
            outputFormat: "json_schema",
            structuredContent: {
              action: {
                elementId: elementId!,
                description: "first verification code input",
                method: "fill",
                arguments: ["1234"],
              },
              twoStep: false,
            },
          };
        },
      },
    });
    const page = await firstPage(stagehand);
    await page.goto(codePage(layouts[0]));

    const result = await stagehand.act("Enter 1234 in the verification code fields", { page });
    expect(result.data.success).toBe(true);
    expect(await codeValues(stagehand)).toEqual(["1", "2", "3", "4"]);
  });
});
