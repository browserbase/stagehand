import { connect } from "node:net";
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

describe("browser authorization", () => {
  it("uses a fixed production provider and requires explicit development mode for local providers", () => {
    expect(loginProvider()).toEqual({
      origin: "https://www.browserbase.com",
      apiOrigin: productionApiOrigin,
    });
    expect(() => loginProvider("http://127.0.0.1:3000")).toThrow();
    expect(() => loginProvider("https://example.com", true)).toThrow();
    expect(() => loginProvider("https://www.browserbase.com@evil.example")).toThrow();
    expect(() => loginProvider("https://www.browserbase.com/path")).toThrow();
    expect(loginProvider("http://127.0.0.1:3000", true).apiOrigin).toBe(developmentApiOrigin);
  });

  it("uses the OAuth library with signed tokens, PKCE and a real loopback callback before fetching one key", async () => {
    const provider = await oauthProvider();
    try {
      const credential = await login({
        dashboard: provider.dashboard,
        development: true,
        openBrowser: async (value) => {
          const callback = provider.callbackFor(value);
          expect(new URL(value).pathname).toBe("/cli/authorize");
          expect(new URL(value).searchParams.has("code_verifier")).toBe(false);
          const malformedResponse = await new Promise<string>((resolve, reject) => {
            let response = "";
            const socket = connect(Number(callback.port), "127.0.0.1", () => {
              socket.write(
                `GET /\\% HTTP/1.1\r\nHost: ${callback.host}\r\nConnection: close\r\n\r\n`,
              );
            });
            socket.setEncoding("utf8");
            socket.setTimeout(1000, () => socket.destroy(new Error("Callback timed out")));
            socket.on("error", reject);
            socket.on("data", (chunk) => (response += chunk));
            socket.on("end", () => resolve(response));
          });
          expect(malformedResponse).toMatch(/^HTTP\/1\.1 400 /);
          expect(provider.state.exchanges).toBe(0);
          const state = callback.searchParams.get("state")!;
          callback.searchParams.set("state", "wrong-state");
          expect((await fetch(callback)).status).toBe(400);
          callback.searchParams.set("state", state);
          expect(
            (await fetch(callback, { headers: { origin: "https://evil.example" } })).status,
          ).toBe(403);
          const response = await fetch(callback);
          expect(response.status).toBe(200);
          expect(await response.text()).not.toContain(fixture.apiKey);
        },
      });
      expect(credential).toEqual({ ...fixture, apiOrigin: developmentApiOrigin });
      expect(provider.state).toMatchObject({
        pkceVerified: true,
        exchanges: 1,
        projects: 1,
        credentials: 1,
        revocations: 1,
      });
    } finally {
      await provider.close();
    }
  });

  it.each(["issuer", "audience", "nonce", "signature"] as const)(
    "rejects an ID token with invalid %s before requesting projects",
    async (invalidJwt) => {
      const provider = await oauthProvider({ invalidJwt });
      try {
        await expect(login({ ...provider, development: true })).rejects.toThrow(
          "Browser sign-in failed",
        );
        expect(provider.state.projects).toBe(0);
        expect(provider.state.credentials).toBe(0);
      } finally {
        await provider.close();
      }
    },
  );

  it("rejects issuer and scope configuration changes before opening a browser", async () => {
    const provider = await oauthProvider({ configScopes: ["openid", "email"] });
    try {
      await expect(login({ ...provider, development: true })).rejects.toThrow(
        "invalid login configuration",
      );
      expect(provider.state.exchanges).toBe(0);
    } finally {
      await provider.close();
    }
  });

  it("rejects malformed login configuration before authorization without exposing its contents", async () => {
    const provider = await oauthProvider({
      configResponse: {
        issuer: "https://synthetic.clerk.accounts.dev",
        clientId: { secret: fixture.apiKey },
        scopes: ["openid", "browserbase:project_keys:read"],
      },
    });
    try {
      const attempt = login({ ...provider, development: true });
      await expect(attempt).rejects.toThrow("invalid login configuration");
      await expect(attempt).rejects.not.toThrow(fixture.apiKey);
      expect(provider.state.exchanges).toBe(0);
      expect(provider.state.credentials).toBe(0);
    } finally {
      await provider.close();
    }
  });

  it("checks discovery issuer consistency", async () => {
    const provider = await oauthProvider({ discoveryIssuer: "https://wrong.example" });
    try {
      await expect(login({ ...provider, development: true })).rejects.toThrow(
        "Browser sign-in failed",
      );
      expect(provider.state.exchanges).toBe(0);
    } finally {
      await provider.close();
    }
  });

  it("fails a rejected PKCE exchange without obtaining a key", async () => {
    const provider = await oauthProvider();
    try {
      await expect(
        login({
          dashboard: provider.dashboard,
          development: true,
          openBrowser: async (value) => {
            const callback = provider.callbackFor(value);
            provider.state.authorize!.searchParams.set("code_challenge", "invalid-challenge");
            await fetch(callback);
          },
        }),
      ).rejects.toThrow("Browser sign-in failed");
      expect(provider.state.pkceVerified).toBe(false);
      expect(provider.state.credentials).toBe(0);
    } finally {
      await provider.close();
    }
  });

  it("requires project-key scope and revokes the temporary refresh grant on failure", async () => {
    const provider = await oauthProvider({ tokenScopes: "openid" });
    try {
      await expect(login({ ...provider, development: true })).rejects.toThrow(
        "required project-key access",
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

  it("handles denial, cancellation and expiry without obtaining a key", async () => {
    const provider = await oauthProvider();
    try {
      await expect(
        login({
          dashboard: provider.dashboard,
          development: true,
          timeoutMs: 20,
          openBrowser: async () => {},
        }),
      ).rejects.toThrow("expired");
      const controller = new AbortController();
      await expect(
        login({
          dashboard: provider.dashboard,
          development: true,
          signal: controller.signal,
          openBrowser: async () => controller.abort(),
        }),
      ).rejects.toThrow("canceled");
      await expect(
        login({
          dashboard: provider.dashboard,
          development: true,
          openBrowser: async (value) => {
            const callback = provider.callbackFor(value);
            callback.searchParams.delete("code");
            callback.searchParams.set("error", "access_denied");
            await fetch(callback);
          },
        }),
      ).rejects.toThrow("denied");
      expect(provider.state.credentials).toBe(0);
    } finally {
      await provider.close();
    }
  });
});
