import { defineExtension } from "eve/extension";
import { z } from "zod";

export default defineExtension({
  config: z.object({
    apiKey: z.string().min(1).optional(),
    model: z.string().min(1).default("openai/gpt-6-luna"),
    sessionTimeoutSeconds: z.number().int().min(60).max(21_600).default(900),
    proxies: z.boolean().optional(),
  }),
});
