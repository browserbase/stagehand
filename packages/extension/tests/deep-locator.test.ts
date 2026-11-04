import { describe, expect, it } from "vitest";
import { planDeepXPathTarget } from "../understudy/deepLocator.js";

describe("planDeepXPathTarget", () => {
  it("keeps a trailing iframe as the parent-frame selector (no hop)", () => {
    expect(planDeepXPathTarget("xpath=/html/body/iframe[1]")).toEqual({
      frameHopSelectors: [],
      finalSelector: "xpath=/html/body/iframe[1]",
    });
  });

  it("hops into an iframe when further steps follow", () => {
    expect(planDeepXPathTarget("xpath=/html/iframe[1]/html/body/button")).toEqual({
      frameHopSelectors: ["xpath=/html/iframe[1]"],
      finalSelector: "xpath=/html/body/button",
    });
  });

  it("hops once then keeps a nested trailing iframe as the in-frame target", () => {
    expect(planDeepXPathTarget("xpath=/html/iframe[1]/html/iframe[2]")).toEqual({
      frameHopSelectors: ["xpath=/html/iframe[1]"],
      finalSelector: "xpath=/html/iframe[2]",
    });
  });

  it("supports nested crossing iframes", () => {
    expect(planDeepXPathTarget("xpath=/html/iframe[1]/html/iframe[2]/html/body/button")).toEqual({
      frameHopSelectors: ["xpath=/html/iframe[1]", "xpath=/html/iframe[2]"],
      finalSelector: "xpath=/html/body/button",
    });
  });

  it("treats frame the same as iframe for hop detection", () => {
    expect(planDeepXPathTarget("/html/body/frame[1]/html/body/div")).toEqual({
      frameHopSelectors: ["xpath=/html/body/frame[1]"],
      finalSelector: "xpath=/html/body/div",
    });
  });

  it("keeps a slash inside a string literal in the same step", () => {
    expect(planDeepXPathTarget('//button[normalize-space()="Sign in / Register"]')).toEqual({
      frameHopSelectors: [],
      finalSelector: 'xpath=//button[normalize-space()="Sign in / Register"]',
    });
    expect(planDeepXPathTarget("xpath=//iframe[1]//td[text()='10 / 16']")).toEqual({
      frameHopSelectors: ["xpath=//iframe[1]"],
      finalSelector: "xpath=//td[text()='10 / 16']",
    });
  });

  it("does not hop on an iframe that only appears inside a predicate", () => {
    expect(planDeepXPathTarget('//a[contains(@href, "/iframe/")]//span')).toEqual({
      frameHopSelectors: [],
      finalSelector: 'xpath=//a[contains(@href, "/iframe/")]//span',
    });
  });
});
