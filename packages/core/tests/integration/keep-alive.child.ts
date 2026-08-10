import { V3 } from "../../lib/v3/v3.js";

async function main(): Promise<void> {
  const encoded = process.argv.find((arg) => arg.startsWith("cfg:"));
  if (!encoded) {
    throw new Error("Missing child config payload.");
  }
  const raw = Buffer.from(encoded.slice(4), "base64").toString("utf8");
  const cfg = JSON.parse(raw) as {
    env: "LOCAL" | "BROWSERBASE";
    keepAlive: boolean;
    disableAPI: boolean;
    scenario: string;
    apiKey?: string;
    projectId?: string;
    debug?: boolean;
    viewMs?: number;
  };
  const {
    env,
    keepAlive,
    disableAPI,
    scenario,
    apiKey,
    projectId,
    debug = false,
    viewMs = 0,
  } = cfg;

  const log = (message: string): void => {
    if (debug) {
      console.log(message);
    }
  };

  if (env !== "LOCAL" && env !== "BROWSERBASE") {
    throw new Error("KEEP_ALIVE_ENV must be LOCAL or BROWSERBASE");
  }
  if (!scenario) {
    throw new Error("KEEP_ALIVE_SCENARIO is required");
  }

  log(
    `[keep-alive-child] env=${env} keepAlive=${keepAlive} disableAPI=${disableAPI} ` +
      `scenario=${scenario} apiKey=${apiKey ? "set" : "missing"} ` +
      `projectId=${projectId ? "set" : "missing"}`,
  );

  const showBrowser = viewMs > 0;
  const v3 = new V3({
    env,
    keepAlive,
    disableAPI,
    apiKey,
    projectId,
    browserbaseSessionCreateParams: undefined,
    localBrowserLaunchOptions:
      env === "LOCAL"
        ? {
            executablePath: process.env.CHROME_PATH,
            args: process.env.CI ? ["--no-sandbox"] : undefined,
            headless: !showBrowser,
            viewport: { width: 1288, height: 711 },
          }
        : undefined,
    verbose: debug ? 2 : 0,
    disablePino: true,
    logger: debug ? (line) => console.log(line) : undefined,
  });

  await v3.init();

  const info = {
    connectURL: v3.connectURL(),
    sessionId: v3.browserbaseSessionId ?? null,
  };
  await new Promise<void>((resolve, reject) => {
    process.stdout.write(`__KEEPALIVE__${JSON.stringify(info)}\n`, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });

  if (env === "LOCAL" && viewMs > 0) {
    await new Promise((r) => setTimeout(r, viewMs));
  }

  if (scenario === "close") {
    await v3.close().catch(() => {});
    process.exit(0);
  }

  if (scenario === "sigterm") {
    return;
  }

  if (scenario === "sigint") {
    return;
  }

  if (scenario === "unhandled") {
    setTimeout(() => {
      void Promise.reject(new Error("keepAlive unhandled rejection"));
    }, 0);
    return;
  }

  throw new Error(`Unknown scenario: ${scenario}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
