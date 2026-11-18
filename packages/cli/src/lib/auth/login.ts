import * as oauth from "openid-client";
import { z } from "zod";

import { CommandFailure, fail } from "../errors.js";
import {
  developmentApiOrigin,
  productionApiOrigin,
  validateCredential,
  type SavedCredential,
} from "./credential.js";

const requiredScopes = ["openid", "browserbase:api_keys:read"];
const oauthClients = {
  production: {
    issuer: "https://clerk.browserbase.com",
    // Set the registered public client ID before releasing interactive login.
    clientId: "",
  },
  development: {
    issuer: "https://charming-boar-87.clerk.accounts.dev",
    clientId: "FHYs0HMb1Ujb6ztO",
  },
};
const loginProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  organizationName: z.string(),
});
const loginProjectsSchema = z.object({ projects: z.array(loginProjectSchema) });
export type LoginProject = z.infer<typeof loginProjectSchema>;

export function loginProvider(dashboard?: string, development = false) {
  const value =
    dashboard ?? (development ? "https://dev.browserbase.com" : "https://www.browserbase.com");
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    fail("Invalid dashboard origin.");
  }
  const normal = !url.username && !url.password && url.pathname === "/" && !url.search && !url.hash;
  const production = url.origin === "https://www.browserbase.com";
  const dev = url.origin === "https://dev.browserbase.com";
  const loopback =
    url.protocol === "http:" &&
    Boolean(url.port) &&
    (url.hostname === "127.0.0.1" || (url.hostname === "localhost" && url.port === "3000"));
  if (!normal || (development ? !(dev || loopback) : !production)) {
    fail(
      "Use the Browserbase dashboard, or --development with https://dev.browserbase.com or an explicitly forwarded http://127.0.0.1:PORT dashboard.",
    );
  }
  return {
    ...oauthClients[development ? "development" : "production"],
    origin: url.origin,
    apiOrigin: development ? developmentApiOrigin : productionApiOrigin,
  };
}

export async function readLoginJson(response: Response, maxBytes = 32768): Promise<unknown> {
  const bytes = [];
  let size = 0;
  if (!response.body) fail("Invalid credential response.");
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > maxBytes) fail("Invalid credential response.");
    bytes.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(bytes).toString());
  } catch {
    fail("Invalid credential response.");
  }
}

function providerFetch(issuer: URL, signal: AbortSignal): typeof fetch {
  return async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : String(input));
    if (url.origin !== issuer.origin) fail("The login provider returned an unexpected endpoint.");
    return fetch(input, {
      ...init,
      redirect: "error",
      signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal,
    });
  };
}

async function dashboardJson(
  origin: string,
  path: string,
  signal: AbortSignal,
  token: string,
  body?: unknown,
) {
  const response = await fetch(`${origin}${path}`, {
    method: body ? "POST" : "GET",
    redirect: "error",
    signal,
    headers: {
      accept: "application/json",
      authorization: `Bearer ${token}`,
      ...(body ? { "content-type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    await response.body?.cancel();
    fail(`Dashboard login request failed (HTTP ${response.status}).`);
  }
  return readLoginJson(response, path === "/cli/projects" ? 1048576 : 32768);
}

function validateProjects(value: unknown): LoginProject[] {
  const parsed = loginProjectsSchema.safeParse(value);
  if (
    !parsed.success ||
    new Set(parsed.data.projects.map((project) => project.id)).size !== parsed.data.projects.length
  ) {
    fail("The dashboard returned an invalid project list.");
  }
  const projects = parsed.data.projects;
  if (!projects.length) fail("No projects with API-key access are available for this account.");
  return projects;
}

/** Authorize API-key access and retrieve the selected project's credential. */
export async function login({
  dashboard,
  development = false,
  onVerification,
  projectId,
  chooseProject,
  timeoutMs = 600000,
  signal,
}: {
  dashboard?: string;
  development?: boolean;
  onVerification: (verification: { url: string; userCode: string }) => Promise<void>;
  projectId?: string;
  chooseProject?: (projects: LoginProject[], signal: AbortSignal) => Promise<string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<SavedCredential> {
  const { origin, apiOrigin, issuer: issuerUrl, clientId } = loginProvider(dashboard, development);
  if (!clientId) fail("Interactive sign-in is not available in this CLI release.");
  if (typeof onVerification !== "function" || timeoutMs < 10 || timeoutMs > 600000)
    fail("Invalid login configuration.");
  const timeout = AbortSignal.timeout(timeoutMs);
  const activeSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let config: oauth.Configuration | undefined;
  const issuer = new URL(issuerUrl);
  let tokens: Awaited<ReturnType<typeof oauth.pollDeviceAuthorizationGrant>> | undefined;
  let deviceExpiry: AbortSignal | undefined;
  try {
    config = await oauth.discovery(issuer, clientId, undefined, oauth.None(), {
      timeout: 15,
      execute: [oauth.enableNonRepudiationChecks],
      [oauth.customFetch]: providerFetch(issuer, activeSignal),
    });
    for (const field of [
      "device_authorization_endpoint",
      "token_endpoint",
      "jwks_uri",
      "revocation_endpoint",
    ] as const) {
      const endpoint = config.serverMetadata()[field];
      if (!endpoint || new URL(endpoint).origin !== issuer.origin)
        fail("The login provider returned an unexpected endpoint.");
    }
    const authorization = await oauth.initiateDeviceAuthorization(config, {
      scope: requiredScopes.join(" "),
    });
    const verificationUrl = new URL(authorization.verification_uri);
    const localVerification =
      development &&
      verificationUrl.protocol === "http:" &&
      ["localhost", "127.0.0.1"].includes(verificationUrl.hostname);
    if (
      verificationUrl.username ||
      verificationUrl.password ||
      (verificationUrl.protocol !== "https:" && !localVerification)
    )
      fail("The login provider returned an invalid verification URL.");
    deviceExpiry = AbortSignal.timeout(
      Math.min(Math.ceil(authorization.expires_in * 1000), timeoutMs),
    );
    await onVerification({ url: verificationUrl.href, userCode: authorization.user_code });
    tokens = await oauth.pollDeviceAuthorizationGrant(config, authorization, undefined, {
      signal: AbortSignal.any([activeSignal, deviceExpiry]),
    });
    if (!tokens.id_token || !tokens.claims() || tokens.token_type.toLowerCase() !== "bearer")
      fail("Sign-in did not return a valid identity and access token.");
    if (!requiredScopes.every((scope) => tokens?.scope?.split(" ").includes(scope)))
      fail("Sign-in did not grant the required API-key access.");
    const projects = validateProjects(
      await dashboardJson(origin, "/cli/projects", activeSignal, tokens.access_token),
    );
    const selectedId =
      projectId ??
      (projects.length === 1 ? projects[0]!.id : await chooseProject?.(projects, activeSignal));
    if (!selectedId)
      fail("Select a project with --project-id when running without an interactive terminal.");
    if (!projects.some((project) => project.id === selectedId))
      fail("The selected project is not available for this login.");
    const credential = validateCredential(
      await dashboardJson(origin, "/cli/credentials", activeSignal, tokens.access_token, {
        projectId: selectedId,
      }),
      apiOrigin,
    );
    if (credential.projectId !== selectedId)
      fail("The dashboard returned credentials for a different project.");
    return credential;
  } catch (error) {
    if (signal?.aborted) fail("Login canceled.");
    if (timeout.aborted || (!tokens && deviceExpiry?.aborted))
      fail("Authorization expired. Restart login.");
    if (error instanceof oauth.ResponseBodyError) {
      if (error.error === "access_denied") fail("Authorization denied.");
      if (error.error === "expired_token") fail("Authorization expired. Restart login.");
    }
    if (error instanceof CommandFailure) throw error;
    throw new CommandFailure("Device sign-in failed. Restart login.");
  } finally {
    const refreshToken = tokens?.refresh_token;
    tokens = undefined;
    if (refreshToken && config) {
      await revokeTemporaryGrant(config, issuer, refreshToken);
    }
    if (signal?.aborted) fail("Login canceled.");
    if (timeout.aborted) fail("Authorization expired. Restart login.");
  }
}

async function revokeTemporaryGrant(
  config: oauth.Configuration,
  issuer: URL,
  refreshToken: string,
): Promise<void> {
  try {
    if (!config.serverMetadata().revocation_endpoint) throw new Error("No revocation endpoint.");
    config[oauth.customFetch] = providerFetch(issuer, AbortSignal.timeout(15000));
    await oauth.tokenRevocation(config, refreshToken, { token_type_hint: "refresh_token" });
  } catch {
    fail("Could not clear the temporary sign-in grant; no credential was saved.");
  }
}
