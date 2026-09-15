#!/usr/bin/env node

import { Stagehand } from "@browserbasehq/stagehand";
import { HackerNewsExtractor } from "./extractor";
import { IntelligenceReporter } from "./reporter";
import { validateConfig, browserbaseConfig, demoConfig } from "./config";
import { logger } from "./logger";
import { PostAnalysis } from "./types";
import chalk from "chalk";
import ora from "ora";

/**
 * Hacker News Intelligence Demo - Browserbase Enterprise Automation
 *
 * This demo showcases Browserbase's capabilities for:
 * - AI-powered web scraping with Stagehand
 * - Intelligent content extraction and analysis
 * - Enterprise-grade error handling and reporting
 * - Scalable news aggregation workflows
 */
class HackerNewsIntelligenceDemo {
  private stagehand: Stagehand;
  private extractor: HackerNewsExtractor;
  private reporter: IntelligenceReporter;

  constructor() {
    this.stagehand = new Stagehand({
      env: "BROWSERBASE",
      apiKey: browserbaseConfig.apiKey,
      projectId: browserbaseConfig.projectId,
      ...browserbaseConfig,
    });

    this.extractor = new HackerNewsExtractor(this.stagehand);
    this.reporter = new IntelligenceReporter();
  }

  /**
   * Run the complete intelligence gathering workflow
   */
  async run(): Promise<void> {
    const startTime = Date.now();
    let analyses: PostAnalysis[] = [];

    try {
      // Initialize Stagehand
      logger.info("🚀 Starting Hacker News Intelligence Demo");
      logger.info(
        `Configuration: ${demoConfig.maxPosts} posts, content extraction: ${demoConfig.enableContentExtraction}`,
      );

      await this.stagehand.init();
      logger.success("Browserbase session initialized");

      // Step 1: Extract top posts
      const posts = await this.extractor.extractTopPosts();
      if (posts.length === 0) {
        throw new Error("No posts extracted from Hacker News");
      }

      // Step 2: Process each post
      logger.step(3, 4, `Processing ${posts.length} posts...`);
      const spinner = ora("Analyzing posts...").start();

      for (const [index, post] of posts.entries()) {
        spinner.text = `Analyzing post ${index + 1}/${posts.length}: ${post.title}`;

        try {
          // Extract content if enabled and post is external
          let content;
          if (demoConfig.enableContentExtraction) {
            content = await this.extractor.extractPostContent(post);
          } else {
            content = {
              title: post.title,
              url: post.url,
              extractedText: "Content extraction disabled",
              keyPoints: [],
              wordCount: 0,
              readingTimeMinutes: 0,
              extractionSuccess: false,
              error: "Content extraction disabled in configuration",
            };
          }

          // Generate AI analysis
          const analysis = await this.extractor.analyzePost(post, content);
          analyses.push(analysis);

          logger.debug(`Completed analysis for: ${post.title}`);
        } catch (error) {
          logger.error(`Failed to process post "${post.title}":`, error);

          // Add failed analysis to results
          analyses.push({
            post,
            content: {
              title: post.title,
              url: post.url,
              extractedText: "",
              keyPoints: [],
              wordCount: 0,
              readingTimeMinutes: 0,
              extractionSuccess: false,
              error: error instanceof Error ? error.message : "Processing failed",
            },
            analysis: {
              category: "Other",
              sentiment: "neutral",
              complexity: "medium",
              businessRelevance: 1,
            },
          });
        }
      }

      spinner.succeed(`Completed analysis of ${analyses.length} posts`);

      // Step 3: Generate and display report
      logger.step(4, 4, "Generating intelligence report...");
      const report = this.reporter.generateReport(analyses);

      // Display results
      if (demoConfig.outputFormat === "console" || demoConfig.outputFormat === "both") {
        this.reporter.displayConsoleReport(report);
      }

      // Save JSON report
      if (demoConfig.outputFormat === "json" || demoConfig.outputFormat === "both") {
        await this.reporter.saveJsonReport(report);
      }

      // Generate executive summary
      const executiveSummary = this.reporter.generateExecutiveSummary(report);
      logger.info("Executive Summary:", executiveSummary);

      // Performance metrics
      const duration = (Date.now() - startTime) / 1000;
      const successRate = (report.successfulExtractions / report.totalPostsAnalyzed) * 100;

      logger.success(`Demo completed successfully in ${duration.toFixed(1)}s`);
      logger.info(
        `Success rate: ${successRate.toFixed(1)}% (${report.successfulExtractions}/${report.totalPostsAnalyzed})`,
      );
    } catch (error) {
      logger.error("Demo execution failed:", error);
      throw error;
    } finally {
      // Cleanup
      try {
        await this.stagehand.close();
        logger.debug("Browserbase session closed");
      } catch (error) {
        logger.warn("Error closing Browserbase session:", error);
      }
    }
  }

  /**
   * Health check for demo dependencies
   */
  async healthCheck(): Promise<boolean> {
    try {
      logger.info("Running health check...");

      validateConfig();
      logger.success("✅ Configuration validated");

      // Test Browserbase connection
      await this.stagehand.init();
      await this.stagehand.page.goto("https://httpbin.org/status/200");
      await this.stagehand.close();
      logger.success("✅ Browserbase connection verified");

      logger.success("Health check passed - demo is ready to run");
      return true;
    } catch (error) {
      logger.error("Health check failed:", error);
      return false;
    }
  }
}

// CLI execution
async function main() {
  const args = process.argv.slice(2);
  const demo = new HackerNewsIntelligenceDemo();

  try {
    if (args.includes("--health-check")) {
      const healthy = await demo.healthCheck();
      process.exit(healthy ? 0 : 1);
    } else {
      validateConfig();
      await demo.run();
    }
  } catch (error) {
    logger.error("Fatal error:", error);
    console.log(chalk.red("\n❌ Demo failed to complete"));
    console.log(chalk.yellow("💡 Try running with --health-check to verify setup"));
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  logger.info("Received SIGINT, shutting down gracefully...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  logger.info("Received SIGTERM, shutting down gracefully...");
  process.exit(0);
});

// Export for programmatic use
export { HackerNewsIntelligenceDemo };

// Run if called directly
if (require.main === module) {
  main();
}
