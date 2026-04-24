import { StagehandInvalidArgumentError } from "./types/public/sdkErrors.js";
import type {
  BedrockProviderOptions,
  ClientOptions,
  GoogleVertexProviderSettings,
} from "./types/public/model.js";
import type { Api } from "./types/public/index.js";

type VertexCompatibleClientOptions = ClientOptions &
  Partial<GoogleVertexProviderSettings>;

type SerializableGoogleServiceAccountCredentials = NonNullable<
  NonNullable<GoogleVertexProviderSettings["googleAuthOptions"]>["credentials"]
>;

type SerializableGoogleAuthOptions = {
  credentials?: SerializableGoogleServiceAccountCredentials;
  scopes?: string | string[];
  projectId?: string;
  universeDomain?: string;
};

function hasValue<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getRecord(value: unknown): Record<string, unknown> | undefined {
  return isRecord(value) ? value : undefined;
}

function toSerializableHeaders(
  headers: unknown,
): Record<string, string> | undefined {
  if (typeof Headers !== "undefined" && headers instanceof Headers) {
    return Object.fromEntries(headers.entries());
  }

  if (!isRecord(headers)) {
    return undefined;
  }

  if (Object.values(headers).some((value) => typeof value !== "string")) {
    return undefined;
  }

  return headers as Record<string, string>;
}

function withStringProperty<T extends string>(
  target: Record<string, unknown>,
  source: Record<string, unknown> | undefined,
  key: T,
) {
  const value = source?.[key];
  if (typeof value === "string") {
    target[key] = value;
  }
}

function toSerializableGoogleServiceAccountCredentials(
  value: unknown,
): SerializableGoogleServiceAccountCredentials | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

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
    withStringProperty(credentials, value, key);
  }

  return Object.keys(credentials).length > 0
    ? (credentials as SerializableGoogleServiceAccountCredentials)
    : undefined;
}

function toSerializableGoogleAuthOptions(
  value: unknown,
): SerializableGoogleAuthOptions | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const credentials = toSerializableGoogleServiceAccountCredentials(
    value.credentials,
  );
  const scopes =
    typeof value.scopes === "string"
      ? value.scopes
      : Array.isArray(value.scopes) &&
          value.scopes.every((item) => typeof item === "string")
        ? value.scopes
        : undefined;
  const projectId =
    typeof value.projectId === "string" ? value.projectId : undefined;
  const universeDomain =
    typeof value.universeDomain === "string"
      ? value.universeDomain
      : undefined;

  const googleAuthOptions: SerializableGoogleAuthOptions = {};
  if (credentials) {
    googleAuthOptions.credentials = credentials;
  }
  if (scopes) {
    googleAuthOptions.scopes = scopes;
  }
  if (projectId) {
    googleAuthOptions.projectId = projectId;
  }
  if (universeDomain) {
    googleAuthOptions.universeDomain = universeDomain;
  }

  return Object.keys(googleAuthOptions).length > 0
    ? googleAuthOptions
    : undefined;
}

export function getProviderFromModelName(
  modelName?: string,
): string | undefined {
  return typeof modelName === "string" && modelName.includes("/")
    ? modelName.split("/", 1)[0]
    : undefined;
}

function getLegacyVertexOptions(
  options?: ClientOptions,
): GoogleVertexProviderSettings | undefined {
  if (!options) {
    return undefined;
  }

  const vertexOptions = options as VertexCompatibleClientOptions;
  const legacyVertexOptions: GoogleVertexProviderSettings = {};

  if (hasValue(vertexOptions.project)) {
    legacyVertexOptions.project = vertexOptions.project;
  }
  if (hasValue(vertexOptions.location)) {
    legacyVertexOptions.location = vertexOptions.location;
  }
  const googleAuthOptions = toSerializableGoogleAuthOptions(
    vertexOptions.googleAuthOptions,
  );
  if (googleAuthOptions) {
    legacyVertexOptions.googleAuthOptions = googleAuthOptions;
  }

  const headers = toSerializableHeaders(options.headers);
  if (headers) {
    legacyVertexOptions.headers = headers;
  }

  return Object.keys(legacyVertexOptions).length > 0
    ? legacyVertexOptions
    : undefined;
}

function getNormalizedVertexProviderOptions(
  options?: ClientOptions,
): GoogleVertexProviderSettings | undefined {
  if (!options) {
    return undefined;
  }

  const legacyVertexOptions = getLegacyVertexOptions(options);
  const rawProviderOptions = options.providerOptions;
  const providerOptions = getRecord(rawProviderOptions);

  if (!legacyVertexOptions && !providerOptions) {
    return undefined;
  }

  const normalizedVertexOptions: GoogleVertexProviderSettings = {
    ...(legacyVertexOptions ?? {}),
  };

  const providerProject = providerOptions?.project;
  if (typeof providerProject === "string") {
    normalizedVertexOptions.project = providerProject;
  }

  const providerLocation = providerOptions?.location;
  if (typeof providerLocation === "string") {
    normalizedVertexOptions.location = providerLocation;
  }

  const providerGoogleAuthOptions = toSerializableGoogleAuthOptions(
    providerOptions?.googleAuthOptions,
  );
  if (providerGoogleAuthOptions) {
    normalizedVertexOptions.googleAuthOptions = providerGoogleAuthOptions;
  }

  const providerHeaders = toSerializableHeaders(providerOptions?.headers);
  if (providerHeaders) {
    normalizedVertexOptions.headers = providerHeaders;
  }

  return Object.keys(normalizedVertexOptions).length > 0
    ? normalizedVertexOptions
    : undefined;
}

function getBedrockProviderOptions(
  options?: ClientOptions,
): BedrockProviderOptions | undefined {
  const rawProviderOptions = getRecord(options?.providerOptions);
  if (!options || !rawProviderOptions) {
    return undefined;
  }
  const bedrockProviderOptions: BedrockProviderOptions = {};

  for (const key of [
    "region",
    "accessKeyId",
    "secretAccessKey",
    "sessionToken",
  ] as const) {
    const value = rawProviderOptions[key];
    if (typeof value === "string") {
      bedrockProviderOptions[key] = value;
    }
  }

  return Object.keys(bedrockProviderOptions).length > 0
    ? bedrockProviderOptions
    : undefined;
}

function getProviderConfig(
  options: ClientOptions,
  modelName?: string,
): { provider: string; options: Record<string, unknown> } | undefined {
  const modelProvider = getProviderFromModelName(modelName);

  if (!options.providerOptions) {
    if (modelProvider === "vertex") {
      const vertexOptions = getNormalizedVertexProviderOptions(options);
      if (vertexOptions) {
        return {
          provider: "vertex",
          options: vertexOptions as Record<string, unknown>,
        };
      }
    }
    return undefined;
  }

  if (modelProvider === "bedrock") {
    const bedrockOptions = getBedrockProviderOptions(options);
    if (!bedrockOptions) {
      return undefined;
    }

    return {
      provider: "bedrock",
      options: bedrockOptions as Record<string, unknown>,
    };
  }

  if (modelProvider === "vertex") {
    const vertexOptions = getNormalizedVertexProviderOptions(options);
    if (!vertexOptions) {
      return undefined;
    }

    return {
      provider: "vertex",
      options: vertexOptions as Record<string, unknown>,
    };
  }

  throw new StagehandInvalidArgumentError(
    `providerOptions is only supported for bedrock/... and vertex/... models. Received "${modelName ?? "unknown"}".`,
  );
}

export function normalizeClientOptionsForModel(
  options?: ClientOptions,
  modelName?: string,
): ClientOptions | undefined {
  if (!options) {
    return undefined;
  }

  const normalizedOptions = { ...options } as ClientOptions & {
    region?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    sessionToken?: string;
  };
  const modelProvider = getProviderFromModelName(modelName);
  const serializedHeaders = toSerializableHeaders(options.headers);

  if (serializedHeaders) {
    normalizedOptions.headers = serializedHeaders;
  }

  if (modelProvider === "bedrock") {
    const bedrockOptions = getBedrockProviderOptions(options);
    if (bedrockOptions) {
      if (normalizedOptions.region === undefined) {
        normalizedOptions.region = bedrockOptions.region;
      }
      if (normalizedOptions.accessKeyId === undefined) {
        normalizedOptions.accessKeyId = bedrockOptions.accessKeyId;
      }
      if (normalizedOptions.secretAccessKey === undefined) {
        normalizedOptions.secretAccessKey = bedrockOptions.secretAccessKey;
      }
      if (normalizedOptions.sessionToken === undefined) {
        normalizedOptions.sessionToken = bedrockOptions.sessionToken;
      }
    }
  }

  if (modelProvider === "vertex") {
    const vertexOptions = getNormalizedVertexProviderOptions(options);
    if (vertexOptions) {
      const normalizedVertexOptions =
        normalizedOptions as VertexCompatibleClientOptions & {
          region?: string;
          accessKeyId?: string;
          secretAccessKey?: string;
          sessionToken?: string;
        };

      if (vertexOptions.project !== undefined) {
        normalizedVertexOptions.project = vertexOptions.project;
      }
      if (vertexOptions.location !== undefined) {
        normalizedVertexOptions.location = vertexOptions.location;
      }
      if (vertexOptions.googleAuthOptions !== undefined) {
        normalizedVertexOptions.googleAuthOptions =
          vertexOptions.googleAuthOptions;
      }
      if (vertexOptions.headers !== undefined) {
        normalizedVertexOptions.headers = vertexOptions.headers;
      }
    }
  }

  return normalizedOptions;
}

export function toApiModelClientOptions(
  options?: ClientOptions,
  modelName?: string,
): Api.ModelClientOptions | undefined {
  if (!options) {
    return undefined;
  }

  const normalizedOptions = normalizeClientOptionsForModel(options, modelName);
  if (!normalizedOptions) {
    return undefined;
  }

  const providerConfig = getProviderConfig(normalizedOptions, modelName);
  const requestOptions = {
    ...normalizedOptions,
  } as Record<string, unknown>;

  delete requestOptions.provider;
  delete requestOptions.providerOptions;

  if (providerConfig?.provider === "bedrock") {
    delete requestOptions.region;
    delete requestOptions.accessKeyId;
    delete requestOptions.secretAccessKey;
    delete requestOptions.sessionToken;
  }

  if (providerConfig?.provider === "vertex") {
    delete requestOptions.project;
    delete requestOptions.location;
    delete requestOptions.googleAuthOptions;
    delete requestOptions.headers;
  }

  if (providerConfig) {
    requestOptions.providerConfig = {
      ...providerConfig,
      options: { ...providerConfig.options },
    };
  }

  const headers = toSerializableHeaders(requestOptions.headers);
  if (headers) {
    requestOptions.headers = headers;
  } else {
    delete requestOptions.headers;
  }

  const providerHeaders = toSerializableHeaders(
    isRecord(requestOptions.providerConfig)
      ? (requestOptions.providerConfig as { options?: Record<string, unknown> })
          .options?.headers
      : undefined,
  );
  if (isRecord(requestOptions.providerConfig)) {
    const config = requestOptions.providerConfig as {
      options?: Record<string, unknown>;
    };

    if (config.options) {
      if (providerHeaders) {
        config.options.headers = providerHeaders;
      } else {
        delete config.options.headers;
      }
    }
  }

  return requestOptions as Api.ModelClientOptions;
}
