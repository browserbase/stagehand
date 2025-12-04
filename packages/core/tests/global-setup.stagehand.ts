import type { ProvidedContext } from "vitest";

const DEFAULT_REMOTE_URL = "https://api.stagehand.browserbase.com/v1";
const DEFAULT_LOCAL_PORT = 43123;

type StagehandGlobalSetupContext = {
  provide: <K extends keyof ProvidedContext>(
    key: K,
    value: ProvidedContext[K],
  ) => void;
};

let localServer: { close: () => Promise<void>; getUrl: () => string } | null =
  null;
let localServerStagehand: { close: () => Promise<void> } | null = null;

async function startLocalServer() {
  const { Stagehand } = await import("../dist/index.js");

  const host = process.env.STAGEHAND_LOCAL_HOST ?? "127.0.0.1";
  const port = Number(process.env.STAGEHAND_LOCAL_PORT ?? DEFAULT_LOCAL_PORT);
  const serverModel =
    process.env.STAGEHAND_SERVER_MODEL ?? "openai/gpt-4o-mini";
  const serverApiKey =
    process.env.STAGEHAND_SERVER_MODEL_API_KEY ?? process.env.OPENAI_API_KEY;

  if (!serverApiKey) {
    throw new Error(
      "Missing STAGEHAND_SERVER_MODEL_API_KEY or OPENAI_API_KEY for local Stagehand server.",
    );
  }

  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 0,
    localBrowserLaunchOptions: {
      headless: process.env.STAGEHAND_LOCAL_HEADLESS !== "false",
    },
    model: serverModel,
  });

  await stagehand.init();

  const server = stagehand.createServer({
    host,
    port,
  });

  await server.listen();

  localServer = server;
  localServerStagehand = stagehand;

  return `http://${host}:${port}/v1`;
}

export async function setup(ctx: StagehandGlobalSetupContext) {
  const target = (process.env.STAGEHAND_TEST_TARGET ?? "local").toLowerCase();
  const normalizedTarget = target === "local" ? "local" : "remote";
  ctx.provide("STAGEHAND_TEST_TARGET", normalizedTarget);

  if (normalizedTarget === "local") {
    const baseUrl = await startLocalServer();
    ctx.provide("STAGEHAND_BASE_URL", baseUrl.replace(/\/$/, ""));
    return;
  }

  const remoteBaseUrl =
    process.env.STAGEHAND_BASE_URL ??
    process.env.STAGEHAND_REMOTE_URL ??
    DEFAULT_REMOTE_URL;

  ctx.provide("STAGEHAND_BASE_URL", remoteBaseUrl.replace(/\/$/, ""));
}

export async function teardown() {
  if (localServer) {
    try {
      await localServer.close();
    } catch {
      //
    } finally {
      localServer = null;
    }
  }

  if (localServerStagehand) {
    try {
      await localServerStagehand.close();
    } catch {
      //
    } finally {
      localServerStagehand = null;
    }
  }
}
