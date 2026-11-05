import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { vi } from "vitest";

const issuer = "https://synthetic.clerk.accounts.dev";
const clientId = "synthetic-public-client";
export const grantScopes = "openid browserbase:project_keys:read";
export const projectId = "00000000-0000-4000-8000-000000000001";
export const otherProjectId = "00000000-0000-4000-8000-000000000002";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherPair = generateKeyPairSync("rsa", { modulusLength: 2048 });
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

export async function oauthProvider(
  options: {
    configScopes?: string[];
    configIssuer?: string;
    configResponse?: unknown;
    projectsResponse?: unknown;
    discoveryIssuer?: string;
    invalidJwt?: "audience" | "issuer" | "nonce" | "signature";
    tokenScopes?: string;
    wrongCredentialProject?: boolean;
    manyProjects?: boolean;
    rejectRevocation?: boolean;
    onRevoke?: () => void;
  } = {},
) {
  const actualFetch = globalThis.fetch;
  const state = {
    authorize: undefined as URL | undefined,
    exchanges: 0,
    projects: 0,
    credentials: 0,
    revocations: 0,
    pkceVerified: false,
  };
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== issuer) return actualFetch(input, init);
    if (url.pathname === "/.well-known/openid-configuration")
      return json({
        issuer: options.discoveryIssuer ?? issuer,
        authorization_endpoint: `${issuer}/oauth/authorize`,
        token_endpoint: `${issuer}/oauth/token`,
        jwks_uri: `${issuer}/jwks`,
        revocation_endpoint: `${issuer}/oauth/revoke`,
        code_challenge_methods_supported: ["S256"],
        response_types_supported: ["code"],
        id_token_signing_alg_values_supported: ["RS256"],
        token_endpoint_auth_methods_supported: ["none"],
        authorization_response_iss_parameter_supported: true,
      });
    if (url.pathname === "/jwks")
      return json({
        keys: [
          { ...pair.publicKey.export({ format: "jwk" }), kid: "test", alg: "RS256", use: "sig" },
        ],
      });
    const body =
      init?.body instanceof URLSearchParams
        ? init.body
        : new URLSearchParams(typeof init?.body === "string" ? init.body : "");
    if (url.pathname === "/oauth/revoke") {
      if (body.get("client_id") !== clientId || body.get("token") !== "synthetic-refresh-token")
        return json({ error: "invalid_client" }, 400);
      state.revocations++;
      options.onRevoke?.();
      return options.rejectRevocation
        ? json({ error: "temporarily_unavailable" }, 503)
        : new Response(null, { status: 200 });
    }
    if (url.pathname === "/oauth/token") {
      state.exchanges++;
      if (
        body.get("client_id") !== clientId ||
        body.has("client_secret") ||
        body.get("redirect_uri") !== state.authorize?.searchParams.get("redirect_uri")
      )
        return json({ error: "invalid_client" }, 400);
      state.pkceVerified =
        createHash("sha256")
          .update(body.get("code_verifier") ?? "")
          .digest("base64url") === state.authorize?.searchParams.get("code_challenge");
      if (!state.pkceVerified) return json({ error: "invalid_grant" }, 400);
      const now = Math.floor(Date.now() / 1000);
      const header = Buffer.from(JSON.stringify({ alg: "RS256", kid: "test" })).toString(
        "base64url",
      );
      const payload = Buffer.from(
        JSON.stringify({
          iss: options.invalidJwt === "issuer" ? "https://wrong.example" : issuer,
          aud: options.invalidJwt === "audience" ? "other-client" : clientId,
          nonce:
            options.invalidJwt === "nonce"
              ? "wrong-nonce"
              : state.authorize?.searchParams.get("nonce"),
          sub: "synthetic-user",
          iat: now,
          exp: now + 300,
        }),
      ).toString("base64url");
      const signature = sign(
        "RSA-SHA256",
        Buffer.from(`${header}.${payload}`),
        options.invalidJwt === "signature" ? otherPair.privateKey : pair.privateKey,
      ).toString("base64url");
      return json({
        access_token: "synthetic-access-token",
        refresh_token: "synthetic-refresh-token",
        token_type: "Bearer",
        expires_in: 300,
        scope: options.tokenScopes ?? grantScopes,
        id_token: `${header}.${payload}.${signature}`,
      });
    }
    throw new Error("Unexpected synthetic OAuth request");
  });
  const server = createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/cli/config") {
      response.end(
        JSON.stringify(
          "configResponse" in options
            ? options.configResponse
            : {
                issuer: options.configIssuer ?? issuer,
                clientId,
                scopes: options.configScopes ?? grantScopes.split(" "),
              },
        ),
      );
      return;
    }
    if (request.headers.authorization !== "Bearer synthetic-access-token") {
      response.writeHead(401);
      response.end("{}");
      return;
    }
    if (request.url === "/cli/projects") {
      state.projects++;
      response.end(
        JSON.stringify(
          "projectsResponse" in options
            ? options.projectsResponse
            : {
                projects: [
                  { id: projectId, name: "Example", organizationName: "Example organization" },
                  ...(options.manyProjects
                    ? [
                        {
                          id: otherProjectId,
                          name: "Second",
                          organizationName: "Example organization",
                        },
                      ]
                    : []),
                ],
              },
        ),
      );
      return;
    }
    if (request.url === "/cli/credentials") {
      state.credentials++;
      let body = "";
      for await (const chunk of request) body += chunk;
      const selected = JSON.parse(body).projectId;
      response.end(
        JSON.stringify({
          apiKey: "synthetic-test-key",
          projectId: options.wrongCredentialProject ? otherProjectId : selected,
          apiOrigin: "https://api.dev.browserbase.com",
        }),
      );
      return;
    }
    response.writeHead(404);
    response.end("{}");
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const dashboard = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const callbackFor = (value: string) => {
    state.authorize = new URL(value);
    const url = new URL(state.authorize.searchParams.get("redirect_uri")!);
    url.search = new URLSearchParams({
      code: "synthetic-authorization-code",
      state: state.authorize.searchParams.get("state")!,
      iss: issuer,
    }).toString();
    return url;
  };
  return {
    state,
    dashboard,
    callbackFor,
    openBrowser: async (url: string) => {
      await actualFetch(callbackFor(url));
    },
    close: async () => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
