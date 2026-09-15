import { Stagehand } from "@browserbasehq/stagehand";
import { HackerNewsPost, PostContent, PostAnalysis } from "./types";
import { logger } from "./logger";
import { demoConfig } from "./config";

export class HackerNewsExtractor {
  private stagehand: Stagehand;

  constructor(stagehand: Stagehand) {
    this.stagehand = stagehand;
  }

  /**
   * Extract top posts from Hacker News front page
   */
  async extractTopPosts(): Promise<HackerNewsPost[]> {
    logger.step(1, 4, "Navigating to Hacker News front page...");

    await this.stagehand.page.goto("https://news.ycombinator.com");

    logger.step(2, 4, `Extracting top ${demoConfig.maxPosts} posts...`);

    // Use Stagehand's AI-powered extraction
    const postsData = await this.stagehand.page.extract(
      `Extract the top ${demoConfig.maxPosts} posts from Hacker News front page. For each post, get:
      - rank (position number)
      - title
      - URL (if it's an external link, get the actual URL; if it's a Hacker News discussion, note it)
      - points (upvotes)
      - author username
      - comments count
      - age text (how long ago it was posted)
      - domain (if external)
      Return as an array of objects with these exact field names.`,
    );

    logger.debug("Raw extracted data:", postsData);

    // Process and validate the extracted data
    const posts = this.processExtractedPosts(postsData);

    logger.success(`Successfully extracted ${posts.length} posts`);
    return posts;
  }

  /**
   * Extract content from individual post URLs
   */
  async extractPostContent(post: HackerNewsPost): Promise<PostContent> {
    if (!post.isExternal) {
      logger.debug(`Skipping content extraction for Hacker News discussion: ${post.title}`);
      return {
        title: post.title,
        url: post.url,
        extractedText: "Hacker News discussion - no external content",
        keyPoints: ["This is a Hacker News discussion post"],
        wordCount: 0,
        readingTimeMinutes: 0,
        extractionSuccess: false,
        error: "Internal Hacker News post",
      };
    }

    try {
      logger.debug(`Extracting content from: ${post.url}`);

      await this.stagehand.page.goto(post.url);

      // Use Stagehand's AI extraction for article content
      const content = await this.stagehand.page.extract(`
        Extract the main article content from this webpage. Return:
        - title: The main article title
        - extractedText: The full article text (clean, without ads or navigation)
        - keyPoints: Array of 3-5 key points or main takeaways from the article
        - wordCount: Approximate word count
        Format as JSON with these exact field names.
      `);

      const processedContent = this.processExtractedContent(content, post);

      logger.debug(`Content extracted for "${post.title}": ${processedContent.wordCount} words`);
      return processedContent;
    } catch (error) {
      logger.error(`Failed to extract content from ${post.url}:`, error);
      return {
        title: post.title,
        url: post.url,
        extractedText: "",
        keyPoints: [],
        wordCount: 0,
        readingTimeMinutes: 0,
        extractionSuccess: false,
        error: error instanceof Error ? error.message : "Unknown error",
      };
    }
  }

  /**
   * Generate AI-powered analysis of extracted content
   */
  async analyzePost(post: HackerNewsPost, content: PostContent): Promise<PostAnalysis> {
    try {
      // Use Stagehand's AI capabilities for content analysis
      const analysis = await this.stagehand.page.extract(`
        Analyze this Hacker News post and its content:

        Post Title: ${post.title}
        Domain: ${post.domain || "news.ycombinator.com"}
        Points: ${post.points}
        Comments: ${post.commentsCount}
        Content: ${content.extractedText.substring(0, 1000)}...

        Provide analysis with:
        - category: Tech category (e.g., "AI/ML", "Web Development", "Startup", "Hardware", "Security", "Other")
        - sentiment: Overall sentiment (positive, neutral, negative)
        - complexity: Technical complexity level (low, medium, high)
        - businessRelevance: Business relevance score from 1-10

        Return as JSON with these exact field names.
      `);

      return {
        post,
        content,
        analysis: this.processAnalysis(analysis),
      };
    } catch (error) {
      logger.warn(`Analysis failed for "${post.title}":`, error);

      // Fallback analysis
      return {
        post,
        content,
        analysis: {
          category: "Other",
          sentiment: "neutral",
          complexity: "medium",
          businessRelevance: 5,
        },
      };
    }
  }

  private processExtractedPosts(rawData: any): HackerNewsPost[] {
    try {
      logger.debug("Processing extracted data:", rawData);

      // Handle different possible response formats from Stagehand
      let posts: any[] = [];

      if (Array.isArray(rawData)) {
        posts = rawData;
      } else if (rawData.extraction) {
        // Stagehand returns data in extraction field
        const extractionData =
          typeof rawData.extraction === "string"
            ? JSON.parse(rawData.extraction)
            : rawData.extraction;
        posts = Array.isArray(extractionData) ? extractionData : [];
      } else if (rawData.posts) {
        posts = rawData.posts;
      }

      logger.debug(`Found ${posts.length} posts to process`);

      return posts.slice(0, demoConfig.maxPosts).map((item: any, index: number) => {
        const url = item.URL || item.url || item.link || "";
        const isExternal = url && !url.includes("news.ycombinator.com") && url.startsWith("http");

        // Extract numeric values from strings like "623 points"
        const pointsStr = item.points || item["points"] || "0";
        const points = parseInt(pointsStr.toString().replace(/\D/g, "")) || 0;

        const commentsStr = item["comments count"] || item.comments || item.commentsCount || "0";
        const commentsCount = parseInt(commentsStr.toString().replace(/\D/g, "")) || 0;

        return {
          rank: parseInt(item.rank?.toString().replace(/\D/g, "")) || index + 1,
          title: item.title || "Unknown Title",
          url: url,
          points: points,
          author: item["author username"] || item.author || item.user || "Unknown",
          commentsCount: commentsCount,
          ageText: item["age text"] || item.age || item.ageText || "Unknown",
          domain: isExternal ? this.extractDomain(url) : undefined,
          isExternal,
        };
      });
    } catch (error) {
      logger.error("Failed to process extracted posts:", error);
      return [];
    }
  }

  private processExtractedContent(rawContent: any, post: HackerNewsPost): PostContent {
    try {
      const content = typeof rawContent === "string" ? JSON.parse(rawContent) : rawContent;
      const extractedText = content.extractedText || content.text || "";
      const wordCount = this.countWords(extractedText);

      return {
        title: content.title || post.title,
        url: post.url,
        extractedText,
        keyPoints: Array.isArray(content.keyPoints) ? content.keyPoints : [],
        wordCount,
        readingTimeMinutes: Math.ceil(wordCount / 200), // Average reading speed
        extractionSuccess: true,
      };
    } catch (error) {
      logger.error("Failed to process extracted content:", error);
      return {
        title: post.title,
        url: post.url,
        extractedText: "",
        keyPoints: [],
        wordCount: 0,
        readingTimeMinutes: 0,
        extractionSuccess: false,
        error: "Content processing failed",
      };
    }
  }

  private processAnalysis(rawAnalysis: any): PostAnalysis["analysis"] {
    try {
      const analysis = typeof rawAnalysis === "string" ? JSON.parse(rawAnalysis) : rawAnalysis;

      return {
        category: analysis.category || "Other",
        sentiment: ["positive", "neutral", "negative"].includes(analysis.sentiment)
          ? analysis.sentiment
          : "neutral",
        complexity: ["low", "medium", "high"].includes(analysis.complexity)
          ? analysis.complexity
          : "medium",
        businessRelevance: Math.max(1, Math.min(10, parseInt(analysis.businessRelevance) || 5)),
      };
    } catch (error) {
      return {
        category: "Other",
        sentiment: "neutral",
        complexity: "medium",
        businessRelevance: 5,
      };
    }
  }

  private extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace("www.", "");
    } catch {
      return "Unknown Domain";
    }
  }

  private countWords(text: string): number {
    return text
      .trim()
      .split(/\s+/)
      .filter((word) => word.length > 0).length;
  }
}
