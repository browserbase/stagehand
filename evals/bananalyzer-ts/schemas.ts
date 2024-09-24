import { Stagehand } from "../../lib";
import { z } from "zod";
import fs from "fs";
import path from "path";

// Define types
export const ExampleType = z.enum(["listing", "detail", "listing_detail"]);
export const SchemaName = z.enum([
  "job_posting",
  "manufacturing_commerce",
  "contact",
  "contract",
  "forum",
  "attorney",
  "attorney_job_listing",
  // Add any other schema names that exist in your JSON file
]);
export const PossibleTags = z.enum([
  "regression",
  "single-output",
  "accordion",
  "pagination",
  "colliding-tags",
  "contract",
  "badly-formatted",
  "urls",
  "enqueue",
  "infinite-scroll",
  "synthetic",
  "images",
]);

// Add a type definition for SchemaName
type SchemaName =
  | "job_posting"
  | "manufacturing_commerce"
  | "contact"
  | "contract"
  | "forum"
  | "attorney"
  | "attorney_job_listing";

// Define Eval schema
export const EvalSchema = z.object({
  type: z.enum(["json_match", "end_url_match"]).default("json_match"),
  expected: z.any().nullable(),
  options: z.array(z.any()).nullable(),
});

// Update the Example schema to allow schema_ to be either SchemaName or a custom schema object
export const ExampleSchema = z.object({
  id: z.string(),
  url: z.string(),
  resource_path: z.string().nullable(),
  source: z.enum(["html", "mhtml", "hosted", "har"]),
  category: z.string(),
  subcategory: z.string(),
  type: ExampleType,
  goal: z.string(),
  schema_: z.union([SchemaName, z.record(z.any())]),
  evals: z.array(EvalSchema),
  tags: z.array(PossibleTags).default([]),
});

export type Example = z.infer<typeof ExampleSchema>;
export type Eval = z.infer<typeof EvalSchema>;

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

// Separate function to get predefined schema by name
export function getSchemaByName(schemaName: SchemaName): z.ZodRawShape {
  const schemaPath = path.join(__dirname, "../bananalyzer/static/schemas.json");
  const schemasJson = JSON.parse(fs.readFileSync(schemaPath, "utf-8"));

  if (!(schemaName in schemasJson)) {
    throw new Error(`Schema ${schemaName} not found in schemas.json`);
  }

  const schemaDefinition = schemasJson[schemaName];
  return Object.entries(schemaDefinition).reduce((acc, [key, value]) => {
    acc[key] = zodTypeFromJsonSchema(value as any);
    return acc;
  }, {} as z.ZodRawShape);
}

// Function to handle custom JSON schemas
export function getCustomSchema(
  customSchema: Record<string, any>,
): z.ZodRawShape {
  return Object.entries(customSchema).reduce((acc, [key, value]) => {
    acc[key] = zodTypeFromJsonSchema(value);
    return acc;
  }, {} as z.ZodRawShape);
}

// Helper function to convert JSON schema types to Zod types
function zodTypeFromJsonSchema(jsonSchema: any): z.ZodTypeAny {
  switch (jsonSchema.type) {
    case "string":
      return z.string();
    case "number":
      return z.number();
    case "integer":
      return z.number().int();
    case "boolean":
      return z.boolean();
    case "array":
      return z.array(zodTypeFromJsonSchema(jsonSchema.items));
    case "currency":
      return z.string();
    case "object":
      return z.object(
        Object.entries(jsonSchema.properties).reduce((acc, [key, value]) => {
          acc[key] = zodTypeFromJsonSchema(value as any);
          return acc;
        }, {} as z.ZodRawShape),
      );
    case "email":
      return z.string();
    case "url":
      return z.string();
    default:
      return z.any();
  }
}

// Function to read and parse the goals.json file
export function getGoals(): Record<string, string> {
  const goalsPath = path.join(__dirname, "../bananalyzer/static/goals.json");
  return JSON.parse(fs.readFileSync(goalsPath, "utf-8"));
}

// Updated evaluateExample function
export async function evaluateExample(example: Example): Promise<boolean> {
  const stagehand = new Stagehand({ env: "LOCAL", verbose: 1 });
  await stagehand.init();

  try {
    await stagehand.page.goto(example.url);
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

    const extractionResult = await stagehand.extract({
      instruction: goal,
      schema: z.object(schemaDefinition),
      modelName: "gpt-4o-2024-08-06",
    });

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
    await stagehand.context.close();
  }
}

// Example usage
// const exampleData: Example = {
//   id: "VPIrl5m9IfNLKS03UyzNH",
//   url: "https://jobs.careers.microsoft.com/global/en/job/1658879/Software-Engineering-II",
//   source: "mhtml",
//   category: "software",
//   subcategory: "careers",
//   type: "detail",
//   schema_: "job_posting",
//   goal: "Fetch the job posting information on the current page.",
//   evals: [
//     {
//       type: "json_match",
//       expected: {
//         job_id: "1658879",
//         company_name: null,
//         company_description: null,
//         department: "Software Engineering",
//         job_title: "Software Engineering II",
//         job_description:
//           "We are seeking a highly motivated and skilled Software Engineer II to join our Microsoft Intune Engineering Team. As a Software Engineer II on the Intune Engineering team, you will be at the forefront of developing solutions for device management, security, and modern workplace experiences. If you are passionate about building robust software, thrive in a collaborative environment, are excited to grow and learn on the job, and aspire to make an impact on how organizations securely manage their devices and data, this role is perfect for you. \n\n \n\nMicrosoft Intune is the industry leading cloud-based device configuration and security management platform. It empowers organizations to efficiently manage and secure millions of Windows, macOS, iOS, Android, and Linux devices, all from a single, centralized platform. Intune provides tools for configuring device settings, deploying applications, enforcing security policies, and ensuring compliance, all while enabling remote work and enhancing productivity.",
//         location: "Cambridge, Massachusetts, United States",
//         salary_range: {
//           min: null,
//           max: null,
//           currency: null,
//         },
//         date_posted: "Nov 03, 2023",
//         apply_url: null,
//         job_benefits:
//           "\uead4Industry leading healthcare\ue7beEducational resources\ue8ecDiscounts on products and services\ueafdSavings and investments\uf862Maternity and paternity leave\uea17Generous time away\ueb51Giving programs\uefd4Opportunities to network and connect",
//         qualifications:
//           "Bachelor's Degree in Computer Science or related technical field AND 2+ years technical engineering experience with coding in languages including, but not limited to, C, C++, C#, Java, JavaScript, or Python\nOR equivalent experience.\n2+ years of professional experience designing, developing, testing, and shipping software.  \n2+ years technical abilities around design, coding, rapid prototyping, debugging, and problem solving.",
//         preferred_qualifications:
//           "Bachelor's Degree in Computer Science, or related technical discipline AND 4+ years technical engineering experience with coding in languages including, but not limited to, C, C++, C#, Java, JavaScript, or Python\n\nOR equivalent experience.\n\n2+ years of experience in building Android applications. \nExperience with continuous integration/continuous deployment tools, including but not limited to, Azure DevOps. \nCoding, debugging, and problem-solving skills. \nDemonstrated desire and passion for meeting customer needs. \nPassion for contributing to the team culture. \nTrack record of learning and growing.",
//         role: "Join our supportive and collaborative team of engineers working on critical and strategic projects in Intune.\n\nWork on a global cloud security and compliance solution to manage and secure millions of devices.\nDevelop and deliver robust designs and code for both frontend experiences and backend services.\nDebug and optimize work across multiple clients, services and teams in a fast-paced agile environment.\nEmbrace a culture of collaboration, customer obsession, openness, curiosity, integrity, and innovation.\nBe a leader who brings clarity and technical direction to produce resilient engineering designs and drive them to execution.\nIncorporate feedback loops from customers, partners, and stakeholders across disciplines to every solution.\nOwn scenarios end-to-end that span beyond your own area to existing features.",
//         skills: null,
//         recruiter_email: null,
//         application_deadline: null,
//         employment_type: null,
//       },
//     },
//   ],
// };

const exampleData: Example = {
  id: "JNOSAEEZO4j2unWHPFBdO",
  url: "https://asim-shrestha.com/",
  source: "mhtml",
  category: "personal",
  subcategory: "unstructured",
  type: "detail",
  schema_: {
    name: {
      type: "string",
    },
    content: {
      type: "string",
    },
    page_links: {
      type: "array",
      items: {
        type: "object",
        properties: {
          title: {
            type: "string",
          },
          url: {
            type: "url",
          },
        },
      },
    },
  },
  evals: [
    {
      type: "json_match",
      expected: {
        name: "Asim Shrestha",
        content:
          "I'm a software engineer co-founding Reworkd, a YC S23 company extracting structured data from the web. We also made AgentGPT \ud83e\udd16",
        page_links: [
          {
            title: "Writing",
            url: "https://asim-shrestha.com/writing",
          },
          {
            title: "Quotes",
            url: "https://asim-shrestha.com/quotes",
          },
          {
            title: "Reading",
            url: "https://asim-shrestha.com/reading-list",
          },
          {
            title: "Contact",
            url: "https://asim-shrestha.com/contact",
          },
        ],
      },
    },
  ],
};

// Run the evaluation
evaluateExample(exampleData)
  .then((result) => console.log("Evaluation result:", result))
  .catch((error) => console.error("Evaluation error:", error));
