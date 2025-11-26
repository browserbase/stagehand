/**
 * Example demonstrating how to use custom OpenAI-compatible endpoints
 * (like vLLM) with the Stagehand eval system.
 *
 * This shows the internal flow of how custom endpoints are detected and used.
 * In practice, you would configure this via environment variables.
 *
 * To run this example:
 * 1. Start a vLLM server: `vllm serve your-model --host 0.0.0.0 --port 8000`
 * 2. Set environment variables:
 *    export CUSTOM_OPENAI_BASE_URL="http://localhost:8000/v1"
 *    export CUSTOM_OPENAI_API_KEY="EMPTY"
 *    export CUSTOM_OPENAI_MODEL_NAME="your-model"
 * 3. Run your evals as normal: `pnpm run evals`
 */

import { createOpenAI } from "@ai-sdk/openai";
import { AISdkClientWrapped } from "../lib/AISdkClientWrapped";
import { customOpenAIConfig } from "../env";

/**
 * Example function showing how custom endpoints are configured
 */
function demonstrateCustomEndpointSetup() {
  console.log("Custom Endpoint Configuration Example");
  console.log("=====================================\n");

  // Check if custom endpoint is configured
  if (customOpenAIConfig.baseURL) {
    console.log("✓ Custom endpoint detected!");
    console.log(`  Base URL: ${customOpenAIConfig.baseURL}`);
    console.log(
      `  API Key: ${customOpenAIConfig.apiKey === "EMPTY" ? "EMPTY (vLLM default)" : "Set"}`,
    );
    console.log(
      `  Model Name: ${customOpenAIConfig.modelName || "Not specified (will use eval config)"}`,
    );
    console.log();

    // This is how the custom OpenAI provider is created
    const customOpenAI = createOpenAI({
      baseURL: customOpenAIConfig.baseURL,
      apiKey: customOpenAIConfig.apiKey,
    });

    // Get the model (this would be wrapped in AISdkClientWrapped in actual usage)
    const modelName = customOpenAIConfig.modelName || "default-model";
    const model = customOpenAI(modelName);

    console.log("✓ Custom OpenAI provider created");
    console.log(`  Model ID: ${model.modelId}`);
    console.log(`  Provider: ${model.provider}`);
    console.log();

    // This would be passed to initV3 in the actual eval flow
    console.log("The custom provider would be wrapped in AISdkClientWrapped");
    console.log("and passed to initV3() for use in evals.");
    console.log();

    // Show how it would be used
    console.log("Example usage in eval code:");
    console.log("  const llmClient = new AISdkClientWrapped({ model });");
    console.log(
      "  v3Input = await initV3({ logger, llmClient, modelName, ... });",
    );
  } else {
    console.log("✗ No custom endpoint configured");
    console.log();
    console.log(
      "To configure a custom endpoint, set these environment variables:",
    );
    console.log("  export CUSTOM_OPENAI_BASE_URL='http://localhost:8000/v1'");
    console.log("  export CUSTOM_OPENAI_API_KEY='EMPTY'");
    console.log("  export CUSTOM_OPENAI_MODEL_NAME='your-model-name'");
    console.log();
    console.log("Then run your evals as normal.");
  }

  console.log("\n" + "=".repeat(50));
}

/**
 * Example showing the fallback to standard AI SDK providers
 */
function demonstrateStandardProviderFallback() {
  console.log("\nStandard Provider Fallback");
  console.log("==========================\n");

  if (!customOpenAIConfig.baseURL) {
    console.log(
      "When no custom endpoint is configured, the system falls back to",
    );
    console.log("standard AI SDK providers (OpenAI, Anthropic, Google, etc.)");
    console.log();
    console.log("Example model names:");
    console.log("  - openai/gpt-4o-mini");
    console.log("  - anthropic/claude-3-7-sonnet-latest");
    console.log("  - google/gemini-2.0-flash");
    console.log();
    console.log(
      "These are handled by getAISDKLanguageModel() in the eval code.",
    );
  }
}

/**
 * Example configuration patterns for different use cases
 */
function showConfigurationExamples() {
  console.log("\nConfiguration Examples");
  console.log("======================\n");

  const examples = [
    {
      name: "Local vLLM Server",
      config: {
        CUSTOM_OPENAI_BASE_URL: "http://localhost:8000/v1",
        CUSTOM_OPENAI_API_KEY: "EMPTY",
        CUSTOM_OPENAI_MODEL_NAME: "meta-llama/Llama-3.3-70B-Instruct",
      },
    },
    {
      name: "Remote vLLM Deployment",
      config: {
        CUSTOM_OPENAI_BASE_URL: "http://192.168.1.100:8000/v1",
        CUSTOM_OPENAI_API_KEY: "EMPTY",
        CUSTOM_OPENAI_MODEL_NAME: "custom-model-v1",
      },
    },
    {
      name: "Ollama Local",
      config: {
        CUSTOM_OPENAI_BASE_URL: "http://localhost:11434/v1",
        CUSTOM_OPENAI_API_KEY: "EMPTY",
        CUSTOM_OPENAI_MODEL_NAME: "llama3.3:70b",
      },
    },
    {
      name: "Secured Custom Endpoint",
      config: {
        CUSTOM_OPENAI_BASE_URL: "https://api.custom.com/v1",
        CUSTOM_OPENAI_API_KEY: "sk-your-api-key",
        CUSTOM_OPENAI_MODEL_NAME: "production-model",
      },
    },
  ];

  examples.forEach((example, index) => {
    console.log(`${index + 1}. ${example.name}:`);
    Object.entries(example.config).forEach(([key, value]) => {
      console.log(`   export ${key}="${value}"`);
    });
    console.log();
  });
}

// Run the demonstration
if (require.main === module) {
  demonstrateCustomEndpointSetup();
  demonstrateStandardProviderFallback();
  showConfigurationExamples();

  console.log("For more details, see CUSTOM_ENDPOINT_USAGE.md");
}

export {
  demonstrateCustomEndpointSetup,
  demonstrateStandardProviderFallback,
  showConfigurationExamples,
};
