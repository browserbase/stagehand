import { Stagehand } from "@browserbasehq/stagehand";
import StagehandConfig from "../stagehand.config";

/**
 * Example demonstrating agent hooks functionality in API mode
 */
async function agentHooksExample() {
  // Initialize Stagehand with API mode
  const stagehand = new Stagehand({
    ...StagehandConfig,
    useAPI: true, // This enables API mode where hooks will now work via streaming
  });

  await stagehand.init();

  // Create agent with hooks - these will now work in API mode!
  const agent = stagehand.agent({
    provider: "openai",
    model: "computer-use-preview",
    options: {
      apiKey: process.env.OPENAI_API_KEY,
    },
  });

  try {
    // Execute agent with hook callbacks
    const result = await agent.execute({
      instruction:
        "Navigate to Google and search for 'Stagehand browser automation'",

      // These hooks will now be triggered by events from the server
      onStepFinish: (step) => {
        console.log(
          `🎯 Step ${(step as any).experimental_providerMetadata?.stepIndex} completed:`, // eslint-disable-line @typescript-eslint/no-explicit-any
        );
        console.log(`   Text: ${step.text}`);
        console.log(
          `   Tool calls: ${(step as unknown as { toolInvocations?: unknown[] }).toolInvocations?.length || 0}`,
        ); // eslint-disable-line @typescript-eslint/no-explicit-any
        console.log(`   Usage: ${step.usage.totalTokens} tokens`);
      },

      onChunk: (chunk) => {
        if (
          (chunk as unknown as { type: string; textDelta: string }).type ===
            "text-delta" &&
          (chunk as unknown as { textDelta: string }).textDelta
        ) {
          // eslint-disable-line @typescript-eslint/no-explicit-any
          process.stdout.write(
            (chunk as unknown as { textDelta: string }).textDelta,
          ); // eslint-disable-line @typescript-eslint/no-explicit-any
        }
      },

      onError: ({ error }) => {
        const agentError = error as Error & {
          stepIndex?: number;
          isRecoverable?: boolean;
        };
        console.error(`❌ Agent error in step ${agentError.stepIndex}:`);
        console.error(`   ${agentError.message}`);
        if (agentError.isRecoverable) {
          console.log(`   🔄 Error is recoverable, agent may retry`);
        }
      },

      onFinish: (result) => {
        console.log(`\n✅ Agent execution completed:`);
        console.log(
          `   Success: ${(result as any).experimental_providerMetadata?.success}`, // eslint-disable-line @typescript-eslint/no-explicit-any
        );
        console.log(
          `   Total steps: ${(result as any).experimental_providerMetadata?.totalSteps}`, // eslint-disable-line @typescript-eslint/no-explicit-any
        );
        console.log(
          `   Execution time: ${(result as any).experimental_providerMetadata?.executionTimeMs}ms`, // eslint-disable-line @typescript-eslint/no-explicit-any
        );
        console.log(`   Total usage: ${result.usage.totalTokens} tokens`);
      },
    });

    console.log("\n📋 Final Result:", result.message);
  } catch (error) {
    console.error("Agent execution failed:", error);
  } finally {
    await stagehand.close();
  }
}

// Run the example
if (require.main === module) {
  agentHooksExample().catch(console.error);
}

export default agentHooksExample;
