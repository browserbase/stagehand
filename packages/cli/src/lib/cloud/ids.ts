import { fail } from "../errors.js";

// Check the UUID shape without pinning resource IDs to a UUID version.
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string): boolean {
  return value.length === 36 && uuidPattern.test(value);
}

export function parseUuid(value: string, label: string): string {
  if (!isUuid(value)) {
    fail(`${label} must be a UUID.`);
  }
  return value;
}
