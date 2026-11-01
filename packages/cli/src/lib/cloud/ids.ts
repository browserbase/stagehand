import { z } from "zod";

import { fail } from "../errors.js";

// Check the UUID shape without pinning resource IDs to a UUID version.
const uuidSchema = z.guid().length(36);

export function isUuid(value: string): boolean {
  return uuidSchema.safeParse(value).success;
}

export function parseUuid(value: string, label: string): string {
  if (!isUuid(value)) {
    fail(`${label} must be a UUID.`);
  }
  return value;
}
