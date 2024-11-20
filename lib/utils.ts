import crypto from "crypto";

export function generateId(operation: string) {
  return crypto.createHash("sha256").update(operation).digest("hex");
}
