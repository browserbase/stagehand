import { IntelligenceReport, PostAnalysis } from "./types";
import { logger } from "./logger";
import { demoConfig } from "./config";
import chalk from "chalk";
import * as fs from "fs";
import * as path from "path";

export class IntelligenceReporter {
  /**
   * Generate comprehensive intelligence report
   */
  generateReport(analyses: PostAnalysis[]): IntelligenceReport {
    const successful = analyses.filter((a) => a.content.extractionSuccess);
    const totalComments = analyses.reduce((sum, a) => sum + a.post.commentsCount, 0);
    const totalPoints = analyses.reduce((sum, a) => sum + a.post.points, 0);

    // Extract domains and count occurrences
    const domainCounts: { [key: string]: number } = {};
    analyses.forEach((a) => {
      if (a.post.domain) {
        domainCounts[a.post.domain] = (domainCounts[a.post.domain] || 0) + 1;
      }
    });

    const topDomains = Object.entries(domainCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([domain]) => domain);

    // Extract key topics from titles and content
    const keyTopics = this.extractKeyTopics(analyses);

    return {
      generatedAt: new Date().toISOString(),
      totalPostsAnalyzed: analyses.length,
      successfulExtractions: successful.length,
      posts: analyses,
      summary: {
        topDomains,
        averagePoints: totalPoints / analyses.length,
        totalComments,
        keyTopics,
      },
    };
  }

  /**
   * Display report in console with rich formatting
   */
  displayConsoleReport(report: IntelligenceReport): void {
    console.log("\n");
    console.log(chalk.bold.cyan("🚀 HACKER NEWS INTELLIGENCE REPORT"));
    console.log(chalk.gray("=".repeat(60)));

    // Summary
    console.log(chalk.bold("\n📊 SUMMARY"));
    console.log(`Generated: ${chalk.yellow(new Date(report.generatedAt).toLocaleString())}`);
    console.log(`Posts Analyzed: ${chalk.green(report.totalPostsAnalyzed)}`);
    console.log(
      `Successful Extractions: ${chalk.green(report.successfulExtractions)}/${report.totalPostsAnalyzed}`,
    );
    console.log(`Average Points: ${chalk.blue(Math.round(report.summary.averagePoints))}`);
    console.log(`Total Comments: ${chalk.blue(report.summary.totalComments)}`);

    // Top Domains
    if (report.summary.topDomains.length > 0) {
      console.log(chalk.bold("\n🌐 TOP DOMAINS"));
      report.summary.topDomains.forEach((domain, index) => {
        console.log(`${index + 1}. ${chalk.cyan(domain)}`);
      });
    }

    // Key Topics
    if (report.summary.keyTopics.length > 0) {
      console.log(chalk.bold("\n🏷️  KEY TOPICS"));
      console.log(report.summary.keyTopics.map((topic) => chalk.magenta(`#${topic}`)).join(" "));
    }

    // Individual Posts
    console.log(chalk.bold("\n📝 POST ANALYSIS"));
    console.log(chalk.gray("-".repeat(60)));

    report.posts.forEach((analysis, index) => {
      const { post, content, analysis: postAnalysis } = analysis;

      console.log(chalk.bold(`\n${index + 1}. ${post.title}`));
      console.log(`   ${chalk.gray("URL:")} ${chalk.blue(post.url)}`);
      console.log(
        `   ${chalk.gray("Author:")} ${post.author} | ${chalk.gray("Points:")} ${post.points} | ${chalk.gray("Comments:")} ${post.commentsCount}`,
      );
      console.log(
        `   ${chalk.gray("Category:")} ${this.getCategoryEmoji(postAnalysis.category)} ${postAnalysis.category}`,
      );
      console.log(
        `   ${chalk.gray("Sentiment:")} ${this.getSentimentEmoji(postAnalysis.sentiment)} ${postAnalysis.sentiment}`,
      );
      console.log(
        `   ${chalk.gray("Complexity:")} ${this.getComplexityEmoji(postAnalysis.complexity)} ${postAnalysis.complexity}`,
      );
      console.log(
        `   ${chalk.gray("Business Relevance:")} ${"⭐".repeat(Math.round(postAnalysis.businessRelevance / 2))}`,
      );

      if (content.extractionSuccess && content.keyPoints.length > 0) {
        console.log(`   ${chalk.gray("Key Points:")}`);
        content.keyPoints.slice(0, 3).forEach((point) => {
          console.log(`     • ${chalk.white(point)}`);
        });
        console.log(
          `   ${chalk.gray("Reading Time:")} ${content.readingTimeMinutes} min (${content.wordCount} words)`,
        );
      } else if (content.error) {
        console.log(`   ${chalk.red("⚠️  Extraction failed:")} ${content.error}`);
      }
    });

    console.log(chalk.gray("\n" + "=".repeat(60)));
    console.log(chalk.green("✅ Report generation complete!\n"));
  }

  /**
   * Save report to JSON file
   */
  async saveJsonReport(report: IntelligenceReport): Promise<string> {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `hacker-news-report-${timestamp}.json`;
    const filepath = path.join(process.cwd(), "reports", filename);

    // Ensure reports directory exists
    const reportsDir = path.dirname(filepath);
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    // Save formatted JSON
    const jsonContent = JSON.stringify(report, null, 2);
    fs.writeFileSync(filepath, jsonContent, "utf8");

    logger.success(`Report saved to: ${filepath}`);
    return filepath;
  }

  /**
   * Generate executive summary for business stakeholders
   */
  generateExecutiveSummary(report: IntelligenceReport): string {
    const trending = report.posts.sort((a, b) => b.post.points - a.post.points).slice(0, 3);

    const highBusinessRelevance = report.posts.filter(
      (p) => p.analysis.businessRelevance >= 8,
    ).length;

    return `
EXECUTIVE SUMMARY - Hacker News Intelligence Report
Generated: ${new Date(report.generatedAt).toLocaleDateString()}

KEY INSIGHTS:
• Analyzed ${report.totalPostsAnalyzed} trending posts with ${report.summary.totalComments} total comments
• ${highBusinessRelevance} posts identified as high business relevance (8+ score)
• Average engagement: ${Math.round(report.summary.averagePoints)} points per post
• Top content domains: ${report.summary.topDomains.slice(0, 3).join(", ")}

TRENDING TOPICS:
${trending.map((p, i) => `${i + 1}. ${p.post.title} (${p.post.points} points)`).join("\n")}

RECOMMENDATIONS:
• Monitor posts with high business relevance scores for competitive intelligence
• Engage with trending topics in ${report.summary.keyTopics.slice(0, 2).join(" and ")} categories
• Consider content opportunities around emerging themes
    `.trim();
  }

  private extractKeyTopics(analyses: PostAnalysis[]): string[] {
    const topicCounts: { [key: string]: number } = {};

    // Extract topics from categories
    analyses.forEach((a) => {
      const category = a.analysis.category.toLowerCase();
      if (category !== "other") {
        topicCounts[category] = (topicCounts[category] || 0) + 1;
      }
    });

    // Extract common keywords from titles
    const commonWords = [
      "ai",
      "ml",
      "crypto",
      "startup",
      "open",
      "source",
      "web",
      "security",
      "data",
      "tech",
    ];
    analyses.forEach((a) => {
      const title = a.post.title.toLowerCase();
      commonWords.forEach((word) => {
        if (title.includes(word)) {
          topicCounts[word] = (topicCounts[word] || 0) + 1;
        }
      });
    });

    return Object.entries(topicCounts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([topic]) => topic);
  }

  private getCategoryEmoji(category: string): string {
    const emojiMap: { [key: string]: string } = {
      "AI/ML": "🤖",
      "Web Development": "🌐",
      Startup: "🚀",
      Hardware: "💻",
      Security: "🔒",
      Crypto: "₿",
      Mobile: "📱",
      Data: "📊",
      DevOps: "⚙️",
      Other: "📄",
    };
    return emojiMap[category] || "📄";
  }

  private getSentimentEmoji(sentiment: string): string {
    const emojiMap = {
      positive: "😊",
      neutral: "😐",
      negative: "😟",
    };
    return emojiMap[sentiment as keyof typeof emojiMap] || "😐";
  }

  private getComplexityEmoji(complexity: string): string {
    const emojiMap = {
      low: "🟢",
      medium: "🟡",
      high: "🔴",
    };
    return emojiMap[complexity as keyof typeof emojiMap] || "🟡";
  }
}
