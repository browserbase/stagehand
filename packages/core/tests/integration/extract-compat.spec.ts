import { expect, test } from "@playwright/test";
import { z } from "zod";
import { V3 } from "../../lib/v3/v3.js";
import {
  closeV3,
  createScriptedAisdkTestLlmClient,
  findEncodedIdForText,
} from "./testUtils.js";
import { getV3TestConfig } from "./v3.config.js";

function encodeHtml(html: string): string {
  return `data:text/html,${encodeURIComponent(html)}`;
}

async function createTestV3(options?: {
  jsonResponses?: Parameters<
    typeof createScriptedAisdkTestLlmClient
  >[0]["jsonResponses"];
}): Promise<V3> {
  const llmClient = createScriptedAisdkTestLlmClient({
    jsonResponses: {
      Metadata: {
        completed: true,
        progress: "done",
      },
      ...(options?.jsonResponses ?? {}),
    },
  });

  const v3 = new V3(
    getV3TestConfig({
      llmClient,
    }),
  );
  await v3.init();
  return v3;
}

test.describe("extract compatibility", () => {
  test("extract() accepts optional fields in user schema", async () => {
    const v3 = await createTestV3({
      jsonResponses: {
        Extraction: {
          title: "Stagehand",
        },
      },
    });

    try {
      const page = v3.context.pages()[0];
      await page.goto(
        encodeHtml(`
          <!doctype html>
          <html>
            <body>
              <h1>Stagehand</h1>
              <p>No subtitle is present on this page.</p>
            </body>
          </html>
        `),
      );

      const result = await v3.extract(
        "Extract the page title and subtitle if present.",
        z.object({
          title: z.string(),
          subtitle: z.string().optional(),
        }),
      );

      expect(result).toEqual({ title: "Stagehand" });
      expect(result).not.toHaveProperty("subtitle");
    } finally {
      await closeV3(v3);
    }
  });

  test("extract() accepts nullish fields in user schema", async () => {
    const v3 = await createTestV3({
      jsonResponses: {
        Extraction: {
          title: "Stagehand",
          subtitle: null,
        },
      },
    });

    try {
      const page = v3.context.pages()[0];
      await page.goto(
        encodeHtml(`
          <!doctype html>
          <html>
            <body>
              <h1>Stagehand</h1>
            </body>
          </html>
        `),
      );

      const result = await v3.extract(
        "Extract the page title and subtitle if available.",
        z.object({
          title: z.string(),
          subtitle: z.string().nullish(),
        }),
      );

      expect(result).toEqual({
        title: "Stagehand",
        subtitle: null,
      });
    } finally {
      await closeV3(v3);
    }
  });

  test("extract() restores URL fields from encoded accessibility ids", async () => {
    const v3 = await createTestV3({
      jsonResponses: {
        Extraction: (options) => ({
          docsUrl: findEncodedIdForText(options, "Stagehand Docs"),
        }),
      },
    });

    try {
      const page = v3.context.pages()[0];
      await page.goto(
        encodeHtml(`
          <!doctype html>
          <html>
            <body>
              <a href="https://docs.stagehand.dev" target="_blank">
                Stagehand Docs
              </a>
            </body>
          </html>
        `),
      );

      const result = await v3.extract(
        "Extract the docs URL from the page.",
        z.object({
          docsUrl: z.string().url(),
        }),
      );

      expect(result).toEqual({
        docsUrl: "https://docs.stagehand.dev/",
      });
    } finally {
      await closeV3(v3);
    }
  });
});
