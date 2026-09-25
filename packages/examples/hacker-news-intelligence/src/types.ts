/**
 * Type definitions for Hacker News Intelligence Demo
 */

export interface HackerNewsPost {
  rank: number;
  title: string;
  url: string;
  points: number;
  author: string;
  commentsCount: number;
  ageText: string;
  domain?: string;
  isExternal: boolean;
}

export interface PostContent {
  title: string;
  url: string;
  extractedText: string;
  keyPoints: string[];
  wordCount: number;
  readingTimeMinutes: number;
  extractionSuccess: boolean;
  error?: string;
}

export interface IntelligenceReport {
  generatedAt: string;
  totalPostsAnalyzed: number;
  successfulExtractions: number;
  posts: PostAnalysis[];
  summary: {
    topDomains: string[];
    averagePoints: number;
    totalComments: number;
    keyTopics: string[];
  };
}

export interface PostAnalysis {
  post: HackerNewsPost;
  content: PostContent;
  analysis: {
    category: string;
    sentiment: "positive" | "neutral" | "negative";
    complexity: "low" | "medium" | "high";
    businessRelevance: number; // 1-10 score
  };
}

export interface DemoConfig {
  maxPosts: number;
  enableContentExtraction: boolean;
  timeoutMs: number;
  logLevel: "debug" | "info" | "warn" | "error";
  outputFormat: "json" | "console" | "both";
}

export interface BrowserbaseConfig {
  apiKey: string;
  projectId: string;
  region?: string;
  proxies?: boolean;
  keepAlive?: boolean;
  fingerprint?: {
    screen?: { width: number; height: number };
    timezone?: string;
  };
}
