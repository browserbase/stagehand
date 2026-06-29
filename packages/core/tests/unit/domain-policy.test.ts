import { describe, expect, it } from "vitest";
import {
  getDomainPolicyDecision,
  normalizeDomainPolicy,
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
      { urlPattern: "http://ads.example.com./*", requestStage: "Request" },
      { urlPattern: "http://ads.example.com.:*/*", requestStage: "Request" },
      { urlPattern: "https://ads.example.com./*", requestStage: "Request" },
      { urlPattern: "https://ads.example.com.:*/*", requestStage: "Request" },
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
      {
        urlPattern: "http://*.tracking.example.com./*",
        requestStage: "Request",
      },
      {
        urlPattern: "http://*.tracking.example.com.:*/*",
        requestStage: "Request",
      },
      {
        urlPattern: "https://*.tracking.example.com./*",
        requestStage: "Request",
      },
      {
        urlPattern: "https://*.tracking.example.com.:*/*",
        requestStage: "Request",
      },
    ]);
  });

  it("matches exact and wildcard domains without matching unrelated suffixes", () => {
    const policy = normalizeDomainPolicy({
      blockedDomains: ["ads.example.com", "*.tracking.example.com"],
    });

    expect(
      getDomainPolicyDecision("https://ads.example.com/script.js", policy),
    ).toMatchObject({ action: "block" });
    expect(
      getDomainPolicyDecision(
        "https://a.tracking.example.com/pixel.gif",
        policy,
      ),
    ).toMatchObject({ action: "block" });
    expect(
      getDomainPolicyDecision(
        "https://deep.a.tracking.example.com/pixel.gif",
        policy,
      ),
    ).toMatchObject({ action: "block" });
    expect(
      getDomainPolicyDecision("https://ads.example.com./script.js", policy),
    ).toMatchObject({ action: "block" });
    expect(
      getDomainPolicyDecision(
        "https://a.tracking.example.com./pixel.gif",
        policy,
      ),
    ).toMatchObject({ action: "block" });
    expect(
      getDomainPolicyDecision("https://tracking.example.com/", policy),
    ).toEqual({ action: "continue" });
    expect(
      getDomainPolicyDecision("https://badtracking.example.com/", policy),
    ).toEqual({ action: "continue" });
    expect(
      getDomainPolicyDecision("https://ads.example.com.evil.test/", policy),
    ).toEqual({ action: "continue" });
  });

  it("generates broad HTTP and HTTPS Fetch patterns for allowed domains", () => {
    const policy = normalizeDomainPolicy({
      allowedDomains: ["example.com"],
    });

    expect(policy?.fetchPatterns).toEqual([
      { urlPattern: "http://*/*", requestStage: "Request" },
      { urlPattern: "https://*/*", requestStage: "Request" },
    ]);
  });

  it("uses broad Fetch patterns when allowed and blocked domains are combined", () => {
    const policy = normalizeDomainPolicy({
      allowedDomains: ["example.com"],
      blockedDomains: ["ads.example.com"],
    });

    expect(policy?.fetchPatterns).toEqual([
      { urlPattern: "http://*/*", requestStage: "Request" },
      { urlPattern: "https://*/*", requestStage: "Request" },
    ]);
  });

  it("allows matching exact and wildcard allowed domains", () => {
    const policy = normalizeDomainPolicy({
      allowedDomains: ["example.com", "*.example.com"],
    });

    expect(getDomainPolicyDecision("https://example.com/", policy)).toEqual({
      action: "continue",
    });
    expect(getDomainPolicyDecision("https://app.example.com/", policy)).toEqual(
      {
        action: "continue",
      },
    );
    expect(
      getDomainPolicyDecision("https://deep.app.example.com/", policy),
    ).toEqual({
      action: "continue",
    });
    expect(getDomainPolicyDecision("https://other.test/", policy)).toEqual({
      action: "block",
      reason: "allowedDomains",
    });
  });

  it("does not let wildcard allowed domains match the apex domain", () => {
    const policy = normalizeDomainPolicy({
      allowedDomains: ["*.example.com"],
    });

    expect(getDomainPolicyDecision("https://app.example.com/", policy)).toEqual(
      {
        action: "continue",
      },
    );
    expect(getDomainPolicyDecision("https://example.com/", policy)).toEqual({
      action: "block",
      reason: "allowedDomains",
    });
  });

  it("lets blocked domains win over allowed domains", () => {
    const policy = normalizeDomainPolicy({
      allowedDomains: ["example.com", "*.example.com"],
      blockedDomains: ["ads.example.com"],
    });

    expect(getDomainPolicyDecision("https://example.com/", policy)).toEqual({
      action: "continue",
    });
    expect(
      getDomainPolicyDecision("https://ads.example.com/script.js", policy),
    ).toEqual({
      action: "block",
      reason: "blockedDomains",
    });
    expect(getDomainPolicyDecision("https://other.test/", policy)).toEqual({
      action: "block",
      reason: "allowedDomains",
    });
  });

  it("matches domains case-insensitively", () => {
    const policy = normalizeDomainPolicy({
      blockedDomains: ["ADS.EXAMPLE.COM"],
    });

    expect(
      getDomainPolicyDecision("https://ads.example.com/script.js", policy),
    ).toMatchObject({ action: "block" });
    expect(
      getDomainPolicyDecision("https://ADS.EXAMPLE.COM/script.js", policy),
    ).toMatchObject({ action: "block" });
  });

  it("continues malformed and non-HTTP URLs", () => {
    const policy = normalizeDomainPolicy({
      allowedDomains: ["example.com"],
      blockedDomains: ["ads.example.com"],
    });

    expect(getDomainPolicyDecision("not a url", policy)).toEqual({
      action: "continue",
    });
    expect(getDomainPolicyDecision("data:text/plain,hello", policy)).toEqual({
      action: "continue",
    });
    expect(getDomainPolicyDecision("file:///tmp/example.html", policy)).toEqual(
      {
        action: "continue",
      },
    );
  });

  it("treats null, empty objects, and empty arrays as disabled policies", () => {
    expect(normalizeDomainPolicy(null)).toBeNull();
    expect(normalizeDomainPolicy({})).toBeNull();
    expect(normalizeDomainPolicy({ allowedDomains: [] })).toBeNull();
    expect(normalizeDomainPolicy({ blockedDomains: [] })).toBeNull();
    expect(
      normalizeDomainPolicy({ allowedDomains: [], blockedDomains: [] }),
    ).toBeNull();
  });

  it("rejects omitted policy and non-array domain fields", () => {
    expect(() => normalizeDomainPolicy(undefined)).toThrow(
      StagehandInvalidArgumentError,
    );
    expect(() =>
      normalizeDomainPolicy({
        allowedDomains: "example.com" as unknown as string[],
      }),
    ).toThrow(StagehandInvalidArgumentError);
    expect(() =>
      normalizeDomainPolicy({
        allowedDomains: new Set(["example.com"]) as unknown as string[],
      }),
    ).toThrow(StagehandInvalidArgumentError);
    expect(() =>
      normalizeDomainPolicy({
        blockedDomains: "ads.example.com" as unknown as string[],
      }),
    ).toThrow(StagehandInvalidArgumentError);
    expect(() =>
      normalizeDomainPolicy({
        blockedDomains: new Set(["ads.example.com"]) as unknown as string[],
      }),
    ).toThrow(StagehandInvalidArgumentError);
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
    expect(() =>
      normalizeDomainPolicy({
        blockedDomains: [123] as unknown as string[],
      }),
    ).toThrow(StagehandInvalidArgumentError);
  });

  it("rejects invalid allowed domain patterns", () => {
    expect(() =>
      normalizeDomainPolicy({ allowedDomains: ["https://example.com"] }),
    ).toThrow(StagehandInvalidArgumentError);
    expect(() =>
      normalizeDomainPolicy({ allowedDomains: ["*example.com"] }),
    ).toThrow(StagehandInvalidArgumentError);
    expect(() =>
      normalizeDomainPolicy({ allowedDomains: ["example"] }),
    ).toThrow(StagehandInvalidArgumentError);
    expect(() =>
      normalizeDomainPolicy({
        allowedDomains: [123] as unknown as string[],
      }),
    ).toThrow(StagehandInvalidArgumentError);
  });

  it("dedupes normalized allowed and blocked domains", () => {
    const policy = normalizeDomainPolicy({
      allowedDomains: ["EXAMPLE.COM", "example.com."],
      blockedDomains: ["*.ADS.EXAMPLE.COM", "*.ads.example.com."],
    });

    expect(policy?.allowedDomains).toEqual(["example.com"]);
    expect(policy?.blockedDomains).toEqual(["*.ads.example.com"]);
  });
});
