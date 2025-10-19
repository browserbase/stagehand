import { GoogleGenAIOptions } from "@google/genai";
import { LogLine } from "../../types/log";
import { AvailableModel, ClientOptions } from "../../types/model";
import { LLMCache } from "../cache/LLMCache";
import { GoogleClient } from "./GoogleClient";

export interface GoogleVertexClientOptions extends GoogleGenAIOptions {
  vertexai: boolean;
  project: string;
  location: string;
}

export class GoogleVertexClient extends GoogleClient {
  constructor({
    logger,
    enableCaching = false,
    cache,
    modelName,
    clientOptions,
  }: {
    logger: (message: LogLine) => void;
    enableCaching?: boolean;
    cache?: LLMCache;
    modelName: AvailableModel;
    clientOptions?: ClientOptions;
  }) {
    // Ensure vertex ai configuration is present
    const vertexOptions = clientOptions as GoogleVertexClientOptions;
    if (!vertexOptions?.vertexai) {
      throw new Error("GoogleVertexClient requires vertexai option to be true");
    }
    if (!vertexOptions?.project) {
      throw new Error("GoogleVertexClient requires project configuration");
    }
    if (!vertexOptions?.location) {
      throw new Error("GoogleVertexClient requires location configuration");
    }

    super({
      logger,
      enableCaching,
      cache,
      modelName,
      clientOptions: {
        ...vertexOptions,
        vertexai: true,
      },
    });
  }
}
