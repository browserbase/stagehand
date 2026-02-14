import { describe, expect, it } from "vitest";
import { getApiUrlForRegion, REGION_API_URLS } from "../lib/v3/api";

describe("Multi-region API URL mapping", () => {
  describe("REGION_API_URLS constant", () => {
    it("should have the correct URL for us-west-2 (default)", () => {
      expect(REGION_API_URLS["us-west-2"]).toBe(
        "https://api.stagehand.browserbase.com",
      );
    });

    it("should have the correct URL for us-east-1", () => {
      expect(REGION_API_URLS["us-east-1"]).toBe(
        "https://api.use1.stagehand.browserbase.com",
      );
    });

    it("should have the correct URL for eu-central-1", () => {
      expect(REGION_API_URLS["eu-central-1"]).toBe(
        "https://api.euc1.stagehand.browserbase.com",
      );
    });

    it("should have the correct URL for ap-southeast-1", () => {
      expect(REGION_API_URLS["ap-southeast-1"]).toBe(
        "https://api.apse1.stagehand.browserbase.com",
      );
    });
  });

  describe("getApiUrlForRegion", () => {
    it("should return the correct URL for us-west-2", () => {
      expect(getApiUrlForRegion("us-west-2")).toBe(
        "https://api.stagehand.browserbase.com/v1",
      );
    });

    it("should return the correct URL for us-east-1", () => {
      expect(getApiUrlForRegion("us-east-1")).toBe(
        "https://api.use1.stagehand.browserbase.com/v1",
      );
    });

    it("should return the correct URL for eu-central-1", () => {
      expect(getApiUrlForRegion("eu-central-1")).toBe(
        "https://api.euc1.stagehand.browserbase.com/v1",
      );
    });

    it("should return the correct URL for ap-southeast-1", () => {
      expect(getApiUrlForRegion("ap-southeast-1")).toBe(
        "https://api.apse1.stagehand.browserbase.com/v1",
      );
    });

    it("should return the default us-west-2 URL when no region is specified", () => {
      expect(getApiUrlForRegion(undefined)).toBe(
        "https://api.stagehand.browserbase.com/v1",
      );
    });

    it("should return the default us-west-2 URL for unknown regions", () => {
      // @ts-expect-error - testing invalid region
      expect(getApiUrlForRegion("invalid-region")).toBe(
        "https://api.stagehand.browserbase.com/v1",
      );
    });
  });

  describe("URL /v1 suffix handling", () => {
    it("getApiUrlForRegion always includes /v1 suffix for consistency", () => {
      // getApiUrlForRegion returns a URL with /v1
      // This documents the expected contract that all API base URLs include /v1
      const url = getApiUrlForRegion("us-west-2");
      expect(url.endsWith("/v1")).toBe(true);
    });

    it("all regional URLs should be base URLs without /v1 in REGION_API_URLS", () => {
      // Verify REGION_API_URLS contains base URLs (without /v1)
      // The /v1 suffix is added by getApiUrlForRegion
      for (const [region, baseUrl] of Object.entries(REGION_API_URLS)) {
        expect(baseUrl.endsWith("/v1")).toBe(false);
        expect(getApiUrlForRegion(region as keyof typeof REGION_API_URLS)).toBe(
          `${baseUrl}/v1`,
        );
      }
    });
  });
});
