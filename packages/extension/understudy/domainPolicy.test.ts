import { trace } from "@opentelemetry/api";
import { describe, expect, it, vi } from "vitest";
import { StagehandLogger } from "../logger.js";
import { warnOnceWhenNoDomainPolicy } from "./context.js";
import {
  getDomainPolicyDecision,
  normalizeDomainPolicy,
  type NormalizedDomainPolicy,
} from "./domainPolicy.js";

function testLogger() {
  const emitLog = vi.fn();
  const logger = new StagehandLogger({ tracer: trace.getTracer("domain-policy-test") }, emitLog);
  return { logger, emitLog };
}

const examplePolicy: NormalizedDomainPolicy = {
  allowedDomains: ["example.com"],
  blockedDomains: [],
  allowedDomainRules: [{ type: "exact", hostname: "example.com" }],
  blockedDomainRules: [],
  fetchPatterns: [],
};

describe("domain policy default", () => {
  it("fails open when no policy is set", () => {
    expect(normalizeDomainPolicy({ allowedDomains: [], blockedDomains: [] })).toBeNull();
    expect(getDomainPolicyDecision("https://example.com/", null)).toEqual({
      action: "continue",
    });
  });
});

describe("warnOnceWhenNoDomainPolicy", () => {
  it("warns once when a context starts without a domain policy", () => {
    const { logger, emitLog } = testLogger();
    warnOnceWhenNoDomainPolicy(logger, null);
    warnOnceWhenNoDomainPolicy(logger, null);

    expect(emitLog).toHaveBeenCalledTimes(1);
    const log = emitLog.mock.calls[0]![0];
    expect(log.level).toBe("warn");
    expect(log.message).toMatch(/without a domain policy/);
    expect(log.message).toMatch(/setDomainPolicy/);
  });

  it("does not warn when a domain policy is set", () => {
    const { logger, emitLog } = testLogger();
    warnOnceWhenNoDomainPolicy(logger, examplePolicy);
    expect(emitLog).not.toHaveBeenCalled();
  });
});
