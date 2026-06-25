import { describe, expect, it } from "vitest";
import {
  normalizeDomainPolicy,
  shouldBlockUrl,
} from "../../lib/v3/understudy/domainPolicy.js";
import { StagehandInvalidArgumentError } from "../../lib/v3/types/public/sdkErrors.js";

describe("domain policy helpers", () => {
  it("generates HTTP and HTTPS Fetch patterns for exact blocked domains", () => {
    const policy = normalizeDomainPolicy({
      blockedDomains: ["ads.example.com"],
    });

    expect(policy?.fetchPatterns).toEqual([
      { urlPattern: "http://ads.example.com/*", requestStage: "Request" },
      { urlPattern: "http://ads.example.com:*/*", requestStage: "Request" },
      { urlPattern: "https://ads.example.com/*", requestStage: "Request" },
      { urlPattern: "https://ads.example.com:*/*", requestStage: "Request" },
    ]);
  });

  it("generates HTTP and HTTPS Fetch patterns for wildcard blocked domains", () => {
    const policy = normalizeDomainPolicy({
      blockedDomains: ["*.tracking.example.com"],
    });

    expect(policy?.fetchPatterns).toEqual([
      {
        urlPattern: "http://*.tracking.example.com/*",
        requestStage: "Request",
      },
      {
        urlPattern: "http://*.tracking.example.com:*/*",
        requestStage: "Request",
      },
      {
        urlPattern: "https://*.tracking.example.com/*",
        requestStage: "Request",
      },
      {
        urlPattern: "https://*.tracking.example.com:*/*",
        requestStage: "Request",
      },
    ]);
  });

  it("matches exact and wildcard domains without matching unrelated suffixes", () => {
    const policy = normalizeDomainPolicy({
      blockedDomains: ["ads.example.com", "*.tracking.example.com"],
    });

    expect(shouldBlockUrl("https://ads.example.com/script.js", policy)).toBe(
      true,
    );
    expect(
      shouldBlockUrl("https://a.tracking.example.com/pixel.gif", policy),
    ).toBe(true);
    expect(shouldBlockUrl("https://tracking.example.com/", policy)).toBe(false);
    expect(shouldBlockUrl("https://badtracking.example.com/", policy)).toBe(
      false,
    );
    expect(shouldBlockUrl("https://ads.example.com.evil.test/", policy)).toBe(
      false,
    );
  });

  it("continues malformed and non-HTTP URLs", () => {
    const policy = normalizeDomainPolicy({
      blockedDomains: ["ads.example.com"],
    });

    expect(shouldBlockUrl("not a url", policy)).toBe(false);
    expect(shouldBlockUrl("data:text/plain,hello", policy)).toBe(false);
    expect(shouldBlockUrl("file:///tmp/example.html", policy)).toBe(false);
  });

  it("rejects invalid blocked domain patterns", () => {
    expect(() =>
      normalizeDomainPolicy({ blockedDomains: ["https://example.com"] }),
    ).toThrow(StagehandInvalidArgumentError);
    expect(() =>
      normalizeDomainPolicy({ blockedDomains: ["*example.com"] }),
    ).toThrow(StagehandInvalidArgumentError);
    expect(() =>
      normalizeDomainPolicy({ blockedDomains: ["example"] }),
    ).toThrow(StagehandInvalidArgumentError);
  });
});
