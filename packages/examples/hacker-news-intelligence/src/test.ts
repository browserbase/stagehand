#!/usr/bin/env node

import { HackerNewsIntelligenceDemo } from "./main";
import { logger } from "./logger";
import chalk from "chalk";

/**
 * Test suite for Hacker News Intelligence Demo
 * Validates core functionality and Browserbase integration
 */
async function runTests() {
  console.log(chalk.bold.blue("\n🧪 HACKER NEWS INTELLIGENCE DEMO - TEST SUITE"));
  console.log(chalk.gray("=".repeat(60)));

  const demo = new HackerNewsIntelligenceDemo();
  let testsPassed = 0;
  let totalTests = 0;

  const test = async (name: string, testFn: () => Promise<boolean>) => {
    totalTests++;
    process.stdout.write(`${totalTests}. ${name}... `);

    try {
      const result = await testFn();
      if (result) {
        console.log(chalk.green("✅ PASS"));
        testsPassed++;
      } else {
        console.log(chalk.red("❌ FAIL"));
      }
    } catch (error) {
      console.log(chalk.red("❌ ERROR"));
      logger.debug(`Test "${name}" failed:`, error);
    }
  };

  // Test 1: Configuration validation
  await test("Configuration validation", async () => {
    try {
      const { validateConfig } = await import("./config");
      validateConfig();
      return true;
    } catch (error) {
      return false;
    }
  });

  // Test 2: Browserbase connection
  await test("Browserbase connection", async () => {
    return await demo.healthCheck();
  });

  // Test 3: Basic extraction (limited to 2 posts for testing)
  await test("Basic post extraction", async () => {
    try {
      // Temporarily override config for testing
      const originalMaxPosts = process.env.MAX_POSTS;
      process.env.MAX_POSTS = "2";
      process.env.ENABLE_CONTENT_EXTRACTION = "false";

      const testDemo = new HackerNewsIntelligenceDemo();
      await testDemo.run();

      // Restore original config
      if (originalMaxPosts) {
        process.env.MAX_POSTS = originalMaxPosts;
      }

      return true;
    } catch (error) {
      logger.debug("Basic extraction test failed:", error);
      return false;
    }
  });

  // Test 4: Error handling
  await test("Error handling", async () => {
    try {
      // Test with invalid configuration
      const originalApiKey = process.env.BROWSERBASE_API_KEY;
      process.env.BROWSERBASE_API_KEY = "invalid-key";

      const testDemo = new HackerNewsIntelligenceDemo();
      const healthy = await testDemo.healthCheck();

      // Restore original config
      if (originalApiKey) {
        process.env.BROWSERBASE_API_KEY = originalApiKey;
      }

      // Should return false for invalid config
      return !healthy;
    } catch (error) {
      return true; // Error handling working correctly
    }
  });

  // Test Results
  console.log(chalk.gray("\n" + "-".repeat(60)));
  console.log(`Tests completed: ${testsPassed}/${totalTests} passed`);

  if (testsPassed === totalTests) {
    console.log(chalk.green("🎉 All tests passed! Demo is ready for use."));
    process.exit(0);
  } else {
    console.log(chalk.red("⚠️  Some tests failed. Please check configuration and dependencies."));
    process.exit(1);
  }
}

// Run tests if called directly
if (require.main === module) {
  runTests();
}
