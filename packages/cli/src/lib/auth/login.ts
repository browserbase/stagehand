import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { fail } from "../errors.js";
import {
  developmentApiOrigin,
  productionApiOrigin,
  validateCredential,
  type SavedCredential,
} from "./credential.js";

const nonce = () => randomBytes(32).toString("base64url");
export const challengeFor = (verifier: string): string =>
  createHash("sha256").update(verifier).digest("base64url");
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

async function exchangeCode(
  origin: string,
  apiOrigin: string,
  code: string,
  verifier: string,
  redirectUri: string,
  signal: AbortSignal,
): Promise<SavedCredential> {
  let response;
  try {
    response = await fetch(`${origin}/cli/token`, {
      method: "POST",
      redirect: "error",
      signal,
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        grant_type: "authorization_code",
        client_id: "browserbase-cli",
        code,
        code_verifier: verifier,
        redirect_uri: redirectUri,
      }),
    });
  } catch {
    fail("Authorization-code exchange failed.");
  }
  if (!response.ok) fail("Authorization-code exchange was rejected.");
  return validateCredential(await readLoginJson(response), apiOrigin);
}

export async function readLoginJson(response: Response): Promise<unknown> {
  const bytes = [];
  let size = 0;
  if (!response.body) fail("Invalid credential response.");
  for await (const chunk of response.body) {
    size += chunk.length;
    if (size > 32768) {
      // Leaving the body iterator cancels the stream.
      fail("Invalid credential response.");
    }
    bytes.push(chunk);
  }
  let data;
  try {
    data = JSON.parse(Buffer.concat(bytes).toString());
  } catch {
    fail("Invalid credential response.");
  }
  return data;
}

/** A browser approval returns a single-use code bound to this process's verifier. */
export async function login({
  dashboard,
  development = false,
  openBrowser,
  timeoutMs = 300000,
  signal,
}: {
  dashboard?: string;
  development?: boolean;
  openBrowser: (url: string) => Promise<void>;
  timeoutMs?: number;
  signal?: AbortSignal;
}): Promise<SavedCredential> {
  const { origin, apiOrigin } = loginProvider(dashboard, development);
  if (typeof openBrowser !== "function" || timeoutMs < 10 || timeoutMs > 300000)
    fail("Invalid login configuration.");
  const state = nonce();
  const verifier = nonce();
  const controller = new AbortController();
  let redirectUri = "";
  let accepted = false;
  let completed = false;
  let timer: ReturnType<typeof setTimeout> | undefined = undefined;
  let resolveResult!: (value: SavedCredential) => void;
  let rejectResult!: (error: Error) => void;
  const result = new Promise<SavedCredential>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });
  // Install a rejection handler before opening a potentially slow browser.
  result.catch(() => {});
  const abort = () => finish(new Error("Login canceled."));
  const server = createServer((req, res) => {
    res.setHeader("cache-control", "no-store");
    res.setHeader("referrer-policy", "no-referrer");
    res.setHeader("content-type", "text/plain; charset=utf-8");
    res.setHeader("content-security-policy", "default-src 'none'; frame-ancestors 'none'");
    const rejectRequest = (status: number) => {
      res.writeHead(status);
      res.end("Invalid authorization callback.");
    };
    if (
      req.headers.host !== new URL(redirectUri).host ||
      !req.url?.startsWith("/") ||
      req.url.startsWith("//")
    )
      return rejectRequest(400);
    let url;
    try {
      url = new URL(req.url, redirectUri);
    } catch {
      return rejectRequest(400);
    }
    if (url.origin !== new URL(redirectUri).origin) return rejectRequest(400);
    if (url.pathname !== "/callback") return rejectRequest(404);
    if (req.method !== "GET") return rejectRequest(405);
    if (req.headers.origin && req.headers.origin !== origin) return rejectRequest(403);
    if (accepted) return rejectRequest(409);
    if (
      url.searchParams.getAll("state").length !== 1 ||
      !equal(url.searchParams.get("state"), state)
    )
      return rejectRequest(400);
    const codes = url.searchParams.getAll("code");
    const errors = url.searchParams.getAll("error");
    if (
      !(
        (codes.length === 1 && errors.length === 0 && /^[A-Za-z0-9_-]{43}$/.test(codes[0]!)) ||
        (errors.length === 1 && codes.length === 0 && errors[0] === "access_denied")
      )
    )
      return rejectRequest(400);
    accepted = true;
    res.once("finish", () => {
      server.close();
      if (errors.length) return finish(new Error("Authorization denied."));
      void exchangeCode(
        origin,
        apiOrigin,
        codes[0]!,
        verifier,
        redirectUri,
        controller.signal,
      ).then((credential) => finish(null, credential), finish);
    });
    res.end(
      errors.length
        ? "Authorization denied. You can close this tab."
        : "Authorization received. Return to your terminal.",
    );
  });
  function finish(error: unknown, value?: SavedCredential) {
    if (completed) return;
    completed = true;
    clearTimeout(timer);
    signal?.removeEventListener("abort", abort);
    controller.abort();
    server.close();
    server.closeAllConnections();
    if (error) rejectResult(error instanceof Error ? error : new Error("Login failed."));
    else resolveResult(value!);
  }
  server.on("error", () => finish(new Error("Unable to open the loopback callback listener.")));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}/callback`;
  timer = setTimeout(() => finish(new Error("Authorization expired. Restart login.")), timeoutMs);
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) {
    abort();
    return result;
  }
  const authorize = new URL("/cli/authorize", origin);
  authorize.search = new URLSearchParams({
    client_id: "browserbase-cli",
    redirect_uri: redirectUri,
    state,
    code_challenge: challengeFor(verifier),
    code_challenge_method: "S256",
  }).toString();
  Promise.resolve()
    .then(() => openBrowser(authorize.toString()))
    .catch(() => finish(new Error("Could not open the authorization page.")));
  return result;
}
