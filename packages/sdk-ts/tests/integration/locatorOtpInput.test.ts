import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ClientLLM, Stagehand } from "../../src/index.js";
import { closeStagehand, createStagehand, firstPage } from "./_support.js";

describe("auto-advancing code inputs", () => {
  let stagehand: Stagehand;

  beforeEach(async () => {
    stagehand = await createStagehand();
  });

  afterEach(async () => {
    await closeStagehand(stagehand);
  });

  for (const method of ["fill", "type"] as const) {
    for (const [name, attributes, deferred] of [
      ["maxlength", 'maxlength="1"', false],
      ["no maxlength", "", false],
      ["size one", 'size="1"', false],
      ["number input", 'type="number" maxlength="1"', false],
      ["next frame", 'maxlength="1"', true],
    ] as const) {
      it(`${method} follows focus for ${name}`, async () => {
        const page = await firstPage(stagehand);
        await page.goto(
          "data:text/html," +
            encodeURIComponent(`
            <input id="digit-0" ${attributes}><input id="digit-1" ${attributes}>
            <input id="digit-2" ${attributes}><input id="digit-3" ${attributes}>
            <script>
              const inputs = [...document.querySelectorAll('input')];
              inputs.forEach((input, index) => input.addEventListener('input', () => {
                if (input.value) {
                  input.value = input.value.slice(-1);
                  ${deferred ? "requestAnimationFrame(() => inputs[index + 1]?.focus());" : "inputs[index + 1]?.focus();"}
                }
              }));
            </script>`),
        );

        await page.locator("#digit-0")[method]("1234");

        expect(
          await page.evaluate(() =>
            [...document.querySelectorAll("input")].map((input) => input.value),
          ),
        ).toEqual(["1", "2", "3", "4"]);
      });
    }

    it(`${method} keeps a full-length code input together`, async () => {
      const page = await firstPage(stagehand);
      await page.goto(
        "data:text/html," +
          encodeURIComponent(
            '<input id="code" maxlength="4" oninput="document.body.dataset.events = Number(document.body.dataset.events || 0) + 1" />',
          ),
      );
      await page.locator("#code")[method]("1234");
      expect(await page.locator("#code").inputValue()).toBe("1234");
      expect(await page.evaluate(() => document.body.dataset.events)).toBe("1");
    });
  }
});

it("runs a plain-English code instruction through act", async () => {
  const model: ClientLLM = {
    generate: async (params) => {
      const prompt = params.messages
        .flatMap((message) =>
          (Array.isArray(message.content) ? message.content : [message.content])
            .filter((part) => part.type === "text")
            .map((part) => part.text),
        )
        .join("\n");
      const firstInput = prompt.split("\n").find((line) => line.includes("Verification code"));
      const elementId = firstInput?.match(/\[(\d+-\d+)\]/)?.[1];
      if (!elementId) throw new Error("Verification code field missing from action snapshot");
      expect(prompt).toContain("%code%");
      return {
        role: "assistant",
        content: { type: "text", text: "structured action" },
        outputFormat: "json_schema",
        structuredContent: {
          action: {
            elementId,
            description: "First verification code field",
            method: "fill",
            arguments: ["%code%"],
          },
          twoStep: false,
        },
      };
    },
  };
  const stagehand = await createStagehand({ model });
  try {
    const page = await firstPage(stagehand);
    await page.goto(
      "data:text/html," +
        encodeURIComponent(`
          <input id="digit-0" aria-label="Verification code" maxlength="1"><input id="digit-1" maxlength="1">
          <input id="digit-2" maxlength="1"><input id="digit-3" maxlength="1">
          <script>
            const inputs = [...document.querySelectorAll('input')];
            inputs.forEach((input, index) => input.addEventListener('input', () => {
              if (input.value) inputs[index + 1]?.focus();
            }));
          </script>`),
    );
    const result = await stagehand.act("Enter %code% in the verification code fields", {
      variables: { code: "1234" },
      cache: false,
    });
    expect(result.data.success).toBe(true);
    expect(
      await page.evaluate(() =>
        [...document.querySelectorAll("input")].map((input) => input.value),
      ),
    ).toEqual(["1", "2", "3", "4"]);
  } finally {
    await closeStagehand(stagehand);
  }
});
