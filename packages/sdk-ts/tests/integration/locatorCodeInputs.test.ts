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
  {
    name: 'maxlength="1" number inputs',
    attrs: 'maxlength="1"',
    advance: "sync",
    inputType: "number",
  },
];

// Auto-advancing inputs that are not marked as one-character boxes keep the old behavior:
// the whole value goes into the first input.
const ordinaryLayouts: CodeLayout[] = [
  { name: 'size="1"', attrs: 'size="1"', advance: "sync" },
  { name: "adjacent inputs without maxlength", attrs: "", advance: "sync" },
  { name: "number inputs", attrs: "", advance: "sync", inputType: "number" },
];

function page(html: string): string {
  return "data:text/html," + encodeURIComponent(`<!doctype html><html><body>${html}</body></html>`);
}

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

  for (const layout of ordinaryLayouts) {
    it(`fill() inserts the value at once into ${layout.name}`, async () => {
      const page = await firstPage(stagehand);
      await page.goto(codePage(layout));
      await page.locator("#d0").fill("1234");
      expect(await codeValues(stagehand)).toEqual(["1234", "", "", ""]);
    });
  }

  it("fill() does not split values for ordinary fields with input handlers", async () => {
    const p = await firstPage(stagehand);
    await p.goto(
      page(`
        <div id="code">
          <input id="a" type="number" /><input id="b" type="number" /><input id="c" type="number" />
        </div>
        <script>
          document.querySelectorAll("input").forEach((input) =>
            input.addEventListener("input", () => {
              if (input.value !== "" && Number(input.value) < 10) input.value = "10";
            }),
          );
        </script>`),
    );
    await p.locator("#a").fill("25");
    expect(await codeValues(stagehand)).toEqual(["25", "", ""]);
  });

  it("fill() treats a one-character field among other fields as an ordinary field", async () => {
    const p = await firstPage(stagehand);
    await p.goto(
      page(`
        <form id="code">
          <input id="first" /><input id="initial" maxlength="1" /><input id="last" />
        </form>
        <script>
          const initial = document.getElementById("initial");
          initial.addEventListener("input", () => document.getElementById("last").focus());
        </script>`),
    );
    await p.locator("#initial").fill("QX");
    expect(await codeValues(stagehand)).toEqual(["", "Q", ""]);
  });

  it("fill() stops typing when focus leaves the code inputs", async () => {
    const p = await firstPage(stagehand);
    await p.goto(
      page(`
        <div id="code">
          <input maxlength="1" /><input maxlength="1" /><input maxlength="1" />
        </div>
        <input id="email" />
        <script>
          const inputs = [...document.querySelectorAll("#code input")];
          inputs.forEach((input, index) =>
            input.addEventListener("input", () =>
              (inputs[index + 1] ?? document.getElementById("email")).focus(),
            ),
          );
        </script>`),
    );
    await p.locator("#code input").first().fill("1234");
    expect(await codeValues(stagehand)).toEqual(["1", "2", "3"]);
    expect(await p.locator("#email").inputValue()).toBe("");
  });

  it("fill() replaces a prefilled code next to a hidden input", async () => {
    const p = await firstPage(stagehand);
    await p.goto(
      page(`
        <div id="code" role="group">
          <input id="hidden" type="hidden" value="e3c7" />
          <input id="d0" maxlength="1" value="e" /><input maxlength="1" value="3" />
          <input maxlength="1" value="c" /><input maxlength="1" value="7" />
        </div>
        <script>
          const inputs = [...document.querySelectorAll("#code input:not([type=hidden])")];
          const sync = () => (document.getElementById("hidden").value = inputs.map((i) => i.value).join(""));
          inputs.forEach((input, index) => {
            input.addEventListener("focus", () => input.select());
            input.addEventListener("input", () => {
              sync();
              if (input.value) inputs[index + 1]?.focus();
            });
          });
        </script>`),
    );
    await p.locator("#d0").fill("5831");
    expect(await codeValues(stagehand)).toEqual(["5831", "5", "8", "3", "1"]);
  });

  it("fill() replaces a prefilled code when the page does not select on focus", async () => {
    const p = await firstPage(stagehand);
    await p.goto(
      page(`
        <div id="code">
          <input id="d0" maxlength="1" value="e" /><input maxlength="1" value="3" />
          <input maxlength="1" value="c" /><input maxlength="1" value="7" />
        </div>
        <script>
          const inputs = [...document.querySelectorAll("#code input")];
          inputs.forEach((input, index) =>
            input.addEventListener("input", () => input.value && inputs[index + 1]?.focus()),
          );
        </script>`),
    );
    await p.locator("#d0").fill("5831");
    expect(await codeValues(stagehand)).toEqual(["5", "8", "3", "1"]);
  });

  it("fill() inserts the whole value when one-character number boxes do not advance", async () => {
    const p = await firstPage(stagehand);
    await p.goto(
      page(`
        <div id="code">
          <input id="a" type="number" maxlength="1" /><input type="number" maxlength="1" />
          <input type="number" maxlength="1" />
        </div>
        <script>
          document.querySelectorAll("input").forEach((input) =>
            input.addEventListener("input", () => {
              if (input.value !== "" && Number(input.value) < 10) input.value = "10";
            }),
          );
        </script>`),
    );
    await p.locator("#a").fill("25");
    expect(await codeValues(stagehand)).toEqual(["25", "", ""]);
  });

  it("fill() stops at the last number box when the code is longer than the boxes", async () => {
    const p = await firstPage(stagehand);
    await p.goto(
      codePage({ name: "number", attrs: 'maxlength="1"', advance: "sync", inputType: "number" }, 3),
    );
    await p.locator("#d0").fill("12345");
    expect(await codeValues(stagehand)).toEqual(["1", "2", "3"]);
  });

  it("type() stops typing when focus leaves the code inputs", async () => {
    const p = await firstPage(stagehand);
    await p.goto(
      page(`
        <div id="code">
          <input maxlength="1" /><input maxlength="1" /><input maxlength="1" />
        </div>
        <input id="email" />
        <script>
          const inputs = [...document.querySelectorAll("#code input")];
          inputs.forEach((input, index) =>
            input.addEventListener("input", () =>
              (inputs[index + 1] ?? document.getElementById("email")).focus(),
            ),
          );
        </script>`),
    );
    await p.locator("#code input").first().type("1234");
    expect(await codeValues(stagehand)).toEqual(["1", "2", "3"]);
    expect(await p.locator("#email").inputValue()).toBe("");
  });

  it("fill() follows focus when the page replaces the whole code group after each digit", async () => {
    const p = await firstPage(stagehand);
    await p.goto(
      page(`
        <div id="outer"></div>
        <script>
          const digits = ["", "", "", ""];
          const outer = document.getElementById("outer");
          function render(focusIndex) {
            outer.innerHTML =
              '<div id="code">' +
              digits.map((d, i) => '<input maxlength="1" data-index="' + i + '" value="' + d + '" />').join("") +
              "</div>";
            outer.querySelectorAll("input").forEach((input) =>
              input.addEventListener("input", () => {
                const i = Number(input.dataset.index);
                digits[i] = input.value;
                render(input.value ? i + 1 : i);
              }),
            );
            outer.querySelectorAll("input")[focusIndex]?.focus();
          }
          render();
        </script>`),
    );
    await p.locator("#code input").first().fill("1234");
    expect(await codeValues(stagehand)).toEqual(["1", "2", "3", "4"]);
  });

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
