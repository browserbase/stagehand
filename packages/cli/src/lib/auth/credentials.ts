import type { ClientOptions } from "@browserbasehq/sdk";

import { fail } from "../errors.js";
import { productionApiOrigin, readCredential } from "./store.js";

export interface ResolvedCredential {
  apiKey: string;
  baseUrl: string;
  projectId?: string;
  source: "flag" | "environment" | "saved";
}

export function resolveCredential(
  args: { apiKey?: string; baseUrl?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): ResolvedCredential | undefined {
  const explicitKey = args.apiKey ?? env.BROWSERBASE_API_KEY;
  const explicitBaseUrl = args.baseUrl ?? env.BROWSERBASE_BASE_URL;
  if (explicitKey !== undefined) {
    if (!explicitKey) return undefined;
    return {
      apiKey: explicitKey,
      baseUrl: explicitBaseUrl ?? productionApiOrigin,
      projectId: env.BROWSERBASE_PROJECT_ID,
      source: args.apiKey !== undefined ? "flag" : "environment",
    };
  }
  const saved = readCredential(env);
  if (!saved) return undefined;
  if (env.DEBUG === "true") {
    fail(
      "Unset DEBUG before using a saved credential; SDK debug logs may include authentication headers.",
    );
  }
  if (explicitBaseUrl !== undefined && !isExactOrigin(explicitBaseUrl, saved.apiOrigin)) {
    fail(
      "Saved credentials cannot be sent to a different API URL. Remove the base URL override, or supply an explicit API key for that destination.",
    );
  }
  if (env.BROWSERBASE_PROJECT_ID && env.BROWSERBASE_PROJECT_ID !== saved.projectId) {
    fail(
      "BROWSERBASE_PROJECT_ID differs from your saved login project. Unset it or run browse login to select that project.",
    );
  }
  return { ...saved, baseUrl: saved.apiOrigin, source: "saved" };
}

function isExactOrigin(value: string, origin: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.origin === origin &&
      url.pathname === "/" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

export function assertCredentialDestination(credential: ResolvedCredential, value: string): void {
  if (credential.source !== "saved") return;
  const url = new URL(value);
  if (url.origin !== credential.baseUrl || url.username || url.password) {
    fail("Refusing to send a saved credential to a different destination.");
  }
}

/** The SDK also uses this transport for pagination URLs and uploads. */
export function credentialFetch(credential: ResolvedCredential): typeof fetch {
  if (credential.source !== "saved") return fetch;
  return async (input, init) => {
    const url = typeof input === "string" || input instanceof URL ? String(input) : input.url;
    assertCredentialDestination(credential, url);
    try {
      const requestInit: RequestInit & { duplex?: "half" } = { ...init, redirect: "error" };
      // SDK multipart uploads use a Node Readable body; native fetch requires duplex.
      if (init?.body && typeof init.body === "object" && Symbol.asyncIterator in init.body)
        requestInit.duplex = "half";
      const response = await fetch(input, requestInit);
      if (!response.ok) {
        // Do not let a reflected server error print a saved key to the terminal.
        await response.body?.cancel();
        return new Response(
          JSON.stringify({ message: `Browserbase request failed (HTTP ${response.status}).` }),
          {
            status: response.status,
            headers: sanitizedRetryHeaders(response.headers),
          },
        );
      }
      return response;
    } catch (error) {
      if (
        error instanceof Error &&
        (error.name === "AbortError" || error.name === "TimeoutError")
      ) {
        // Preserve cancellation/timeout classification without reflecting the error message or cause.
        throw new DOMException("Browserbase request was aborted or timed out.", error.name);
      }
      fail(
        "Browserbase request failed. Check your connection and API URL; authenticated redirects are not followed.",
      );
    }
  };
}

function sanitizedRetryHeaders(headers: Headers): Headers {
  const safe = new Headers({ "content-type": "application/json" });
  const shouldRetry = headers.get("x-should-retry");
  if (shouldRetry === "true" || shouldRetry === "false") safe.set("x-should-retry", shouldRetry);
  for (const name of ["retry-after", "retry-after-ms"]) {
    const value = headers.get(name);
    if (value === null) continue;
    if (/^\d+(?:\.\d+)?$/.test(value) && Number.isFinite(Number(value))) {
      safe.set(name, value);
    } else if (name === "retry-after" && Number.isFinite(Date.parse(value))) {
      // Canonicalize dates so arbitrary server text cannot survive in an SDK error's headers.
      safe.set(name, new Date(value).toUTCString());
    }
  }
  return safe;
}

// The SDK supports native Node fetch at runtime, but its public type still
// includes node-fetch-only Response helpers. Keep that compatibility cast here.
export function sdkCredentialFetch(
  credential: ResolvedCredential,
): NonNullable<ClientOptions["fetch"]> {
  return credentialFetch(credential) as unknown as NonNullable<ClientOptions["fetch"]>;
}
