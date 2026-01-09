/**
 * Network-based script injection for maximum stealth.
 *
 * Instead of using Page.addScriptToEvaluateOnNewDocument (which is detectable),
 * we intercept HTML responses and inject our scripts directly into the <head>.
 *
 * This approach (used by Patchright) makes our scripts indistinguishable from
 * the page's own JavaScript.
 */

import type { Protocol } from "devtools-protocol";
import type { CDPSessionLike } from "./cdp";
import { v3ScriptContent } from "../dom/build/scriptV3Content";
import { randomBytes } from "crypto";

const INIT_SCRIPT_CLASS = "__stagehand_init__";

interface NetworkInjectorOptions {
  /** Additional scripts to inject (beyond the piercer) */
  additionalScripts?: string[];
}

/**
 * Install network-based script injection on a CDP session.
 * This intercepts HTML responses and injects scripts into <head>.
 */
export async function installNetworkInjector(
  session: CDPSessionLike,
  options: NetworkInjectorOptions = {},
): Promise<void> {
  const allScripts = [v3ScriptContent, ...(options.additionalScripts ?? [])];

  // Enable Fetch domain to intercept requests
  await session.send("Fetch.enable", {
    patterns: [
      {
        urlPattern: "*",
        resourceType: "Document",
        requestStage: "Response",
      },
    ],
  });

  session.on<Protocol.Fetch.RequestPausedEvent>(
    "Fetch.requestPaused",
    async (event) => {
      try {
        await handleRequestPaused(session, event, allScripts);
      } catch {
        // If anything fails, continue the request unmodified
        try {
          await session.send("Fetch.continueRequest", {
            requestId: event.requestId,
          });
        } catch {
          // Session might be gone
        }
      }
    },
  );
}

async function handleRequestPaused(
  session: CDPSessionLike,
  event: Protocol.Fetch.RequestPausedEvent,
  scripts: string[],
): Promise<void> {
  const { requestId, responseHeaders, responseStatusCode } = event;

  // Only process successful HTML responses
  const contentType =
    responseHeaders?.find(
      (h) => h.name.toLowerCase() === "content-type",
    )?.value ?? "";

  if (
    !contentType.includes("text/html") ||
    !responseStatusCode ||
    responseStatusCode >= 400
  ) {
    await session.send("Fetch.continueRequest", { requestId });
    return;
  }

  // Get the response body
  const { body, base64Encoded } = await session.send<{
    body: string;
    base64Encoded: boolean;
  }>("Fetch.getResponseBody", { requestId });

  let html = base64Encoded ? Buffer.from(body, "base64").toString("utf-8") : body;

  // Check for existing nonce in CSP
  const cspHeader = responseHeaders?.find(
    (h) => h.name.toLowerCase() === "content-security-policy",
  );
  let scriptNonce: string | null = null;

  if (cspHeader?.value) {
    // Look for existing nonce in script-src
    const nonceMatch = cspHeader.value.match(/script-src[^;]*'nonce-([^']+)'/);
    if (nonceMatch) {
      scriptNonce = nonceMatch[1];
    }
  }

  // Build injection HTML
  let injectionHtml = "";
  for (const script of scripts) {
    const scriptId = randomBytes(11).toString("hex");
    const nonceAttr = scriptNonce ? ` nonce="${scriptNonce}"` : "";
    // Self-removing script to hide our injection
    injectionHtml += `<script class="${INIT_SCRIPT_CLASS}"${nonceAttr} id="${scriptId}" type="text/javascript">document.getElementById("${scriptId}")?.remove();${script}</script>`;
  }

  // Inject at end of <head> (or start of <body> if no head)
  html = injectIntoHtml(html, injectionHtml);

  // Fix CSP headers if needed
  const modifiedHeaders = fixCspHeaders(responseHeaders ?? [], scriptNonce);

  // Fulfill the request with modified response
  await session.send("Fetch.fulfillRequest", {
    requestId,
    responseCode: responseStatusCode,
    responseHeaders: modifiedHeaders,
    body: Buffer.from(html, "utf-8").toString("base64"),
  });
}

function injectIntoHtml(html: string, injection: string): string {
  // Try to inject at end of <head>
  const headCloseMatch = html.match(/<\/head\s*>/i);
  if (headCloseMatch && headCloseMatch.index !== undefined) {
    return (
      html.slice(0, headCloseMatch.index) +
      injection +
      html.slice(headCloseMatch.index)
    );
  }

  // Try after opening <head>
  const headOpenMatch = html.match(/<head[^>]*>/i);
  if (headOpenMatch && headOpenMatch.index !== undefined) {
    const insertPoint = headOpenMatch.index + headOpenMatch[0].length;
    return html.slice(0, insertPoint) + injection + html.slice(insertPoint);
  }

  // Try before <body>
  const bodyMatch = html.match(/<body[^>]*>/i);
  if (bodyMatch && bodyMatch.index !== undefined) {
    return html.slice(0, bodyMatch.index) + injection + html.slice(bodyMatch.index);
  }

  // Try after <!DOCTYPE> or at start
  const doctypeMatch = html.match(/<!doctype[^>]*>/i);
  if (doctypeMatch && doctypeMatch.index !== undefined) {
    const insertPoint = doctypeMatch.index + doctypeMatch[0].length;
    return html.slice(0, insertPoint) + injection + html.slice(insertPoint);
  }

  // Last resort: prepend
  return injection + html;
}

function fixCspHeaders(
  headers: Protocol.Fetch.HeaderEntry[],
  existingNonce: string | null,
): Protocol.Fetch.HeaderEntry[] {
  return headers.map((header) => {
    if (header.name.toLowerCase() !== "content-security-policy") {
      return header;
    }

    let csp = header.value;

    // Parse directives
    const directives = csp.split(";").map((d) => d.trim());
    const fixedDirectives: string[] = [];

    let hasScriptSrc = false;

    for (const directive of directives) {
      if (!directive) continue;

      const parts = directive.split(/\s+/);
      const directiveName = parts[0].toLowerCase();

      if (directiveName === "script-src" || directiveName === "default-src") {
        hasScriptSrc = hasScriptSrc || directiveName === "script-src";
        const values = parts.slice(1);

        // Add 'unsafe-eval' if not present (needed for some of our scripts)
        if (!values.includes("'unsafe-eval'")) {
          values.push("'unsafe-eval'");
        }

        // Add 'unsafe-inline' if no nonce exists
        if (!existingNonce && !values.includes("'unsafe-inline'")) {
          values.push("'unsafe-inline'");
        }

        fixedDirectives.push(`${directiveName} ${values.join(" ")}`);
      } else {
        fixedDirectives.push(directive);
      }
    }

    // If no script-src, add one
    if (!hasScriptSrc) {
      if (existingNonce) {
        fixedDirectives.push(
          `script-src 'self' 'unsafe-eval' 'nonce-${existingNonce}' *`,
        );
      } else {
        fixedDirectives.push(`script-src 'self' 'unsafe-eval' 'unsafe-inline' *`);
      }
    }

    return { name: header.name, value: fixedDirectives.join("; ") };
  });
}

/**
 * Disable network injection (cleanup).
 */
export async function disableNetworkInjector(
  session: CDPSessionLike,
): Promise<void> {
  await session.send("Fetch.disable").catch(() => {});
}
