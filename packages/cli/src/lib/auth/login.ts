import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import * as oauth from "openid-client";

import { CommandFailure, fail } from "../errors.js";
import {
  developmentApiOrigin,
  productionApiOrigin,
  validateCredential,
  type SavedCredential,
} from "./credential.js";

const requiredScopes = ["openid", "browserbase:project_keys:read"];
export interface LoginProject {
  id: string;
  name: string;
  organizationName: string;
}
const equal = (a: string | null, b: string): boolean =>
  typeof a === "string" &&
  Buffer.byteLength(a) === Buffer.byteLength(b) &&
  timingSafeEqual(Buffer.from(a), Buffer.from(b));

export function loginProvider(
  dashboard?: string,
  development = false,
): { origin: string; apiOrigin: string } {
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

function validateConfig(value: unknown, development: boolean) {
  const record = value as { issuer?: unknown; clientId?: unknown; scopes?: unknown } | null;
  if (
    !record ||
    typeof record.issuer !== "string" ||
    typeof record.clientId !== "string" ||
    !/^[A-Za-z0-9_.-]{1,256}$/.test(record.clientId) ||
    !Array.isArray(record.scopes) ||
    record.scopes.length !== requiredScopes.length ||
    !requiredScopes.every((scope) => (record.scopes as unknown[]).includes(scope))
  ) {
    fail("The dashboard returned an invalid login configuration.");
  }
  let issuer: URL;
  try {
    issuer = new URL(record.issuer);
  } catch {
    fail("Invalid login issuer.");
  }
  if (
    issuer.protocol !== "https:" ||
    issuer.username ||
    issuer.password ||
    issuer.port ||
    issuer.pathname !== "/" ||
    issuer.search ||
    issuer.hash ||
    (development
      ? !issuer.hostname.endsWith(".clerk.accounts.dev")
      : issuer.origin !== "https://clerk.browserbase.com")
  ) {
    fail("Invalid login issuer.");
  }
  return { issuer, clientId: record.clientId };
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
  token?: string,
  body?: unknown,
) {
  const response = await fetch(`${origin}${path}`, {
    method: body ? "POST" : "GET",
    redirect: "error",
    signal,
    headers: {
      accept: "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
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
  const projects = (value as { projects?: unknown } | null)?.projects;
  if (
    !Array.isArray(projects) ||
    projects.some(
      (project) =>
        !project ||
        typeof project.id !== "string" ||
        !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(project.id) ||
        typeof project.name !== "string" ||
        typeof project.organizationName !== "string",
    ) ||
    new Set(projects.map((project) => project.id)).size !== projects.length
  ) {
    fail("The dashboard returned an invalid project list.");
  }
  if (!projects.length) fail("No projects with API-key access are available for this account.");
  return projects as LoginProject[];
}

async function authorize({
  config,
  origin,
  openBrowser,
  signal,
}: {
  config: oauth.Configuration;
  origin: string;
  openBrowser: (url: string) => Promise<void>;
  signal: AbortSignal;
}) {
  const state = oauth.randomState();
  const nonce = oauth.randomNonce();
  const verifier = oauth.randomPKCECodeVerifier();
  let redirectUri = "";
  let accepted = false;
  let resolveCallback!: (url: URL) => void;
  let rejectCallback!: (error: Error) => void;
  const callback = new Promise<URL>((resolve, reject) => {
    resolveCallback = resolve;
    rejectCallback = reject;
  });
  callback.catch(() => {});
  const abort = () => rejectCallback(new Error("Login canceled."));
  const server = createServer((req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    const reject = (status: number) => {
      res.writeHead(status);
      res.end("Invalid authorization callback.");
    };
    if (
      req.headers.host !== new URL(redirectUri).host ||
      !req.url?.startsWith("/") ||
      req.url.startsWith("//")
    )
      return reject(400);
    const url = new URL(req.url, redirectUri);
    if (url.origin !== new URL(redirectUri).origin) return reject(400);
    if (url.pathname !== "/callback") return reject(404);
    if (req.method !== "GET") return reject(405);
    if (
      req.headers.origin &&
      ![origin, config.serverMetadata().issuer].includes(req.headers.origin)
    )
      return reject(403);
    if (accepted) return reject(409);
    if (
      url.searchParams.getAll("state").length !== 1 ||
      !equal(url.searchParams.get("state"), state)
    )
      return reject(400);
    const codes = url.searchParams.getAll("code");
    const errors = url.searchParams.getAll("error");
    if (
      !(
        (codes.length === 1 &&
          codes[0]!.length > 0 &&
          codes[0]!.length <= 2048 &&
          errors.length === 0) ||
        (errors.length === 1 && codes.length === 0)
      )
    )
      return reject(400);
    accepted = true;
    res.end("Authorization received. Return to your terminal.", () => {
      if (errors.length)
        rejectCallback(
          new CommandFailure(
            errors[0] === "access_denied"
              ? "Authorization denied."
              : "Authorization failed. Restart login.",
          ),
        );
      else resolveCallback(url);
    });
  });
  server.on("error", () =>
    rejectCallback(new CommandFailure("Unable to open the loopback callback listener.")),
  );
  try {
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
    else {
      const providerUrl = oauth.buildAuthorizationUrl(config, {
        redirect_uri: redirectUri,
        scope: requiredScopes.join(" "),
        state,
        nonce,
        code_challenge: await oauth.calculatePKCECodeChallenge(verifier),
        code_challenge_method: "S256",
      });
      const url = new URL("/cli/authorize", origin);
      url.search = providerUrl.search;
      Promise.resolve()
        .then(() => openBrowser(url.href))
        .catch(() => rejectCallback(new CommandFailure("Could not open the authorization page.")));
    }
    return await oauth.authorizationCodeGrant(config, await callback, {
      pkceCodeVerifier: verifier,
      expectedState: state,
      expectedNonce: nonce,
    });
  } finally {
    signal.removeEventListener("abort", abort);
    server.close();
    server.closeAllConnections();
  }
}

/** Authorize project-key access, then save only the selected project's API key. */
export async function login({
  dashboard,
  development = false,
  openBrowser,
  projectId,
  chooseProject,
  timeoutMs = 300000,
  signal,
}: {
  dashboard?: string;
  development?: boolean;
  openBrowser: (url: string) => Promise<void>;
  projectId?: string;
  chooseProject?: (projects: LoginProject[], signal: AbortSignal) => Promise<string>;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<SavedCredential> {
  const { origin, apiOrigin } = loginProvider(dashboard, development);
  if (typeof openBrowser !== "function" || timeoutMs < 10 || timeoutMs > 300000)
    fail("Invalid login configuration.");
  const timeout = AbortSignal.timeout(timeoutMs);
  const activeSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let config: oauth.Configuration | undefined;
  let issuer: URL | undefined;
  let tokens: Awaited<ReturnType<typeof oauth.authorizationCodeGrant>> | undefined;
  try {
    const settings = validateConfig(
      await dashboardJson(origin, "/cli/config", activeSignal),
      development,
    );
    issuer = settings.issuer;
    config = await oauth.discovery(issuer, settings.clientId, undefined, oauth.None(), {
      timeout: 15,
      execute: [oauth.enableNonRepudiationChecks],
      [oauth.customFetch]: providerFetch(issuer, activeSignal),
    });
    for (const field of ["authorization_endpoint", "token_endpoint", "jwks_uri"] as const) {
      const endpoint = config.serverMetadata()[field];
      if (!endpoint || new URL(endpoint).origin !== issuer.origin)
        fail("The login provider returned an unexpected endpoint.");
    }
    if (!config.serverMetadata().code_challenge_methods_supported?.includes("S256"))
      fail("The login provider does not support PKCE.");
    tokens = await authorize({ config, origin, openBrowser, signal: activeSignal });
    if (!requiredScopes.every((scope) => tokens?.scope?.split(" ").includes(scope)))
      fail("Sign-in did not grant the required project-key access.");
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
    if (timeout.aborted) fail("Authorization expired. Restart login.");
    if (signal?.aborted) fail("Login canceled.");
    if (error instanceof CommandFailure) throw error;
    throw new CommandFailure("Browser sign-in failed. Restart login.");
  } finally {
    const refreshToken = tokens?.refresh_token;
    tokens = undefined;
    if (refreshToken && config && issuer) {
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
