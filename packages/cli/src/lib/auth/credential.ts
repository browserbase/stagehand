import { fail } from "../errors.js";

export const productionApiOrigin = "https://api.browserbase.com";
export const developmentApiOrigin = "https://api.dev.browserbase.com";
export interface SavedCredential {
  apiKey: string;
  projectId: string;
  apiOrigin: string;
}

export function validateCredential(value: unknown, apiOrigin?: string): SavedCredential {
  const record = value as Partial<SavedCredential> | null;
  if (
    !record ||
    typeof record.apiKey !== "string" ||
    !/^[\x21-\x7e]{1,16384}$/.test(record.apiKey) ||
    typeof record.projectId !== "string" ||
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(record.projectId) ||
    ![productionApiOrigin, developmentApiOrigin].includes(record.apiOrigin ?? "") ||
    (apiOrigin !== undefined && record.apiOrigin !== apiOrigin)
  ) {
    fail("Invalid saved credential or login response. Run browse login again.");
  }
  return { apiKey: record.apiKey, projectId: record.projectId, apiOrigin: record.apiOrigin! };
}
