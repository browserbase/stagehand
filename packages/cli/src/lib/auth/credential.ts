import { validateHeaderValue } from "node:http";
import { z } from "zod";

import { fail } from "../errors.js";

export const productionApiOrigin = "https://api.browserbase.com";
export const developmentApiOrigin = "https://api.dev.browserbase.com";
const SavedCredentialSchema = z.object({
  apiKey: z
    .string()
    .min(1)
    .max(16384)
    .refine((value) => {
      // Keys are opaque, but must survive HTTP header transport unchanged.
      try {
        validateHeaderValue("X-BB-API-Key", value);
        return value.trim() === value;
      } catch {
        return false;
      }
    }),
  projectId: z.string().min(1),
  apiOrigin: z.enum([productionApiOrigin, developmentApiOrigin]),
});

export type SavedCredential = z.infer<typeof SavedCredentialSchema>;

export function validateCredential(value: unknown, apiOrigin?: string): SavedCredential {
  const result = SavedCredentialSchema.safeParse(value);
  if (!result.success || (apiOrigin !== undefined && result.data.apiOrigin !== apiOrigin)) {
    fail("Invalid saved credential or login response. Run browse login again.");
  }
  return result.data;
}
