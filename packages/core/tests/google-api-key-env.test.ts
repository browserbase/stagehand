import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { loadApiKeyFromEnv } from "../lib/utils";

describe("Google API Key Environment Variable", () => {
    const originalEnv = process.env;

    beforeEach(() => {
        process.env = { ...originalEnv };
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it("should read GOOGLE_API_KEY for google provider", () => {
        process.env.GOOGLE_API_KEY = "test-google-key";

        const apiKey = loadApiKeyFromEnv("google", () => {});

        expect(apiKey).toBe("test-google-key");
    });

    it("should read GEMINI_API_KEY for google provider", () => {
        process.env.GEMINI_API_KEY = "test-gemini-key";

        const apiKey = loadApiKeyFromEnv("google", () => {});

        expect(apiKey).toBe("test-gemini-key");
    });

    it("should read GOOGLE_GENERATIVE_AI_API_KEY for google provider", () => {
        process.env.GOOGLE_GENERATIVE_AI_API_KEY = "test-gen-ai-key";

        const apiKey = loadApiKeyFromEnv("google", () => {});

        expect(apiKey).toBe("test-gen-ai-key");
    });

    it("should prioritize GEMINI_API_KEY over GOOGLE_API_KEY", () => {
        process.env.GEMINI_API_KEY = "gemini-key";
        process.env.GOOGLE_API_KEY = "google-key";

        const apiKey = loadApiKeyFromEnv("google", () => {});

        expect(apiKey).toBe("gemini-key");
    });
});