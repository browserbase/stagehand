import { z } from "zod/v4";
import { LLMUsageSchema } from "@browserbasehq/stagehand-protocol/schemas";
import type {
  ClientModelReference,
  ModelConfig,
  StagehandResultUsage,
} from "@browserbasehq/stagehand-protocol/types";
import * as inference from "../../inference.js";
import type { ClientLlmRequest } from "../../llm/clientLlmClient.js";
import type { GatewayContext } from "../../llm/gatewayClient.js";
import type { Progress } from "../../understudy/progress.js";
import * as llmService from "../llmService.js";

export async function readTableRules(
  evidence: string,
  {
    model,
    clientLLMGenerate,
    gateway,
    progress,
    usage,
  }: {
    model?: ModelConfig | ClientModelReference;
    clientLLMGenerate: ClientLlmRequest;
    gateway?: GatewayContext;
    progress: Progress;
    usage: StagehandResultUsage;
  },
): Promise<number[]> {
  const { data } = await inference.extract({
    instruction:
      "Select one copy rule for each requested field in field order. Each source column and rule index starts at zero. Cells split into parts are read from the start through the part whose ends array contains the selected rule index. The rule must yield the exact requested field in EVERY row. Inspect the original instruction, schema, sections, all rows, and outside-table text for filters, transformations, omissions or continuations. If all rows in source order and all fields cannot be copied as requested, return an empty rules array.",
    domElements: evidence,
    schema: z.object({ rules: z.array(z.number().int()) }),
    generate: (input) =>
      progress.run("reviewing table copy rules", async () => {
        const started = performance.now();
        try {
          const response = await llmService.generate(
            model,
            input,
            async (request) => {
              const raw = await clientLLMGenerate(request);
              // Structured output validation can reject a billable client reply.
              const receipt = LLMUsageSchema.safeParse(raw?.usage);
              if (receipt.success) Object.assign(usage, receipt.data);
              return raw;
            },
            gateway,
          );
          if (response.usage) Object.assign(usage, response.usage);
          return response;
        } finally {
          usage.inferenceTimeMs += Math.round(performance.now() - started);
        }
      }),
  });
  return data.rules;
}
