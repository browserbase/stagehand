/**
 * Custom client for Z.ai (Zhipu AI) models like GLM-4.7.
 *
 * Z.ai's API is OpenAI-compatible but uses a proprietary `thinking` parameter
 * to control reasoning. This client extends CustomOpenAIClient to pass it
 * via the OpenAI SDK's extra body API.
 *
 * Usage:
 *   import { ZhipuClient } from '@browserbasehq/stagehand';
 *   import OpenAI from 'openai';
 *
 *   const stagehand = new Stagehand({
 *     env: 'LOCAL',
 *     llmClient: new ZhipuClient({
 *       modelName: 'glm-4.7',
 *       client: new OpenAI({
 *         apiKey: process.env.ZHIPU_API_KEY,
 *         baseURL: 'https://api.z.ai/api/coding/paas/v4',
 *       }),
 *     }),
 *   });
 */

import OpenAI from "openai";
import { CustomOpenAIClient } from "./customOpenAI";

export class ZhipuClient extends CustomOpenAIClient {
  constructor({
    modelName,
    client,
    enableThinking = false,
  }: {
    modelName: string;
    client: OpenAI;
    enableThinking?: boolean;
  }) {
    super({
      modelName,
      client,
      extraBody: {
        thinking: { type: enableThinking ? "enabled" : "disabled" },
      },
    });
  }
}
