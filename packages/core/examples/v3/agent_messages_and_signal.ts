/**
 * Example: Agent Message Continuation and Abort Signal
 *
 * This example demonstrates two experimental features:
 * 1. Message continuation - continuing a conversation across multiple execute() calls
 * 2. Abort signal - cancelling an agent execution mid-run
 *
 * Note: These features require `experimental: true` in the Stagehand config.
 */

import chalk from "chalk";
import { V3 as Stagehand } from "../../lib/v3";

async function main() {
  console.log(
    `\n${chalk.bold("Stagehand Agent - Message Continuation & Abort Signal")}\n`,
  );

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    experimental: true, // Required for messages and signal
  });

  await stagehand.init();

  try {
    const page = stagehand.context.pages()[0];
    await page.goto("https://news.ycombinator.com");

    const agent = stagehand.agent({
      model: "anthropic/claude-sonnet-4-20250514",
    });

    // =========================================
    // Part 1: Message Continuation
    // =========================================
    console.log(chalk.cyan("\n--- Part 1: Message Continuation ---\n"));

    // First execution - ask about the page
    console.log(chalk.yellow("First execution: Asking about the page..."));
    const result1 = await agent.execute({
      instruction:
        "What is this website? Give me a one sentence description. Use close tool with taskComplete: true after answering.",
      maxSteps: 5,
    });

    console.log(chalk.green(`Result 1: ${result1.message}`));
    console.log(
      chalk.gray(`Messages in conversation: ${result1.messages?.length}`),
    );

    // Second execution - continue the conversation
    console.log(
      chalk.yellow("\nSecond execution: Following up with context..."),
    );
    const result2 = await agent.execute({
      instruction:
        "Based on what you just told me, what kind of content would I typically find here? Use close tool with taskComplete: true after answering.",
      maxSteps: 5,
      messages: result1.messages, // Pass previous messages to continue conversation
    });

    console.log(chalk.green(`Result 2: ${result2.message}`));
    console.log(
      chalk.gray(`Messages in conversation: ${result2.messages?.length}`),
    );

    // Third execution - even more context
    console.log(
      chalk.yellow("\nThird execution: Asking for recommendation..."),
    );
    const result3 = await agent.execute({
      instruction:
        "Would you recommend this site to a software developer? Yes or no, briefly explain. Use close tool with taskComplete: true.",
      maxSteps: 5,
      messages: result2.messages, // Continue from result2
    });

    console.log(chalk.green(`Result 3: ${result3.message}`));
    console.log(
      chalk.gray(`Total messages in conversation: ${result3.messages?.length}`),
    );

    // =========================================
    // Part 2: Abort Signal
    // =========================================
    console.log(chalk.cyan("\n--- Part 2: Abort Signal ---\n"));

    // Example 2a: Manual abort with AbortController
    console.log(chalk.yellow("Testing manual abort..."));

    const controller = new AbortController();

    // Abort after 3 seconds
    const abortTimeout = setTimeout(() => {
      console.log(chalk.red("Aborting execution after 3 seconds..."));
      controller.abort();
    }, 3000);

    const startTime1 = Date.now();
    try {
      await agent.execute({
        instruction:
          "Count to 100 slowly, saying each number out loud. Take your time between each number.",
        maxSteps: 100,
        signal: controller.signal,
      });
      clearTimeout(abortTimeout);
      console.log(chalk.green("Completed (unexpected)"));
    } catch (err) {
      clearTimeout(abortTimeout);
      const elapsed = Date.now() - startTime1;
      console.log(chalk.green(`Aborted successfully after ${elapsed}ms`));
      console.log(chalk.gray(`Error type: ${(err as Error).name}`));
    }

    // Example 2b: Using AbortSignal.timeout()
    console.log(chalk.yellow("\nTesting AbortSignal.timeout()..."));

    const startTime2 = Date.now();
    try {
      await agent.execute({
        instruction:
          "List every country in the world alphabetically, with their capitals.",
        maxSteps: 50,
        signal: AbortSignal.timeout(2000), // 2 second timeout
      });
      console.log(chalk.green("Completed (unexpected)"));
    } catch {
      const elapsed = Date.now() - startTime2;
      console.log(chalk.green(`Timed out as expected after ${elapsed}ms`));
    }

    // =========================================
    // Part 3: Combining Both Features
    // =========================================
    console.log(chalk.cyan("\n--- Part 3: Combined Usage ---\n"));

    console.log(
      chalk.yellow("Using messages continuation with a timeout signal..."),
    );

    // Start a conversation
    const initialResult = await agent.execute({
      instruction:
        "What is the first story on this page? Use close tool with taskComplete: true.",
      maxSteps: 5,
    });

    console.log(chalk.green(`Initial: ${initialResult.message}`));

    // Continue with a timeout
    try {
      const followUp = await agent.execute({
        instruction:
          "Now click on that story and tell me what it's about. Use close tool with taskComplete: true after.",
        maxSteps: 10,
        messages: initialResult.messages,
        signal: AbortSignal.timeout(15000), // 15 second timeout
      });

      console.log(chalk.green(`Follow-up: ${followUp.message}`));
    } catch (error) {
      console.log(
        chalk.red(`Follow-up timed out: ${(error as Error).message}`),
      );
    }

    console.log(chalk.green("\n--- Example Complete ---\n"));
  } catch (error) {
    console.error(chalk.red(`Error: ${error}`));
  } finally {
    await stagehand.close();
  }
}

main().catch(console.error);
