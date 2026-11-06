import type { IncomingMessage } from "node:http";
import type { Page, Stagehand } from "../../src/index.js";
import { CDPClient, openCDPWebSocket, resolveBrowserWebSocketUrl } from "../../src/cdpClient.js";
import { startFixtureServer, type FixtureResponse } from "./_support.js";

type RecordedRequest = {
  hostname: string;
  path: string;
  method: string;
  body: string;
  purpose: string;
};

const fetchReply = [
  "async function reply(url, port) {",
  "  try {",
  "    await fetch(url, {cache: 'no-store'});",
  "    port.postMessage('loaded');",
  "  } catch { port.postMessage('blocked'); }",
  "}",
].join("\n");

const workerScript = fetchReply + "\nonmessage = e => reply(e.data, self);";
const sharedWorkerScript =
  fetchReply +
  "\nonconnect = e => { const port = e.ports[0]; port.onmessage = e => reply(e.data, port); port.start(); };";
const serviceWorkerScript = [
  fetchReply,
  "addEventListener('install', e => e.waitUntil(skipWaiting()));",
  "addEventListener('activate', e => e.waitUntil(clients.claim()));",
  "addEventListener('message', e => e.waitUntil(reply(e.data, e.ports[0])));",
].join("\n");
const frameHtml = [
  "<!doctype html><title>cross-site frame</title><script>",
  "addEventListener('message', async e => {",
  "  try {",
  "    await fetch(e.data, {cache: 'no-store'});",
  "    e.source.postMessage('loaded', '*');",
  "  } catch { e.source.postMessage('blocked', '*'); }",
  "});",
  "</script>",
].join("\n");

export async function startDomainPolicyFixture() {
  const requests: RecordedRequest[] = [];
  const fixture = await startFixtureServer(
    async (request: IncomingMessage): Promise<FixtureResponse> => {
      const url = new URL(request.url ?? "/", "http://" + request.headers.host);
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      requests.push({
        hostname: url.hostname,
        path: url.pathname + url.search,
        method: request.method ?? "GET",
        body: Buffer.concat(chunks).toString(),
        purpose: String(request.headers["sec-purpose"] ?? request.headers.purpose ?? ""),
      });
      const headers = {
        "cache-control": "no-store",
        "access-control-allow-origin": "*",
        "supports-loading-mode": "credentialed-prerender",
      };
      if (url.pathname === "/redirect") {
        return {
          status: Number(url.searchParams.get("code") ?? 302),
          headers: { ...headers, location: url.searchParams.get("to")! },
        };
      }
      const scripts: Record<string, string> = {
        "/worker.js": workerScript,
        "/shared-worker.js": sharedWorkerScript,
        "/service-worker.js": serviceWorkerScript,
      };
      if (scripts[url.pathname]) {
        return {
          headers: { ...headers, "content-type": "text/javascript" },
          body: scripts[url.pathname],
        };
      }
      const body =
        url.pathname === "/frame"
          ? frameHtml
          : url.pathname === "/driver"
            ? "<!doctype html><title>driver</title><button onclick=\"this.dataset.clicked='yes'\">Continue</button>"
            : "<!doctype html><title>destination</title><h1>destination</h1>";
      return {
        headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
        body,
      };
    },
  );
  return {
    ...fixture,
    requests,
    target(run: string, hostname = "blocked.test", credentials = false) {
      const url = new URL("/landing", fixture.url);
      url.hostname = hostname;
      url.searchParams.set("run", run);
      url.searchParams.set("payload", "from-page");
      if (credentials) {
        url.username = "user";
        url.password = "pass";
      }
      return url.href;
    },
    received(target: string) {
      const url = new URL(target);
      return requests.filter(
        (request) =>
          request.hostname === url.hostname && request.path === url.pathname + url.search,
      );
    },
  };
}

export type DomainPolicyCdpEvent = {
  method: string;
  sessionId?: string;
  params: {
    requestId?: string;
    request?: { url: string };
    errorText?: string;
    key?: { url: string };
    status?: string;
    prefetchStatus?: string;
    prerenderStatus?: string;
  };
};

/** Observe network/preload completion without installing any Fetch interception. */
export async function observeDomainPolicyRequests(stagehand: Stagehand, page: Page) {
  const signal = AbortSignal.timeout(10_000);
  const url = await resolveBrowserWebSocketUrl(stagehand.browser.cdpUrl!, { signal });
  const socket = await openCDPWebSocket(url, signal);
  const cdp = new CDPClient(socket, url);
  const events: DomainPolicyCdpEvent[] = [];
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as DomainPolicyCdpEvent;
    if (message.method) events.push(message);
  });
  try {
    const { sessionId } = await cdp.sendCommand<{ sessionId: string }>("Target.attachToTarget", {
      targetId: page.pageId,
      flatten: true,
    });
    await cdp.sendCommand("Network.enable", {}, sessionId);
    return { cdp, sessionId, events, close: () => cdp.close() };
  } catch (error) {
    cdp.close();
    throw error;
  }
}
