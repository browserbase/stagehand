import { tool } from "ai";
import { z } from "zod/v3";
import { Stagehand } from "../../index";

export const createFillFormVisionTool = (stagehand: Stagehand) =>
  tool({
    description: `📝 FORM FILL - SPECIALIZED MULTI-FIELD INPUT TOOL

    CRITICAL: Use this for ANY form with 2+ input fields (text inputs, textareas, etc.)
    IMPORTANT:  ensure the fields are visible within the current viewport 

    WHY THIS TOOL EXISTS:
    • Forms are the #1 use case for multi-field input
    • Optimized specifically for input/textarea elements
    • 4-6x faster than individual typing actions

    Use fillForm: Pure form filling (inputs, textareas only)
    MANDATORY USE CASES (always use fillForm for these):
    Registration forms: name, email, password fields
    Contact forms: name, email, message fields  
    Checkout forms: address, payment info fields
    Profile updates: multiple user data fields
    Search filters: multiple criteria inputs


 `,
    parameters: z.object({
      fields: z
        .array(
          z.object({
            action: z
              .string()
              .describe(
                "Description of the typing action, e.g. 'type foo into the bar field'",
              ),
            value: z.string().describe("Text to type into the target field"),
            coordinates: z
              .object({
                x: z.number(),
                y: z.number(),
              })
              .describe("Coordinates of the target field"),
          }),
        )
        .min(2, "Provide at least two fields to fill"),
    }),

    execute: async ({ fields }) => {
      for (const field of fields) {
        await stagehand.page.mouse.move(
          field.coordinates.x,
          field.coordinates.y,
        );
        await stagehand.page.mouse.click(
          field.coordinates.x,
          field.coordinates.y,
        );
        await stagehand.page.keyboard.type(field.value);
        await stagehand.page.waitForTimeout(100);
      }
      return {
        success: true,
        playwrightArguments: fields,
      };
    },
  });
