import { afterEach, describe, expect, it, vi } from "vitest";

import { login, loginProvider, readLoginJson } from "../src/lib/auth/login.js";
import { developmentApiOrigin, productionApiOrigin } from "../src/lib/auth/store.js";
import { oauthProvider, otherProjectId } from "./helpers/oauth-provider.js";

const fixture = {
  apiKey: "synthetic-test-key",
  projectId: "00000000-0000-4000-8000-000000000001",
  apiOrigin: productionApiOrigin,
};
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("device authorization", () => {
  it("uses a fixed production provider and requires explicit development mode for local providers", () => {
    expect(loginProvider()).toMatchObject({
      issuer: "https://clerk.browserbase.com",
      origin: "https://www.browserbase.com",
      apiOrigin: productionApiOrigin,
    });
    expect(() => loginProvider("http://127.0.0.1:3000")).toThrow();
    expect(() => loginProvider("https://example.com", true)).toThrow();
    expect(() => loginProvider("https://www.browserbase.com@evil.example")).toThrow();
    expect(() => loginProvider("https://www.browserbase.com/path")).toThrow();
    const development = loginProvider(undefined, true);
    expect(development.issuer).not.toBe(loginProvider().issuer);
    expect(development.clientId).toBeTruthy();
    expect(loginProvider("http://127.0.0.1:3000", true)).toEqual({
      ...development,
      origin: "http://127.0.0.1:3000",
      apiOrigin: developmentApiOrigin,
    });
  });

  it("uses the OAuth library with signed tokens and a device grant before fetching one key", async () => {
    const provider = await oauthProvider({ tokenErrors: ["authorization_pending", "slow_down"] });
    try {
      const onVerification = vi.fn(async ({ url, userCode }) => {
        expect(url).toBe(`${provider.dashboard}/cli/device`);
        expect(userCode).toBe("TEST-CODE");
        expect(provider.state.exchanges).toBe(0);
      });
      const credential = await login({ ...provider, development: true, onVerification });
      expect(credential).toEqual({ ...fixture, apiOrigin: developmentApiOrigin });
      expect(onVerification).toHaveBeenCalledTimes(1);
      expect(provider.state).toMatchObject({
        authorizationScope: "openid browserbase:api_keys:read",
        authorizations: 1,
        exchanges: 3,
        projects: 1,
        credentials: 1,
        revocations: 1,
      });
    } finally {
      await provider.close();
    }
  });

  it.each(["issuer", "audience", "expired", "signature"] as const)(
    "rejects an ID token with invalid %s before requesting projects",
    async (invalidJwt) => {
      const provider = await oauthProvider({ invalidJwt });
      try {
        await expect(login({ ...provider, development: true })).rejects.toThrow(
          "Device sign-in failed",
        );
        expect(provider.state.projects).toBe(0);
        expect(provider.state.credentials).toBe(0);
      } finally {
        await provider.close();
      }
    },
  );

  it("checks discovery issuer consistency", async () => {
    const provider = await oauthProvider({ discoveryIssuer: "https://wrong.example" });
    try {
      await expect(login({ ...provider, development: true })).rejects.toThrow(
        "Device sign-in failed",
      );
      expect(provider.state.exchanges).toBe(0);
    } finally {
      await provider.close();
    }
  });

  it("rejects discovered endpoints outside the configured issuer before authorization", async () => {
    const provider = await oauthProvider({ tokenEndpoint: "https://wrong.example/token" });
    const onVerification = vi.fn();
    try {
      await expect(login({ ...provider, development: true, onVerification })).rejects.toThrow(
        "unexpected endpoint",
      );
      expect(onVerification).not.toHaveBeenCalled();
      expect(provider.state.exchanges).toBe(0);
    } finally {
      await provider.close();
    }
  });

  it("requires an ID token before requesting a project key", async () => {
    const provider = await oauthProvider({ omitIdToken: true });
    try {
      await expect(login({ ...provider, development: true })).rejects.toThrow("valid identity");
      expect(provider.state.projects).toBe(0);
      expect(provider.state.revocations).toBe(1);
    } finally {
      await provider.close();
    }
  });

  it("rejects a non-web verification URL before invoking the browser handler", async () => {
    const provider = await oauthProvider({ verificationUri: "file:///private/example" });
    const onVerification = vi.fn();
    try {
      await expect(login({ ...provider, development: true, onVerification })).rejects.toThrow(
        "invalid verification URL",
      );
      expect(onVerification).not.toHaveBeenCalled();
      expect(provider.state.exchanges).toBe(0);
    } finally {
      await provider.close();
    }
  });

  it("requires API-key scope and revokes the temporary refresh grant on failure", async () => {
    const provider = await oauthProvider({ tokenScopes: "openid" });
    try {
      await expect(login({ ...provider, development: true })).rejects.toThrow(
        "required API-key access",
      );
      expect(provider.state.projects).toBe(0);
      expect(provider.state.revocations).toBe(1);
    } finally {
      await provider.close();
    }
  });

  it("accepts opaque project IDs and selects one permitted project", async () => {
    const projects = [
      { id: "project-example", name: "Example", organizationName: "Example organization" },
      { id: otherProjectId, name: "Second", organizationName: "Example organization" },
    ];
    const provider = await oauthProvider({ projectsResponse: { projects } });
    try {
      const credential = await login({
        ...provider,
        development: true,
        chooseProject: async (available) => {
          expect(available).toEqual(projects);
          return "project-example";
        },
      });
      expect(credential.projectId).toBe("project-example");
      expect(provider.state.credentials).toBe(1);
      expect(provider.state.revocations).toBe(1);
    } finally {
      await provider.close();
    }
  });

  it.each([
    [
      "invalid project field",
      {
        projects: [
          {
            id: fixture.projectId,
            name: { secret: fixture.apiKey },
            organizationName: "Example organization",
          },
        ],
      },
    ],
    [
      "duplicate project IDs",
      {
        projects: [
          { id: fixture.projectId, name: "Example", organizationName: "Example organization" },
          { id: fixture.projectId, name: "Second", organizationName: "Example organization" },
        ],
      },
    ],
  ])("rejects project lists with %s and clears authorization", async (_, projectsResponse) => {
    const provider = await oauthProvider({ projectsResponse });
    try {
      const attempt = login({ ...provider, development: true });
      await expect(attempt).rejects.toThrow("invalid project list");
      await expect(attempt).rejects.not.toThrow(fixture.apiKey);
      expect(provider.state.credentials).toBe(0);
      expect(provider.state.revocations).toBe(1);
    } finally {
      await provider.close();
    }
  });

  it("accepts an explicit project only when it is permitted by the login", async () => {
    const provider = await oauthProvider({ manyProjects: true });
    try {
      const credential = await login({ ...provider, development: true, projectId: otherProjectId });
      expect(credential.projectId).toBe(otherProjectId);
      await expect(
        login({ ...provider, development: true, projectId: "not-permitted" }),
      ).rejects.toThrow("not available");
      expect(provider.state.credentials).toBe(1);
      expect(provider.state.revocations).toBe(2);
    } finally {
      await provider.close();
    }
  });

  it("requires an interactive project chooser and clears temporary authorization", async () => {
    const provider = await oauthProvider({ manyProjects: true });
    try {
      await expect(login({ ...provider, development: true })).rejects.toThrow(
        "interactive terminal",
      );
      expect(provider.state.credentials).toBe(0);
      expect(provider.state.revocations).toBe(1);
    } finally {
      await provider.close();
    }
  });

  it("revokes temporary authorization when selection is canceled", async () => {
    const provider = await oauthProvider({ manyProjects: true });
    const controller = new AbortController();
    try {
      await expect(
        login({
          ...provider,
          development: true,
          signal: controller.signal,
          chooseProject: async () => {
            controller.abort();
            throw new Error("Canceled");
          },
        }),
      ).rejects.toThrow("canceled");
      expect(provider.state.credentials).toBe(0);
      expect(provider.state.revocations).toBe(1);
    } finally {
      await provider.close();
    }
  });

  it("cancels a completed login during cleanup without skipping refresh revocation", async () => {
    const controller = new AbortController();
    const provider = await oauthProvider({ onRevoke: () => controller.abort() });
    try {
      await expect(
        login({ ...provider, development: true, signal: controller.signal }),
      ).rejects.toThrow("canceled");
      expect(provider.state.credentials).toBe(1);
      expect(provider.state.revocations).toBe(1);
    } finally {
      await provider.close();
    }
  });

  it("rejects a credential for another project and still clears the temporary grant", async () => {
    const provider = await oauthProvider({ wrongCredentialProject: true });
    try {
      await expect(login({ ...provider, development: true })).rejects.toThrow("different project");
      expect(provider.state.revocations).toBe(1);
    } finally {
      await provider.close();
    }
  });

  it("does not save a key when temporary-grant cleanup fails", async () => {
    const provider = await oauthProvider({ rejectRevocation: true });
    try {
      await expect(login({ ...provider, development: true })).rejects.toThrow("Could not clear");
    } finally {
      await provider.close();
    }
  });

  it("bounds login responses and sanitizes malformed JSON", async () => {
    await expect(readLoginJson(new Response(`not-json ${fixture.apiKey}`))).rejects.toThrow(
      "Invalid credential response",
    );
    await expect(readLoginJson(new Response("x".repeat(32769)))).rejects.toThrow(
      "Invalid credential response",
    );
  });

  it.each([
    ["access_denied", "denied"],
    ["expired_token", "expired"],
  ])("handles provider rejection %s without obtaining a key", async (error, message) => {
    const provider = await oauthProvider({ tokenErrors: [error] });
    try {
      await expect(login({ ...provider, development: true })).rejects.toThrow(message);
      expect(provider.state.credentials).toBe(0);
    } finally {
      await provider.close();
    }
  });

  it("honors device expiry while waiting for approval", async () => {
    const provider = await oauthProvider({ expiresIn: 1, interval: 1 });
    try {
      await expect(login({ ...provider, development: true })).rejects.toThrow("expired");
      expect(provider.state.credentials).toBe(0);
    } finally {
      await provider.close();
    }
  });

  it("cancels waiting for approval without obtaining a key", async () => {
    const provider = await oauthProvider();
    const controller = new AbortController();
    try {
      await expect(
        login({
          ...provider,
          development: true,
          signal: controller.signal,
          onVerification: async () => controller.abort(),
        }),
      ).rejects.toThrow("canceled");
      expect(provider.state.exchanges).toBe(0);
      expect(provider.state.credentials).toBe(0);
    } finally {
      await provider.close();
    }
  });
});
