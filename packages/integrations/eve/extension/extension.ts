import { defineExtension } from "eve/extension";
import { z } from "zod";

export default defineExtension({
  config: z.object({
    apiKey: z.string().min(1),
    model: z.string().min(1).default("openai/gpt-5.4-mini"),
    sessionTimeoutSeconds: z.number().int().min(60).max(21_600).default(900),
    proxies: z.boolean().default(false),
  }),
});
