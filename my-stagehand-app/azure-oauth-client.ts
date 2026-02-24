/**
 * Azure OAuth LLM Client Library for Stagehand
 *
 * Provides direct Azure OpenAI authentication via CustomOpenAIClient.
 *
 *  - For act/extract/observe: uses AzureOpenAI SDK directly via CustomOpenAIClient
 *  - For CUA agent: spins up a lightweight in-process HTTP server (the CUA agent
 *    creates its own OpenAI client internally, so we provide an OpenAI-compatible
 *    endpoint that forwards to Azure with OAuth).
 *
 * Usage:
 *   import { setupAzureOAuth } from "./azure-oauth-client";
 *
 *   const oauth = await setupAzureOAuth();
 *   const stagehand = new Stagehand({ env: "LOCAL", llmClient: oauth.llmClient });
 *   const agent = stagehand.agent({ mode: "cua", model: oauth.cuaModel });
 *   // ... when done:
 *   await oauth.cleanup();
 */

import { AzureOpenAI } from "openai";
import {
  getBearerTokenProvider,
  AzureCliCredential,
  DefaultAzureCredential,
  ChainedTokenCredential,
} from "@azure/identity";
import { CustomOpenAIClient } from "@browserbasehq/stagehand";
import http from "http";
import { spawn } from "child_process";
import fs from "fs";
import path from "path";
import os from "os";

// ---------- Configuration ----------

const SCOPE = "api://trapi/.default";
const INSTANCE = "redmond/interactive";
const ENDPOINT = `https://trapi.research.microsoft.com/${INSTANCE}`;

const API_VERSION = "2024-10-21";
const RESPONSES_API_VERSION = "2025-03-01-preview";

/** Map friendly model names → Azure deployment names */
const DEPLOYMENT_MAP: Record<string, string> = {
  "gpt-4o": "gpt-4o_2024-11-20",
  "computer-use-preview": "computer-use-preview_2025-03-11",
  "computer-use-preview-2025-03-11": "computer-use-preview_2025-03-11",
};

const DEFAULT_DEPLOYMENT = "gpt-4o_2024-11-20";

// ---------- Copilot CLI Configuration ----------

const USE_COPILOT_CLI = true; // Enable Copilot CLI by default
const COPILOT_MODEL = "copilot-cli";

// ---------- Helpers ----------

function resolveDeployment(requestedModel: string): string {
  if (DEPLOYMENT_MAP[requestedModel]) return DEPLOYMENT_MAP[requestedModel];
  // Strip provider prefix (e.g., "openai/gpt-4o" → "gpt-4o")
  const stripped = requestedModel.includes("/")
    ? requestedModel.split("/").pop()!
    : requestedModel;
  if (DEPLOYMENT_MAP[stripped]) return DEPLOYMENT_MAP[stripped];
  console.warn(
    `⚠️  Unknown model "${requestedModel}", using default: ${DEFAULT_DEPLOYMENT}`
  );
  return DEFAULT_DEPLOYMENT;
}

let cachedCredential: ReturnType<typeof getBearerTokenProvider> | null = null;

function getCredential() {
  if (!cachedCredential) {
    cachedCredential = getBearerTokenProvider(
      new ChainedTokenCredential(
        new AzureCliCredential(),
        new DefaultAzureCredential()
      ),
      SCOPE
    );
  }
  return cachedCredential;
}

// ---------- Copilot CLI Implementation ----------

/**
 * LLM client that uses Copilot CLI under the hood
 * Compatible with OpenAI client interface but can use any model
 */
class CopilotCliClient {
  constructor(public modelName: string = COPILOT_MODEL) {}

  get chat() {
    return {
      completions: {
        create: async (params: any) => {
          const prompt = this.buildPromptFromMessages(params.messages);
          const response = await this.callCopilotCli(prompt);
          
          return {
            id: `copilot-${Date.now()}`,
            object: 'chat.completion',
            created: Math.floor(Date.now() / 1000),
            model: this.modelName,
            choices: [{
              index: 0,
              message: {
                role: 'assistant',
                content: response
              },
              finish_reason: 'stop'
            }],
            usage: {
              prompt_tokens: prompt.length,
              completion_tokens: response.length,
              total_tokens: prompt.length + response.length
            }
          };
        }
      }
    };
  }

  private buildPromptFromMessages(messages: any[]): string {
    return messages
      .map(msg => `${msg.role}: ${msg.content}`)
      .join('\n\n');
  }

  private async callCopilotCli(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      // Write prompt to temporary file to avoid newline/escaping issues
      const tmpDir = os.tmpdir();
      const tmpFile = path.join(tmpDir, `copilot-${Date.now()}.txt`);
      
      try {
        fs.writeFileSync(tmpFile, prompt, 'utf-8');
        
        const cmd = `copilot --prompt "@${tmpFile}"`;
        const process = spawn(cmd, [], {
          shell: true,
          stdio: ['pipe', 'pipe', 'pipe']
        });
        
        let output = '';
        let errorOutput = '';
        
        process.stdout.on('data', (data) => {
          output += data.toString();
        });
        
        process.stderr.on('data', (data) => {
          errorOutput += data.toString();
        });
        
        process.on('close', (code) => {
          // Clean up temporary file
          try {
            if (fs.existsSync(tmpFile)) {
              fs.unlinkSync(tmpFile);
            }
          } catch (e) {
            // Ignore cleanup errors
          }
          
          if (code !== 0) {
            console.error(`Copilot CLI error (code ${code}): ${errorOutput}`);
            reject(new Error(`Copilot CLI failed: ${errorOutput}`));
          } else {
            resolve(output.trim());
          }
        });
        
        process.on('error', (err) => {
          // Clean up temporary file
          try {
            if (fs.existsSync(tmpFile)) {
              fs.unlinkSync(tmpFile);
            }
          } catch (e) {
            // Ignore cleanup errors
          }
          reject(err);
        });
        
      } catch (err) {
        // Clean up temporary file
        try {
          if (fs.existsSync(tmpFile)) {
            fs.unlinkSync(tmpFile);
          }
        } catch (e) {
          // Ignore cleanup errors
        }
        reject(err);
      }
    });
  }
}

/**
 * Creates a Stagehand-compatible LLM client backed by Copilot CLI.
 * Use this as the `llmClient` option in the Stagehand constructor.
 */
export function createCopilotCliClient(modelName: string = COPILOT_MODEL): CustomOpenAIClient {
  const copilotClient = new CopilotCliClient(modelName);
  
  console.log(`🤖 Copilot CLI LLM client: "${modelName}"`);
  
  return new CustomOpenAIClient({
    modelName: modelName,
    client: copilotClient as any,
  });
}

// ---------- Direct LLM Client (for act / extract / observe) ----------

/**
 * Creates a Stagehand-compatible LLM client backed by Azure OpenAI with OAuth.
 * Use this as the `llmClient` option in the Stagehand constructor.
 */
export function createAzureOAuthClient(
  modelName: string = "gpt-4o",
  apiVersion?: string
): CustomOpenAIClient {
  const deployment = resolveDeployment(modelName);
  const version = apiVersion ?? API_VERSION;

  const azureClient = new AzureOpenAI({
    endpoint: ENDPOINT,
    azureADTokenProvider: getCredential(),
    apiVersion: version,
  });

  console.log(
    `🔑 Azure OAuth LLM client: "${modelName}" → deployment "${deployment}" (API ${version})`
  );

  return new CustomOpenAIClient({
    modelName: deployment,
    client: azureClient as any, // AzureOpenAI extends OpenAI
  });
}

// ---------- In-process CUA bridge ----------

/**
 * Starts a minimal in-process HTTP server that bridges OpenAI Responses API
 * requests to Azure OpenAI with OAuth. This is needed because Stagehand's
 * CUA agent creates its own OpenAI client internally.
 *
 * Returns the server and the port it's listening on.
 */
async function startCuaBridge(): Promise<{
  server: http.Server;
  port: number;
}> {
  const responsesClient = new AzureOpenAI({
    endpoint: ENDPOINT,
    azureADTokenProvider: getCredential(),
    apiVersion: RESPONSES_API_VERSION,
  });

  const chatClient = new AzureOpenAI({
    endpoint: ENDPOINT,
    azureADTokenProvider: getCredential(),
    apiVersion: API_VERSION,
  });

  const server = http.createServer(async (req, res) => {
    // Collect body
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const bodyStr = Buffer.concat(chunks).toString();

    const setCors = () => {
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Content-Type", "application/json");
    };

    try {
      if (req.method === "OPTIONS") {
        setCors();
        res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
        res.writeHead(204);
        res.end();
        return;
      }

      const body = bodyStr ? JSON.parse(bodyStr) : {};
      const deployment = resolveDeployment(body.model);

      if (req.url?.startsWith("/v1/responses")) {
        // Responses API (CUA)
        const response = await responsesClient.responses.create({
          ...body,
          model: deployment,
        });
        setCors();
        res.writeHead(200);
        res.end(JSON.stringify(response));
      } else if (req.url?.startsWith("/v1/chat/completions")) {
        // Chat completions (fallback, in case agent uses it)
        const { model: _m, ...rest } = body;
        const response = await chatClient.chat.completions.create({
          ...rest,
          model: deployment,
        });
        setCors();
        res.writeHead(200);
        res.end(JSON.stringify(response));
      } else {
        setCors();
        res.writeHead(404);
        res.end(JSON.stringify({ error: { message: `Not found: ${req.url}` } }));
      }
    } catch (err: any) {
      setCors();
      res.writeHead(err.status || 500);
      res.end(
        JSON.stringify({
          error: { message: err.message || "Internal proxy error" },
        })
      );
    }
  });

  return new Promise((resolve, reject) => {
    // Use port 0 to let the OS pick a free port
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      console.log(`🔌 CUA bridge listening on http://127.0.0.1:${port}`);
      resolve({ server, port });
    });
    server.on("error", reject);
  });
}

// ---------- Unified setup ----------

export interface LLMSetup {
  /** LLM client for act/extract/observe – pass as `llmClient` to Stagehand */
  llmClient: CustomOpenAIClient;

  /** Model config for CUA agent – pass as `model` to stagehand.agent() */
  cuaModel: { modelName: string; apiKey: string; baseURL: string };

  /** Shut down the in-process CUA proxy */
  cleanup: () => Promise<void>;
}

// Legacy type alias for backward compatibility
export type AzureOAuthSetup = LLMSetup;

/**
 * Setup LLM client with Copilot CLI (default) or Azure OAuth.
 *
 * ```ts
 * const setup = await setupLLMClient();
 * const stagehand = new Stagehand({ env: "LOCAL", llmClient: setup.llmClient });
 * const agent = stagehand.agent({ mode: "cua", model: setup.cuaModel });
 * await agent.execute({ instruction: "...", maxSteps: 20 });
 * await stagehand.close();
 * await setup.cleanup();
 * ```
 */
export async function setupLLMClient(
  options: {
    useCopilotCli?: boolean;
    chatModel?: string;
    cuaModelName?: string;
  } = {}
): Promise<LLMSetup> {
  const {
    useCopilotCli = USE_COPILOT_CLI,
    chatModel = useCopilotCli ? COPILOT_MODEL : "gpt-4o",
    cuaModelName = "openai/computer-use-preview"
  } = options;

  if (useCopilotCli) {
    // 1. Copilot CLI client for act/extract/observe
    const llmClient = createCopilotCliClient(chatModel);

    // 2. For CUA, still use Azure bridge (computer-use-preview unchanged as requested)
    const { server, port } = await startCuaBridge();

    const cuaModel = {
      modelName: cuaModelName,
      apiKey: "azure-oauth", // dummy – bridge handles real auth
      baseURL: `http://127.0.0.1:${port}/v1`,
    };

    console.log(`✅ Copilot CLI setup complete`);
    console.log(`   LLM client: Copilot CLI`);
    console.log(`   CUA bridge: http://127.0.0.1:${port}/v1`);

    return {
      llmClient,
      cuaModel,
      cleanup: () =>
        new Promise<void>((resolve) => {
          server.close(() => {
            console.log("🛑 CUA bridge stopped");
            resolve();
          });
        }),
    };
  } else {
    // Azure OAuth path (existing functionality)
    const llmClient = createAzureOAuthClient(chatModel);
    const { server, port } = await startCuaBridge();

    const cuaModel = {
      modelName: cuaModelName,
      apiKey: "azure-oauth",
      baseURL: `http://127.0.0.1:${port}/v1`,
    };

    console.log(`✅ Azure OAuth setup complete`);
    console.log(`   LLM client: Azure OAuth`);
    console.log(`   CUA bridge: http://127.0.0.1:${port}/v1`);

    return {
      llmClient,
      cuaModel,
      cleanup: () =>
        new Promise<void>((resolve) => {
          server.close(() => {
            console.log("🛑 CUA bridge stopped");
            resolve();
          });
        }),
    };
  }
}

/**
 * Legacy function for backward compatibility - now uses Azure OAuth specifically.
 */
export async function setupAzureOAuth(
  chatModel: string = "gpt-4o",
  cuaModelName: string = "openai/computer-use-preview"
): Promise<AzureOAuthSetup> {
  return setupLLMClient({
    useCopilotCli: false,
    chatModel,
    cuaModelName
  });
}

/**
 * Setup with Copilot CLI (convenience function).
 */
export async function setupCopilotCli(
  chatModel: string = COPILOT_MODEL,
  cuaModelName: string = "openai/computer-use-preview"
): Promise<LLMSetup> {
  return setupLLMClient({
    useCopilotCli: true,
    chatModel,
    cuaModelName
  });
}

export {
  DEPLOYMENT_MAP,
  DEFAULT_DEPLOYMENT,
  ENDPOINT,
  API_VERSION,
  RESPONSES_API_VERSION,
};
