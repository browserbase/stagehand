import { StagehandInvalidArgumentError } from "./types/public/sdkErrors.js";
import type {
  ClientOptions,
  GoogleVertexProviderSettings,
  ProviderConfig,
} from "./types/public/model.js";

type VertexCompatibleClientOptions = ClientOptions &
  Partial<GoogleVertexProviderSettings>;

export function getProviderFromModelName(
  modelName?: string,
): string | undefined {
  return typeof modelName === "string" && modelName.includes("/")
    ? modelName.split("/", 1)[0]
    : undefined;
}

function hasValue<T>(value: T | undefined | null): value is T {
  return value !== undefined && value !== null;
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
  if (hasValue(vertexOptions.googleAuthOptions)) {
    legacyVertexOptions.googleAuthOptions = vertexOptions.googleAuthOptions;
  }
  if (hasValue(options.headers)) {
    legacyVertexOptions.headers = options.headers;
  }

  return Object.keys(legacyVertexOptions).length > 0
    ? legacyVertexOptions
    : undefined;
}

function normalizeProviderConfig(
  options?: ClientOptions,
  modelProvider?: string,
): ProviderConfig | undefined {
  if (!options) {
    return undefined;
  }

  const legacyVertexOptions = getLegacyVertexOptions(options);

  if (options.providerConfig?.provider === "vertex") {
    return {
      provider: "vertex",
      options: {
        ...(legacyVertexOptions ?? {}),
        ...options.providerConfig.options,
      },
    };
  }

  if (options.providerConfig) {
    return options.providerConfig;
  }

  if (modelProvider === "vertex" && legacyVertexOptions) {
    return {
      provider: "vertex",
      options: legacyVertexOptions,
    };
  }

  return undefined;
}

function validateProviderConfig(
  modelProvider: string | undefined,
  providerConfig: ProviderConfig | undefined,
): void {
  if (
    modelProvider &&
    providerConfig &&
    providerConfig.provider !== modelProvider
  ) {
    throw new StagehandInvalidArgumentError(
      `providerConfig.provider "${providerConfig.provider}" must match the model provider "${modelProvider}"`,
    );
  }
}

export function normalizeClientOptionsForModel(
  options?: ClientOptions,
  modelName?: string,
): ClientOptions | undefined {
  if (!options) {
    return undefined;
  }

  const modelProvider = getProviderFromModelName(modelName);
  const providerConfig = normalizeProviderConfig(options, modelProvider);
  validateProviderConfig(modelProvider, providerConfig);

  const headers = options.headers;
  const rest = { ...options } as Record<string, unknown>;
  delete rest.project;
  delete rest.location;
  delete rest.googleAuthOptions;
  delete rest.headers;
  delete rest.providerConfig;

  const shouldKeepTopLevelHeaders =
    headers !== undefined &&
    (!providerConfig || providerConfig.provider !== "vertex");

  return {
    ...rest,
    ...(shouldKeepTopLevelHeaders ? { headers } : {}),
    ...(providerConfig ? { providerConfig } : {}),
  };
}

export function getProviderConstructorOptions(
  subProvider: string,
  options?: ClientOptions,
): ClientOptions | undefined {
  const normalizedOptions = normalizeClientOptionsForModel(
    options,
    `${subProvider}/model`,
  );

  if (!normalizedOptions) {
    return undefined;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { providerConfig, provider: _provider, ...rest } = normalizedOptions;

  if (providerConfig?.provider === "bedrock") {
    return {
      ...rest,
      ...providerConfig.options,
    };
  }

  if (providerConfig?.provider === "vertex") {
    return {
      ...rest,
      ...providerConfig.options,
    } as ClientOptions;
  }

  return rest as ClientOptions;
}
