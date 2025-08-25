import { tool } from "ai";
import { z } from "zod";
import { ObserveResult } from "@/dist";
import { Page } from "@/types/page";

export const createFillFormTool = (page: Page) => {
  return tool({
    description: `📝 FORM FILL - SPECIALIZED MULTI-FIELD INPUT TOOL

    ⚠️ CRITICAL: Use this for ANY form with 2+ input fields (text inputs, textareas, etc.)

    WHY THIS TOOL EXISTS:
    • Forms are the #1 use case for multi-field input
    • Optimized specifically for input/textarea elements
    • Handles form validation and field dependencies better than actionChain
    • 4-6x faster than individual typing actions

    WHEN TO USE fillForm vs actionChain:
    ✅ Use fillForm: Pure form filling (inputs, textareas only)
    ✅ Use actionChain: Forms + buttons/clicks (fill fields + click submit)

    MANDATORY USE CASES (always use fillForm for these):
    ✅ Registration forms: name, email, password fields
    ✅ Contact forms: name, email, message fields  
    ✅ Checkout forms: address, payment info fields
    ✅ Profile updates: multiple user data fields
    ✅ Search filters: multiple criteria inputs

    DECISION RULE: If you see 2+ input fields to fill, use fillForm first, then actionChain for any buttons.

    PERFORMANCE COMPARISON:
    • Individual typing: type → observe → type → observe (very slow)
    • fillForm: observe all inputs → fill all (fast, form-optimized)
    • actionChain: good for mixed actions, but fillForm is better for pure input filling

    PARAMETER DETAILS:
    • fields: Array of { action, value } objects.
      – action: short description of where to type (e.g. "type 'john@example.com' into the email input").
      – value: the exact text to enter.
    • hasIframe (optional): if true, all fields are assumed to live inside the same iframe; otherwise the tool auto-detects on a per-field basis.

    ⚠️ IMPORTANT: Only use for input/textarea elements. For dropdowns, checkboxes, or buttons, use actionChain.
    `,

    parameters: z.object({
      fields: z
        .array(
          z.object({
            action: z
              .string()
              .describe(
                'Description of the typing action, e.g. "type foo into the bar field"',
              ),
            value: z.string().describe("Text to type into the target field"),
          }),
        )
        .min(1, "Provide at least one field to fill"),
      hasIframe: z
        .boolean()
        .optional()
        .default(false)
        .describe(
          "Set to true if all target elements are inside a single iframe",
        ),
      disableCodeGen: z
        .boolean()
        .describe(
          "Set to true to exclude this action from generated scripts (e.g., for login forms), do not use this for now, it is work in progress ",
        )
        .default(false),
    }),

    execute: async ({
      fields,
      disableCodeGen,
    }: {
      fields: { action: string; value: string }[];
      disableCodeGen?: boolean;
    }) => {
      const startTime = Date.now();

      const observations = (await page.observe({
        instruction: `Return observation results for the entire form related to the following actions: ${fields
          .map((f) => f.action)
          .join(" ; ")}`,
      })) as unknown;

      const sleep = (ms: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, ms));

      const fieldResults: Array<{
        action: string;
        success: boolean;
        message: string;
        value: string;
        observeResults?: ObserveResult[];
        disableCodeGen?: boolean;
      }> = [];

      for (let i = 0; i < fields.length; i++) {
        const { action, value } = fields[i];

        let primaryObserve: ObserveResult | null = null;
        if (Array.isArray(observations)) {
          primaryObserve =
            (observations as unknown as ObserveResult[])[i] ?? null;
        } else if (i === 0 && observations) {
          primaryObserve = observations as unknown as ObserveResult;
        }

        try {
          const fillValue = value.trim();
          if (!fillValue) {
            fieldResults.push({
              action,
              success: false,
              message: "Empty value provided",
              value,
              disableCodeGen,
            });
            continue;
          }

          if (
            primaryObserve &&
            primaryObserve.selector &&
            primaryObserve.method
          ) {
            const fillRequest: ObserveResult = {
              ...primaryObserve,
              method: "fill",
              arguments: [fillValue],
              description: action,
            };
            await page.act(fillRequest);
          } else {
            await page.act({ action });
          }

          fieldResults.push({
            action,
            success: true,
            message: "filled",
            value,
            observeResults: primaryObserve ? [primaryObserve] : [],
            disableCodeGen,
          });

          await sleep(50);
        } catch (err) {
          console.error("fillForm error:", err);
          fieldResults.push({
            action,
            success: false,
            message: err instanceof Error ? err.message : "Unknown error",
            value,
            disableCodeGen,
          });
        }
      }

      // ===== Log total duration =====
      const totalDurationMs = Date.now() - startTime;
      console.log(
        `fillForm: Completed filling ${fields.length} field(s) in ${totalDurationMs}ms`,
      );

      return {
        overallSuccess: fieldResults.every((r) => r.success),
        results: fieldResults,
        actions: fieldResults.map((result) => ({
          type: "fill",
          selector: result.action,
          value: result.value,
          success: result.success,
          timestamp: Date.now(),
        })),
        disableCodeGen,
        timestamp: Date.now(),
      };
    },

    experimental_toToolResultContent: (result) => {
      const items = result.results.map((item) => {
        const icon = item.success ? "✅" : "❌";
        const text = item.success
          ? `${icon} [FILL] ${item.action} | "${item.value}" | success`
          : `${icon} [FILL] ${item.action} | "${item.value}" | error: ${item.message}`;

        return { type: "text" as const, text };
      });

      const successCount = result.results.filter((r) => r.success).length;
      const totalCount = result.results.length;
      const summaryText = `Form Fill: ${successCount}/${totalCount} fields completed successfully`;

      return [{ type: "text" as const, text: summaryText }, ...items];
    },
  });
};
