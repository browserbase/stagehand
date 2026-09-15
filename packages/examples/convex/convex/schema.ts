import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  // Example table for storing scraped HackerNews stories
  hackerNewsStories: defineTable({
    rank: v.number(),
    title: v.string(),
    url: v.string(),
    score: v.string(),
    age: v.string(),
    scrapedAt: v.string(),
  }).index("by_scraped_at", ["scrapedAt"]),
});
