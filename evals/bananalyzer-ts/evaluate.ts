import { z } from "zod";
import { Stagehand } from "../../lib";
import fs from "fs";
import path from "path";
import { Server } from "http";
import { parseMHTMLFile } from "./utils/mhtmlParser";
import { createExpressServer } from "./server/expressServer";
import {
  Example,
  getSchemaByName,
  getCustomSchema,
  getGoals,
  SchemaName,
} from "./schemas";

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

// Updated evaluateExample function
export async function evaluateExample(exampleId: string): Promise<boolean> {
  const examples = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, "../bananalyzer/static/examples.json"),
      "utf-8",
    ),
  );
  const example = examples.find((example: Example) => example.id === exampleId);
  const stagehand = new Stagehand({ env: "LOCAL", verbose: 1 });
  await stagehand.init();

  let server: Server | null = null;
  let localUrl: string = example.url; // Default to the original URL

  try {
    if (example.source === "mhtml") {
      // Handle MHTML Source
      const mhtmlFilePath = path.resolve(
        __dirname,
        `../bananalyzer/static/${example.id}/index.mhtml`,
      );
      const parsedMHTML = await parseMHTMLFile(mhtmlFilePath);

      // Create Express server to serve the parsed HTML and resources
      const app = createExpressServer(parsedMHTML.html, parsedMHTML.resources);
      server = app.listen(0); // Listen on a random available port
      const port = (server.address() as any).port;
      localUrl = `http://localhost:${port}/`;
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

    console.log(
      "Schema definition:",
      JSON.stringify(schemaDefinition, null, 2),
    );

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
            return false;
          }
        } else if (evalItem.options) {
          const matchesAny = evalItem.options.some((option) =>
            validateJsonMatch(option, extractionResult),
          );
          if (!matchesAny) {
            console.log("❌ No JSON match found in options");
            return false;
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
          return false;
        }
      }
    }

    console.log("✅ All evaluations passed");
    return true;
  } catch (error) {
    console.error("Error during evaluation:", error);
    return false;
  } finally {
    if (server) {
      server.close();
    }
    await stagehand.context.close();
  }
}

export const evalExampleIds = [
  "JNOSAEEZO4j2unWHPFBdO", // Detail - Fail
  "KuDD2GuMDlbuKO4ozdbDA", // Listing - Detail - Success
  "nAXVoJDSuul938vtPvfFB", // Listing - Detail - Fail (did not scroll enough)
  "GQfYTjppPhTgYtsuFUbXF", // Listing - Detail - Fail (did not scroll enough to get to the correct content)
];

const singleExampleId = "GQfYTjppPhTgYtsuFUbXF";

// Run the evaluation
evaluateExample(singleExampleId)
  .then((result) => console.log("Evaluation result:", result))
  .catch((error) => console.error("Evaluation error:", error));
