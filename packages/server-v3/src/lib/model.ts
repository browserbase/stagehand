import type {
  Api,
  BedrockProviderOptions,
  ClientOptions,
  GoogleVertexProviderSettings,
  ModelConfiguration,
} from "@browserbasehq/stagehand";

const DEFAULT_MODEL_NAME = "gpt-4o";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function copyStringProperty<T extends string>(
  target: Record<string, unknown>,
  source: Record<string, unknown>,
  key: T,
) {
  const value = source[key];
  if (typeof value === "string") {
    target[key] = value;
  }
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  if (Object.values(value).some((item) => typeof item !== "string")) {
    return undefined;
  }

  return value as Record<string, string>;
}

function toGoogleAuthOptions(
  value: unknown,
): GoogleVertexProviderSettings["googleAuthOptions"] | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const googleAuthOptions: NonNullable<
    GoogleVertexProviderSettings["googleAuthOptions"]
  > = {};

  if (isRecord(value.credentials)) {
    const credentials: Record<string, string> = {};
    for (const key of [
      "type",
      "project_id",
      "private_key_id",
      "private_key",
      "client_email",
      "client_id",
      "auth_uri",
      "token_uri",
      "auth_provider_x509_cert_url",
      "client_x509_cert_url",
      "universe_domain",
    ] as const) {
      copyStringProperty(credentials, value.credentials, key);
    }

    if (Object.keys(credentials).length > 0) {
      googleAuthOptions.credentials = credentials;
    }
  }

  if (typeof value.scopes === "string") {
    googleAuthOptions.scopes = value.scopes;
  } else if (
    Array.isArray(value.scopes) &&
    value.scopes.every((item) => typeof item === "string")
  ) {
    googleAuthOptions.scopes = value.scopes;
  }

  if (typeof value.projectId === "string") {
    googleAuthOptions.projectId = value.projectId;
  }

  if (typeof value.universeDomain === "string") {
    googleAuthOptions.universeDomain = value.universeDomain;
  }

  return Object.keys(googleAuthOptions).length > 0
    ? googleAuthOptions
    : undefined;
}

function toVertexProviderOptions(
  value: unknown,
): GoogleVertexProviderSettings | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const providerOptions: GoogleVertexProviderSettings = {};
  for (const key of ["project", "location", "baseURL"] as const) {
    copyStringProperty(providerOptions as Record<string, unknown>, value, key);
  }

  const headers = toStringRecord(value.headers);
  if (headers) {
    providerOptions.headers = headers;
  }

  const googleAuthOptions = toGoogleAuthOptions(value.googleAuthOptions);
  if (googleAuthOptions) {
    providerOptions.googleAuthOptions = googleAuthOptions;
  }

  return Object.keys(providerOptions).length > 0 ? providerOptions : undefined;
}

function toBedrockProviderOptions(
  value: unknown,
): BedrockProviderOptions | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const providerOptions: BedrockProviderOptions = {};
  for (const key of [
    "region",
    "accessKeyId",
    "secretAccessKey",
    "sessionToken",
    "apiKey",
    "baseURL",
  ] as const) {
    copyStringProperty(providerOptions as Record<string, unknown>, value, key);
  }

  const headers = toStringRecord(value.headers);
  if (headers) {
    providerOptions.headers = headers;
  }

  return Object.keys(providerOptions).length > 0 ? providerOptions : undefined;
}

export function normalizeApiModelConfig(
  model: Api.ModelConfig | string | undefined,
): ModelConfiguration | undefined {
  if (!model) {
    return undefined;
  }

  if (typeof model === "string") {
    return { modelName: model };
  }

  const { providerConfig, ...modelWithoutProviderConfig } = model;
  const normalizedModel = {
    ...(modelWithoutProviderConfig as ClientOptions & {
      modelName?: string;
      provider?: string;
    }),
    modelName: model.modelName ?? DEFAULT_MODEL_NAME,
  } as ClientOptions & {
    modelName: string;
    provider?: string;
  };

  delete normalizedModel.provider;

  if (isRecord(providerConfig)) {
    if (providerConfig.provider === "bedrock") {
      const providerOptions = toBedrockProviderOptions(providerConfig.options);
      if (providerOptions) {
        normalizedModel.providerOptions = providerOptions;
      }
    }

    if (providerConfig.provider === "vertex") {
      const providerOptions = toVertexProviderOptions(providerConfig.options);
      if (providerOptions) {
        normalizedModel.providerOptions = providerOptions;
      }
    }
  }

  return normalizedModel;
}
