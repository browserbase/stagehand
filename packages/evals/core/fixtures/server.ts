import http from "node:http";

const FIXTURE_HOST = "127.0.0.1";
const BASE_URL_ENV = "EVAL_CORE_FIXTURE_BASE_URL";

type FixtureRoute = {
  path: string;
  html: string;
};

let serverPromise: Promise<string> | null = null;

export function getCoreFixtureBaseUrl(): string | undefined {
  return process.env[BASE_URL_ENV];
}

export async function ensureCoreFixtureServer(
  routes: FixtureRoute[],
): Promise<string> {
  if (process.env[BASE_URL_ENV]) {
    return process.env[BASE_URL_ENV]!;
  }

  if (!serverPromise) {
    serverPromise = new Promise<string>((resolve, reject) => {
      const routeMap = new Map(routes.map((route) => [route.path, route.html]));
      const server = http.createServer((req, res) => {
        const pathname = new URL(req.url ?? "/", `http://${FIXTURE_HOST}`)
          .pathname;
        const html = routeMap.get(pathname);

        if (!html) {
          res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
          res.end("Not found");
          return;
        }

        res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
        res.end(html);
      });

      server.on("error", reject);
      server.listen(0, FIXTURE_HOST, () => {
        const address = server.address();
        if (!address || typeof address === "string") {
          reject(new Error("Failed to determine core fixture server address"));
          return;
        }

        // Don't keep the process alive when the CLI is done running tasks.
        // Pre-change this lived in a tsx child process that exited after
        // each run; now runs are in-process, so we have to opt out of
        // holding the event loop open ourselves.
        server.unref();

        const baseUrl = `http://${FIXTURE_HOST}:${address.port}`;
        process.env[BASE_URL_ENV] = baseUrl;
        resolve(baseUrl);
      });
    });
  }

  return serverPromise;
}
