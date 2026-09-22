import { sealSecret } from "./seal.js";
import { requestBrowserbase, requestBrowserbaseJson } from "../cloud/api.js";

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

export function getSecret(
  options: SecretsApiOptions,
  secretId: string,
): Promise<Secret> {
  return requestBrowserbaseJson(options, secretPath(secretId));
}

export async function deleteSecret(
  options: SecretsApiOptions,
  secretId: string,
): Promise<void> {
  await requestBrowserbase(options, secretPath(secretId), { method: "DELETE" });
}

function secretPath(id: string): string {
  return `/v1/secrets/${encodeURIComponent(id)}`;
}

export async function createSecret(
  options: SecretsApiOptions,
  secretKey: string,
  value: Uint8Array,
): Promise<Secret> {
  const sealed = await encryptValue(options, value);
  return requestBrowserbaseJson(options, "/v1/secrets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      secretKey,
      ...sealed,
    }),
  });
}

export async function updateSecret(
  options: SecretsApiOptions,
  secretId: string,
  value: Uint8Array,
): Promise<Secret> {
  const sealed = await encryptValue(options, value);
  return requestBrowserbaseJson(options, secretPath(secretId), {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(sealed),
  });
}

async function encryptValue(options: SecretsApiOptions, value: Uint8Array) {
  const keypair = await requestBrowserbaseJson<{
    id: string;
    publicKey: string;
  }>(options, "/v1/secrets/keypair");
  const sealedSecretValue = await sealSecret(keypair.publicKey, value);
  return { keypairId: keypair.id, sealedSecretValue };
}

export async function attachFunctionSecret(
  options: SecretsApiOptions,
  functionId: string,
  secretId: string,
): Promise<void> {
  await requestBrowserbase(
    options,
    `/v1/functions/${encodeURIComponent(functionId)}/secrets`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ secretId }),
    },
  );
}
