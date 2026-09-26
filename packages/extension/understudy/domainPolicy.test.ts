import { describe, expect, it } from "vitest";
import {
  BASELINE_DOMAIN_POLICY,
  getDomainPolicyDecision,
  getEffectiveDomainPolicy,
  normalizeDomainPolicy,
} from "./domainPolicy.js";

const BLOCKED_BY_DEFAULT = [
  "http://169.254.169.254/latest/meta-data/",
  "http://169.254.170.2/v2/credentials",
  "http://169.254.1.1/x",
  "http://100.100.100.200/latest/meta-data/",
  "http://metadata.google.internal/computeMetadata/v1/",
  "http://metadata.goog/",
  "http://[fd00:ec2::254]/latest/meta-data/",
  "http://[fe80::1]/x",
  "http://[::ffff:169.254.169.254]/x",
];

const UNAFFECTED_BY_DEFAULT = [
  "http://127.0.0.1:43655/probe",
  "http://localhost:3000/",
  "http://10.0.0.5/",
  "http://172.16.0.1/",
  "http://192.168.1.10/",
  "http://[::1]/",
  "https://example.com/",
  "data:text/html,x",
  "file:///tmp/x",
  "about:blank",
];

describe("effective domain policy", () => {
  it("falls back to the baseline when no policy is configured", () => {
    expect(getEffectiveDomainPolicy(null)).toBe(BASELINE_DOMAIN_POLICY);
  });

  it("returns a configured policy unchanged", () => {
    const configured = normalizeDomainPolicy({ blockedDomains: ["x.test"] })!;
    expect(getEffectiveDomainPolicy(configured)).toBe(configured);
  });

  it("derives the baseline blocklist from its rules", () => {
    expect(BASELINE_DOMAIN_POLICY.allowedDomains).toStrictEqual([]);
    expect(BASELINE_DOMAIN_POLICY.allowedDomainRules).toStrictEqual([]);
    expect(BASELINE_DOMAIN_POLICY.blockedDomains).toStrictEqual([
      "169.254.*",
      "[fe80:*]",
      "[::ffff:*]",
      "[fd00:ec2::254]",
      "100.100.100.200",
      "metadata.google.internal",
      "metadata.goog",
    ]);
  });

  it.each(BLOCKED_BY_DEFAULT)("blocks %s by default", (url) => {
    expect(getDomainPolicyDecision(url, BASELINE_DOMAIN_POLICY)).toStrictEqual({
      action: "block",
      reason: "blockedDomains",
    });
  });

  it.each(UNAFFECTED_BY_DEFAULT)("continues %s by default", (url) => {
    expect(getDomainPolicyDecision(url, BASELINE_DOMAIN_POLICY)).toStrictEqual({
      action: "continue",
    });
  });

  it("only pauses requests to the baseline hosts", () => {
    for (const pattern of BASELINE_DOMAIN_POLICY.fetchPatterns) {
      expect(pattern.requestStage).toBe("Request");
      expect(["*://*/*", "http://*/*", "https://*/*"]).not.toContain(pattern.urlPattern);
    }
    expect(BASELINE_DOMAIN_POLICY.fetchPatterns).toMatchInlineSnapshot(`
      [
        {
          "requestStage": "Request",
          "urlPattern": "http://169.254.*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://169.254.*:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://169.254.*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://169.254.*:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://[fe80:*]/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://[fe80:*]:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://[fe80:*]/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://[fe80:*]:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://[::ffff:*]/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://[::ffff:*]:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://[::ffff:*]/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://[::ffff:*]:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://[fd00:ec2::254]/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://[fd00:ec2::254]:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://[fd00:ec2::254]/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://[fd00:ec2::254]:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://[fd00:ec2::254]./*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://[fd00:ec2::254].:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://[fd00:ec2::254]./*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://[fd00:ec2::254].:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://100.100.100.200/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://100.100.100.200:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://100.100.100.200/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://100.100.100.200:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://100.100.100.200./*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://100.100.100.200.:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://100.100.100.200./*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://100.100.100.200.:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://metadata.google.internal/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://metadata.google.internal:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://metadata.google.internal/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://metadata.google.internal:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://metadata.google.internal./*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://metadata.google.internal.:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://metadata.google.internal./*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://metadata.google.internal.:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://metadata.goog/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://metadata.goog:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://metadata.goog/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://metadata.goog:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://metadata.goog./*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "http://metadata.goog.:*/*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://metadata.goog./*",
        },
        {
          "requestStage": "Request",
          "urlPattern": "https://metadata.goog.:*/*",
        },
      ]
    `);
  });
});

describe("normalizeDomainPolicy", () => {
  it("treats an empty policy as no policy", () => {
    expect(normalizeDomainPolicy({})).toBeNull();
  });

  it("keeps a blocklist per-host", () => {
    const policy = normalizeDomainPolicy({ blockedDomains: ["x.test"] })!;

    expect(policy.fetchPatterns).toStrictEqual([
      { urlPattern: "http://x.test/*", requestStage: "Request" },
      { urlPattern: "http://x.test:*/*", requestStage: "Request" },
      { urlPattern: "https://x.test/*", requestStage: "Request" },
      { urlPattern: "https://x.test:*/*", requestStage: "Request" },
      { urlPattern: "http://x.test./*", requestStage: "Request" },
      { urlPattern: "http://x.test.:*/*", requestStage: "Request" },
      { urlPattern: "https://x.test./*", requestStage: "Request" },
      { urlPattern: "https://x.test.:*/*", requestStage: "Request" },
    ]);
  });

  it("keeps an allowlist broad", () => {
    const policy = normalizeDomainPolicy({ allowedDomains: ["example.com"] })!;

    expect(policy.fetchPatterns).toStrictEqual([
      { urlPattern: "http://*/*", requestStage: "Request" },
      { urlPattern: "https://*/*", requestStage: "Request" },
    ]);
  });
});
