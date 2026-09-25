import { DemoConfig, BrowserbaseConfig } from "./types";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

export const demoConfig: DemoConfig = {
  maxPosts: parseInt(process.env.MAX_POSTS || "5"),
  enableContentExtraction: process.env.ENABLE_CONTENT_EXTRACTION === "true",
  timeoutMs: parseInt(process.env.TIMEOUT_MS || "30000"),
  logLevel: (process.env.LOG_LEVEL as any) || "info",
  outputFormat: "both",
};

export const browserbaseConfig: BrowserbaseConfig = {
  apiKey: process.env.BROWSERBASE_API_KEY || "",
  projectId: process.env.BROWSERBASE_PROJECT_ID || "",
  region: "us-east-1",
  proxies: true,
  keepAlive: false,
  fingerprint: {
    screen: { width: 1920, height: 1080 },
    timezone: "America/New_York",
  },
};

export function validateConfig(): void {
  if (!browserbaseConfig.apiKey) {
    throw new Error("BROWSERBASE_API_KEY is required. Please check your .env file.");
  }

  if (!browserbaseConfig.projectId) {
    throw new Error("BROWSERBASE_PROJECT_ID is required. Please check your .env file.");
  }

  if (demoConfig.maxPosts < 1 || demoConfig.maxPosts > 30) {
    throw new Error("MAX_POSTS must be between 1 and 30");
  }
}
