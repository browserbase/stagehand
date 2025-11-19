import type { GoogleGenAIOptions } from "@google/genai";
import type { LogLine } from "../types/public/logs";
import type { AvailableModel, ClientOptions } from "../types/public/model";
import { GoogleClient } from "./GoogleClient";

export interface GoogleVertexClientOptions extends GoogleGenAIOptions {
  vertexai: boolean;
  project: string;
  location: string;
}

export class GoogleVertexClient extends GoogleClient {
  constructor({
    logger,
    modelName,
    clientOptions,
  }: {
    logger: (message: LogLine) => void;
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
      modelName,
      clientOptions: {
        ...vertexOptions,
        vertexai: true,
      },
    });
  }
}
