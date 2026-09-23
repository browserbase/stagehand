import { requestBrowserbaseJson } from "../cloud/api.js";

export interface SecretsApiOptions {
  apiKey?: string;
  baseUrl?: string;
}

export interface Secret {
  id: string;
  secretKey: string;
}

export interface SecretPage {
  data: Secret[];
  limit: number;
  nextCursor: string | null;
}

export interface ListSecretsOptions {
  limit?: number;
  cursor?: string;
  startAt?: string;
  endAt?: string;
}

export function listSecrets(
  options: SecretsApiOptions,
  query: ListSecretsOptions,
): Promise<SecretPage> {
  return requestBrowserbaseJson(options, withQuery("/v1/secrets", query));
}

function withQuery(path: string, query: ListSecretsOptions): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}
