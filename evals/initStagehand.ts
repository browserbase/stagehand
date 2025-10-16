/**
 * This file provides a function to initialize a Stagehand instance for use in evaluations.
 * It configures the Stagehand environment and sets default options based on the current environment
 * (e.g., local or BROWSERBASE), caching preferences, and verbosity. It also establishes a logger for
 * capturing logs emitted by Stagehand.
 *
 * We create a central config object (`StagehandConfig`) that defines all parameters for Stagehand.
 *
 * The `initStagehand` function takes the model name, an optional DOM settling timeout, and an EvalLogger,
 * then uses these to override some default values before creating and initializing the Stagehand instance.
 */

import { enableCaching, env } from "./env";
import {
  ConstructorParams,
  LLMClient,
  Stagehand,
} from "@browserbasehq/stagehand";
import { EvalLogger } from "./logger";
import type { StagehandInitResult } from "@/types/evals";
import type { AgentConfig } from "@/dist";
import { AvailableModel } from "@browserbasehq/stagehand";
import {
  // AgentProvider,
  modelToAgentProviderMap,
} from "@/lib/agent/AgentProvider";
// import fetch from "node-fetch";
// import { HttpsProxyAgent } from "https-proxy-agent";

// /**
//  * Generates a random 8-character alphanumeric string for session ID
//  */
// function generateSessionId(): string {
//   const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
//   let result = "";
//   for (let i = 0; i < 8; i++) {
//     result += chars.charAt(Math.floor(Math.random() * chars.length));
//   }
//   return result;
// }

// /**
//  * Validates that a proxy is working by making a test request
//  */
// async function validateProxy(
//   server: string,
//   username: string,
//   password: string,
// ): Promise<boolean> {
//   const proxyUrl = `${server.replace("://", `://${username}:${password}@`)}`;
//   const targetUrl = "https://httpbin.org/ip";

//   try {
//     const agent = new HttpsProxyAgent(proxyUrl);
//     const res = await fetch(targetUrl, { agent });

//     if (res.status === 200) {
//       const body = await res.text();
//       console.log(
//         `Proxy validation successful. Response: ${body.substring(0, 100)}`,
//       );
//       return true;
//     } else {
//       console.error(`Proxy validation failed with status: ${res.status}`);
//       return false;
//     }
//   } catch (err) {
//     console.error("Proxy test failed:", err.message);
//     return false;
//   }
// }

// /**
//  * Returns a proxy configuration using NimbleWay format
//  * Uses a fixed configuration with a random session ID per eval
//  * Validates the proxy before returning it
//  */
// async function getNimbleProxies(): Promise<
//   {
//     type: "external";
//     server: string;
//     username: string;
//     password: string;
//   }[]
// > {
//   // Generate random session ID for this eval
//   const sessionId = generateSessionId();

//   // NimbleWay proxy configuration
//   const username = `account-browserbase_1zxs2i-pipeline-nimbleip-country-US-session-${sessionId}`;
//   const password = "Kd0Cz0O709g8";
//   const server = "http://ip.nimbleway.com:7000";

//   // Validate the proxy is working
//   const isValid = await validateProxy(server, username, password);

//   if (!isValid) {
//     console.warn("Proxy validation failed, but continuing anyway");
//   }

//   return [
//     {
//       type: "external",
//       server,
//       username,
//       password,
//     },
//   ];
// }

// async function getBDMobileProxies(): Promise<
//   {
//     type: "external";
//     server: string;
//     username: string;
//     password: string;
//   }[]
// > {
//   // const sessionId = generateSessionId();

//   // BD Mobile proxy configuration
//   const username = `brd-customer-hl_66010a9c-zone-mobile_proxy_stagehand_evals`;
//   const password = "yn6nmnr8g9m4";
//   const server = "https://brd.superproxy.io:33335";

//   // Validate the proxy is working
//   const isValid = await validateProxy(server, username, password);

//   if (!isValid) {
//     console.warn("Proxy validation failed, but continuing anyway");
//   }

//   return [
//     {
//       type: "external",
//       server,
//       username,
//       password,
//     },
//   ];
// }

/**
 * StagehandConfig:
 * This configuration object follows a similar pattern to `examples/stagehand.config.ts`.
 * It sets the environment, verbosity, caching preferences, and other defaults. Some values,
 * like `apiKey` and `projectId`, can be defined via environment variables if needed.
 *
 * Adjust or remove fields as appropriate for your environment.
 */
// Base configuration without async values
const BaseStagehandConfig = {
  env: env,
  apiKey: process.env.BROWSERBASE_API_KEY,
  projectId: process.env.BROWSERBASE_PROJECT_ID,
  useAPI: process.env.USE_API === "true",
  verbose: 2 as const,
  debugDom: true,
  headless: false,
  enableCaching,
  domSettleTimeoutMs: 60_000,
  disablePino: true,
  selfHeal: true,
  modelName: "google/gemini-2.5-flash",
  modelClientOptions: {
    apiKey: process.env.GEMINI_API_KEY,
  },
};

/**
 * Initializes a Stagehand instance for a given model:
 * - modelName: The model to use (overrides default in StagehandConfig)
 * - domSettleTimeoutMs: Optional timeout for DOM settling operations
 * - logger: An EvalLogger instance for capturing logs
 *
 * Returns:
 * - stagehand: The initialized Stagehand instance
 * - logger: The provided logger, associated with the Stagehand instance
 * - initResponse: Any response data returned by Stagehand initialization
 */
export const initStagehand = async ({
  llmClient,
  modelClientOptions,
  domSettleTimeoutMs,
  logger,
  configOverrides,
  actTimeoutMs,
  modelName,
}: {
  llmClient?: LLMClient;
  modelClientOptions?: { apiKey: string };
  domSettleTimeoutMs?: number;
  logger: EvalLogger;
  configOverrides?: Partial<ConstructorParams>;
  actTimeoutMs?: number;
  modelName: AvailableModel;
}): Promise<StagehandInitResult> => {
  // Get proxies with validation
  // const proxyType = await getNimbleProxies();
  // const proxies = await getBDMobileProxies();

  const config = {
    ...BaseStagehandConfig,
    modelClientOptions,
    llmClient,
    ...(domSettleTimeoutMs && { domSettleTimeoutMs }),
    actTimeoutMs,
    modelName,
    experimental:
      typeof configOverrides?.experimental === "boolean"
        ? configOverrides.experimental
        : !BaseStagehandConfig.useAPI,
    browserbaseSessionCreateParams: {
      projectId: process.env.BROWSERBASE_PROJECT_ID!,
      proxies: true,
      // proxies,
      browserSettings: {
        enablePdfViewer: true,
        advancedStealth: true,
        os: "windows",
        viewport: {
          width: 2560,
          height: 1440,
        },
      },
    },
    ...configOverrides,
    logger: logger.log.bind(logger),
  };

  try {
    const stagehand = new Stagehand(config);

    // Associate the logger with the Stagehand instance
    logger.init(stagehand);

    const { debugUrl, sessionUrl } = await stagehand.init();

    // Set navigation timeout to 60 seconds for evaluations
    stagehand.context.setDefaultNavigationTimeout(60_000);

    let agentConfig: AgentConfig | undefined;
    if (modelName in modelToAgentProviderMap) {
      agentConfig = {
        model: modelName,
        provider: modelToAgentProviderMap[modelName],
        instructions: `You are a helpful assistant that must solve the task by browsing. At the end, produce a single line: "Final Answer: <answer>" summarizing the requested result (e.g., score, list, or text). Current page: ${await stagehand.page.title()}. ALWAYS OPERATE WITHIN THE PAGE OPENED BY THE USER, WHICHEVER TASK YOU ARE ATTEMPTING TO COMPLETE CAN BE ACCOMPLISHED WITHIN THE PAGE. Simple perform the task provided, do not overthink or overdo it. The user trusts you to complete the task without any additional instructions, or answering any questions.`,
      } as AgentConfig;
    }

    const agent = stagehand.agent(agentConfig);

    return {
      stagehand,
      stagehandConfig: config,
      logger,
      debugUrl,
      sessionUrl,
      modelName,
      agent,
    };
  } catch (error) {
    console.error("Error initializing stagehand:", error);
    throw error;
  }
};
