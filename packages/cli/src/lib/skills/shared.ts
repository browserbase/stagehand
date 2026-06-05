export const defaultSkillsApiBaseUrl = "https://browse.sh";

export async function responseDetail(response: Response): Promise<string> {
  let body: string;
  try {
    body = await response.text();
  } catch {
    return "";
  }

  if (!body) {
    return "";
  }

  try {
    const payload: unknown = JSON.parse(body);
    if (isRecord(payload)) {
      const message = payload.message ?? payload.error;
      if (typeof message === "string" && message) {
        return `: ${message}`;
      }
    }
  } catch {
    return `: ${body}`;
  }

  return `: ${body}`;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
