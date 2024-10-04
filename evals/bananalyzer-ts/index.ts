import { z } from "zod";
import { Stagehand } from "../../lib";
import fs from "fs";
import path from "path";
import { Server } from "http";
import { createExpressServer } from "./server/expressServer";
import {
  Example,
  getSchemaByName,
  getCustomSchema,
  getGoals,
  SchemaName,
} from "./schemas";

const basePath = __dirname.includes("bananalyzer-ts")
  ? __dirname
  : path.join(__dirname, "bananalyzer-ts");

// Validation helper functions
function validateJsonMatch(expected: any, result: any): boolean {
  if (typeof expected !== typeof result) return false;
  if (Array.isArray(expected)) {
    if (!Array.isArray(result) || expected.length !== result.length)
      return false;
    return expected.every((item, index) =>
      validateJsonMatch(item, result[index]),
    );
  }
  if (typeof expected === "object" && expected !== null) {
    return Object.keys(expected).every((key) =>
      validateJsonMatch(expected[key], result[key]),
    );
  }
  return expected === result;
}

function validateEndUrlMatch(expected: string, actual: string): boolean {
  return actual.endsWith(expected);
}

export async function evaluateExample(
  exampleId: string,
  options: {
    launchServer?: boolean;
    serverPort?: number;
  } = {
    launchServer: true,
    serverPort: 6778,
  },
): Promise<any> {
  await new Promise((resolve) => setTimeout(resolve, 2000));

  const examples = JSON.parse(
    fs.readFileSync(path.join(basePath, "static/examples.json"), "utf-8"),
  );
  const example = examples.find((example: Example) => example.id === exampleId);
  if (!example) {
    console.error(`Example with ID ${exampleId} not found.`);
    return false;
  }

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    headless: process.env.HEADLESS !== "false",
  });
  await stagehand.init();

  let server: Server | null = null;
  let localUrl: string = example.url; // Default to the original URL
  let resources: any[] = [];
  let port = options.serverPort;

  try {
    if (example.source === "mhtml") {
      // Handle MHTML Source
      const mhtmlFilePath = path.resolve(
        path.join(basePath, `static/${example.id}/index.mhtml`),
      );

      if (options.launchServer) {
        const app = createExpressServer();
        server = app.listen(port, () => {
          console.log(`Express server listening on port ${port}`);
        });
        // Wait briefly to ensure the server starts
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      const response = await fetch(`http://localhost:${port}/add-mhtml`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ mhtmlFilePath }),
      });

      if (!response.ok) {
        throw new Error(`Failed to add MHTML: ${response.statusText}`);
      }

      const responseData = await response.json();
      resources = responseData.resources;

      // Set the local URL to the modified index.html
      localUrl = `http://localhost:${port}/static/${example.id}/index.html`;
    }

    await stagehand.page.goto(localUrl);
    await stagehand.waitForSettledDom();

    let schemaDefinition: z.ZodRawShape;

    if (
      typeof example.schema_ === "string" &&
      SchemaName.options.includes(example.schema_)
    ) {
      // If schema_ is a predefined SchemaName
      schemaDefinition = getSchemaByName(example.schema_ as SchemaName);
    } else if (typeof example.schema_ === "object") {
      // If schema_ is a custom JSON schema
      schemaDefinition = getCustomSchema(
        example.schema_ as Record<string, any>,
      );
    } else {
      throw new Error("Invalid schema definition");
    }

    // Fetch the goal from goals.json based on the subcategory
    const goals = getGoals();
    const goal =
      goals[example.subcategory] ||
      example.goal ||
      "Scrape the content of this page.";

    let extractionResult;

    if (example.type === "listing_detail") {
      // If the type is listing_detail, expect an array of the schema
      extractionResult = await stagehand.extract({
        instruction: goal,
        schema: z.object({ items: z.array(z.object(schemaDefinition)) }),
        modelName: "gpt-4o-2024-08-06",
      });
    } else {
      // For other types, expect a single object of the schema
      extractionResult = await stagehand.extract({
        instruction: goal,
        schema: z.object(schemaDefinition),
        modelName: "gpt-4o-2024-08-06",
      });
    }

    if (example.type === "listing_detail") {
      extractionResult = extractionResult.items;
    }

    console.log("Extracted data:", extractionResult);

    for (const evalItem of example.evals) {
      if (evalItem.type === "json_match") {
        if (evalItem.expected) {
          if (!validateJsonMatch(evalItem.expected, extractionResult)) {
            console.log("❌ JSON match failed");
            return {
              _success: false,
              case: "json_mismatch_1",
              expected: evalItem.expected,
              actual: extractionResult,
            };
          }
        } else if (evalItem.options) {
          const matchesAny = evalItem.options.some((option) =>
            validateJsonMatch(option, extractionResult),
          );
          if (!matchesAny) {
            console.log("❌ No JSON match found in options");
            return {
              _success: false,
              case: "json_mismatch_2",
              expected: evalItem.expected,
              actual: extractionResult,
            };
          }
        }
      } else if (
        evalItem.type === "end_url_match" &&
        typeof evalItem.expected === "string"
      ) {
        if (
          !validateEndUrlMatch(evalItem.expected, await stagehand.page.url())
        ) {
          console.log("❌ URL match failed");
          return {
            _success: false,
            case: "url_mismatch",
            expected: evalItem.expected,
            actual: await stagehand.page.url(),
          };
        }
      }
    }

    console.log("✅ All evaluations passed");
    return {
      _success: true,
      expected: extractionResult,
      actual: extractionResult,
    };
  } catch (error) {
    console.error("Error during evaluation:", error);
    return {
      _success: false,
      error: error,
    };
  } finally {
    try {
      const deleteResponse = await fetch(
        `http://localhost:${port}/delete-resources`,
        {
          method: "DELETE",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ exampleId }),
        },
      );

      if (!deleteResponse.ok) {
        console.error(
          `Failed to delete resources: ${deleteResponse.statusText}`,
        );
      } else {
        console.log("Resources deleted successfully.");
      }
    } catch (deleteError) {
      console.error("Error deleting resources:", deleteError);
    }

    try {
      if (server) {
        server.close(() => {
          console.log("Express server closed.");
        });
      }
    } catch (closeError) {
      console.error("Error closing server:", closeError);
    }

    await stagehand.context.close();
  }
}

export const chosenBananalyzerEvals = [
  {
    id: "JNOSAEEZO4j2unWHPFBdO",
    tags: ["detail"],
    name: "bananalyzer_1",
  },
  {
    id: "KuDD2GuMDlbuKO4ozdbDA",
    tags: ["listing-detail"],
    name: "bananalyzer_2",
  },
  {
    id: "nAXVoJDSuul938vtPvfFB",
    tags: ["listing-detail", "detail"],
    name: "bananalyzer_3",
  },
  {
    id: "GQfYTjppPhTgYtsuFUbXF",
    tags: ["listing-detail", "detail"],
    name: "bananalyzer_4",
  },
];
