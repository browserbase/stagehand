import type {
  AgentHarnessOptions,
  AgentHarnessRunResult,
  AgentRunInput,
} from "../../types.js";
import { BrowserSession } from "../../browser/session.js";
import {
  CommandExecutionError,
  MultiagentError,
} from "../../utils/errors.js";
import { runCommand } from "../../utils/process.js";
import { BaseHarness } from "./base.js";

export interface BrowserUseProviderConfig {
  packageSpec: string;
  importStatement: string;
  llmFactory: string;
}

export interface BrowserUseScriptPayload {
  task: string;
  cdpUrl: string;
  model?: string;
}

const BROWSER_USE_PROVIDER_CONFIG: Record<string, BrowserUseProviderConfig> = {
  anthropic: {
    packageSpec: "browser-use[anthropic]",
    importStatement: "from browser_use import ChatAnthropic",
    llmFactory: "ChatAnthropic(model=model_name)",
  },
  google: {
    packageSpec: "browser-use[google]",
    importStatement: "from browser_use import ChatGoogle",
    llmFactory: "ChatGoogle(model=model_name)",
  },
  "browser-use": {
    packageSpec: "browser-use",
    importStatement: "from browser_use import ChatBrowserUse",
    llmFactory: "ChatBrowserUse()",
  },
};

export function resolveBrowserUseProvider(
  model?: string,
  env: NodeJS.ProcessEnv = process.env,
): {
  provider: keyof typeof BROWSER_USE_PROVIDER_CONFIG;
  modelName?: string;
} {
  if (model?.startsWith("anthropic/")) {
    return {
      provider: "anthropic",
      modelName: model.slice("anthropic/".length),
    };
  }

  if (model?.startsWith("google/")) {
    return {
      provider: "google",
      modelName: model.slice("google/".length),
    };
  }

  if (model?.startsWith("browser-use/")) {
    return {
      provider: "browser-use",
      modelName: model.slice("browser-use/".length),
    };
  }

  if (env.ANTHROPIC_API_KEY) {
    return {
      provider: "anthropic",
      modelName: model ?? "claude-sonnet-4-20250514",
    };
  }

  if (env.GOOGLE_API_KEY || env.GEMINI_API_KEY) {
    return {
      provider: "google",
      modelName: model ?? "gemini-2.5-flash",
    };
  }

  if (env.BROWSER_USE_API_KEY) {
    return {
      provider: "browser-use",
      modelName: model,
    };
  }

  throw new MultiagentError(
    "Browser Use requires a supported model provider. Set ANTHROPIC_API_KEY, GOOGLE_API_KEY/GEMINI_API_KEY, or BROWSER_USE_API_KEY, or pass an explicit model prefix such as anthropic/... or google/....",
  );
}

export function buildBrowserUseScript(
  providerConfig: BrowserUseProviderConfig,
): string {
  return `
import asyncio
import json
import sys

from browser_use import Agent, Browser
${providerConfig.importStatement}


async def main() -> None:
    payload = json.loads(sys.stdin.read())
    browser = Browser(cdp_url=payload["cdpUrl"])
    model_name = payload.get("model")
    llm = ${providerConfig.llmFactory}
    agent = Agent(
        task=payload["task"],
        llm=llm,
        browser=browser,
    )
    try:
        history = await agent.run(max_steps=20)
        result = {
            "finalResult": history.final_result(),
            "errors": history.errors(),
            "urls": history.urls(),
            "raw": history.model_dump(mode="json"),
        }
        print(json.dumps(result))
    finally:
        await browser.stop()


asyncio.run(main())
`.trim();
}

export function parseBrowserUseResult(stdout: string): AgentHarnessRunResult {
  const parsed = JSON.parse(stdout.trim()) as {
    finalResult?: string | null;
    errors?: Array<string | null>;
    urls?: string[];
    raw?: unknown;
  };
  const errors = (parsed.errors ?? []).filter(
    (value): value is string => typeof value === "string" && value.length > 0,
  );

  return {
    content:
      parsed.finalResult ??
      errors.join("\n") ??
      "",
    raw: parsed,
  };
}

export class BrowserUseHarness extends BaseHarness {
  readonly name = "browser-use" as const;

  constructor(
    options: AgentHarnessOptions,
    private readonly browserSession: BrowserSession,
  ) {
    super(options);
  }

  async runTurn(input: AgentRunInput): Promise<AgentHarnessRunResult> {
    const cdpUrl = this.browserSession.getCdpUrl();
    if (!cdpUrl) {
      throw new MultiagentError(
        "Browser Use requires a BrowserSession with an active CDP URL.",
      );
    }

    if (input.mcpServers.length > 0) {
      throw new MultiagentError(
        "Browser Use is implemented with its native tool stack, but external MCP server bridging is not implemented yet for this harness.",
      );
    }

    const provider = resolveBrowserUseProvider(this.options.model, {
      ...process.env,
      ...(this.options.env ?? {}),
    });
    const providerConfig = BROWSER_USE_PROVIDER_CONFIG[provider.provider];
    const script = buildBrowserUseScript(providerConfig);
    const payload: BrowserUseScriptPayload = {
      task: input.prompt,
      cdpUrl,
      model: provider.modelName,
    };

    try {
      const { stdout } = await runCommand({
        command: "uvx",
        args: [
          "--python",
          "3.11",
          "--from",
          providerConfig.packageSpec,
          "python",
          "-c",
          script,
        ],
        cwd: this.options.cwd ?? input.cwd,
        env: this.options.env,
        input: JSON.stringify(payload),
      });

      return parseBrowserUseResult(stdout);
    } catch (error) {
      if (error instanceof CommandExecutionError && error.details.stdout.trim()) {
        try {
          const raw = JSON.parse(error.details.stdout.trim()) as {
            finalResult?: string | null;
            errors?: Array<string | null>;
          };
          const errors = (raw.errors ?? []).filter(
            (value): value is string =>
              typeof value === "string" && value.length > 0,
          );

          if (typeof raw.finalResult === "string" && raw.finalResult.length > 0) {
            return parseBrowserUseResult(error.details.stdout);
          }

          if (errors.length > 0) {
            throw new MultiagentError(errors.join("\n"));
          }
        } catch (parseError) {
          if (parseError instanceof MultiagentError) {
            throw parseError;
          }
        }
      }

      throw error;
    }
  }
}
