import { test, expect } from "@playwright/test";
import { V3 } from "../v3";
import { v3TestConfig } from "./v3.config";

test.describe("Page sendCDP method", () => {
  let v3: V3;

  test.beforeEach(async () => {
    v3 = new V3(v3TestConfig);
    await v3.init();
  });

  test.afterEach(async () => {
    await v3?.close?.().catch(() => {});
  });

  test("sends CDP commands and requires domain to be enabled first", async () => {
    const page = v3.context.pages()[0];
    await page.goto("https://example.com");

    // Try to add a virtual authenticator without enabling WebAuthn first
    // This should fail because the domain needs to be enabled
    await expect(
      page.sendCDP("WebAuthn.addVirtualAuthenticator", {
        options: {
          protocol: "ctap2",
          transport: "usb",
          hasResidentKey: false,
          hasUserVerification: false,
          isUserVerified: false,
        },
      }),
    ).rejects.toThrow();

    // Enable the WebAuthn domain
    await page.sendCDP("WebAuthn.enable");

    // Now adding a virtual authenticator should succeed
    const result = await page.sendCDP<{ authenticatorId: string }>(
      "WebAuthn.addVirtualAuthenticator",
      {
        options: {
          protocol: "ctap2",
          transport: "usb",
          hasResidentKey: false,
          hasUserVerification: false,
          isUserVerified: false,
        },
      },
    );

    // Verify we got an authenticator ID back
    expect(result).toHaveProperty("authenticatorId");
    expect(typeof result.authenticatorId).toBe("string");
    expect(result.authenticatorId.length).toBeGreaterThan(0);
  });
});
