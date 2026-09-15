import { requestBrowserbase, requestBrowserbaseJson } from "../cloud/api.js";
import { sealSecret } from "./seal.js";

export interface SecretsApiOptions {
  apiKey?: string;
  baseUrl?: string;
}

export interface Secret {
  id: string;
  secretKey: string;
}

export interface SecretKeypair {
  id: string;
  publicKey: string;
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

export function getSecretKeypair(
  options: SecretsApiOptions,
): Promise<SecretKeypair> {
  return requestBrowserbaseJson(options, "/v1/secrets/keypair");
}

export async function createSecret(
  options: SecretsApiOptions,
  secretKey: string,
  value: Uint8Array,
): Promise<Secret> {
  const sealed = await encryptValue(options, value);
  return requestBrowserbaseJson(
    options,
    "/v1/secrets",
    jsonBody("POST", { secretKey, ...sealed }),
  );
}

export async function updateSecret(
  options: SecretsApiOptions,
  secretId: string,
  value: Uint8Array,
): Promise<Secret> {
  const sealed = await encryptValue(options, value);
  return requestBrowserbaseJson(
    options,
    secretPath(secretId),
    jsonBody("PATCH", sealed),
  );
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

export function listSecrets(
  options: SecretsApiOptions,
  query: ListSecretsOptions,
): Promise<SecretPage> {
  return requestBrowserbaseJson(options, withQuery("/v1/secrets", query));
}

export function listFunctionSecrets(
  options: SecretsApiOptions,
  functionId: string,
  query: ListSecretsOptions,
): Promise<SecretPage> {
  return requestBrowserbaseJson(
    options,
    withQuery(functionSecretsPath(functionId), query),
  );
}

export async function attachFunctionSecret(
  options: SecretsApiOptions,
  functionId: string,
  secretId: string,
): Promise<void> {
  await requestBrowserbase(
    options,
    functionSecretsPath(functionId),
    jsonBody("POST", { secretId }),
  );
}

export async function detachFunctionSecret(
  options: SecretsApiOptions,
  functionId: string,
  secretId: string,
): Promise<void> {
  await requestBrowserbase(
    options,
    `${functionSecretsPath(functionId)}/${encodeURIComponent(secretId)}`,
    { method: "DELETE" },
  );
}

async function encryptValue(options: SecretsApiOptions, value: Uint8Array) {
  const keypair = await getSecretKeypair(options);
  return {
    keypairId: keypair.id,
    sealedSecretValue: await sealSecret(keypair.publicKey, value),
  };
}

function secretPath(id: string): string {
  return `/v1/secrets/${encodeURIComponent(id)}`;
}

function functionSecretsPath(id: string): string {
  return `/v1/functions/${encodeURIComponent(id)}/secrets`;
}

function jsonBody(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

function withQuery(path: string, query: ListSecretsOptions): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value));
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}
