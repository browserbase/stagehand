import { Browserbase } from "@browserbasehq/sdk";
import { BrowserContext, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";
import { BrowserResult } from "../types/browser";
import { LogLine } from "../types/log";

const BROWSERBASE_REGION_DOMAIN = {
  "us-west-2": "wss://connect.usw2.browserbase.com",
  "us-east-1": "wss://connect.use1.browserbase.com",
  "eu-central-1": "wss://connect.euc1.browserbase.com",
  "ap-southeast-1": "wss://connect.apse1.browserbase.com",
};

export async function getBrowser(
  apiKey: string | undefined,
  projectId: string | undefined,
  env: "LOCAL" | "BROWSERBASE" = "LOCAL",
  headless: boolean = false,
  logger: (message: LogLine) => void,
  browserbaseSessionCreateParams?: Browserbase.Sessions.SessionCreateParams,
  browserbaseSessionID?: string,
): Promise<BrowserResult> {
  if (env === "BROWSERBASE") {
    if (!apiKey) {
      logger({
        category: "init",
        message:
          "BROWSERBASE_API_KEY is required to use BROWSERBASE env. Defaulting to LOCAL.",
        level: 0,
      });
      env = "LOCAL";
    }
    if (!projectId) {
      logger({
        category: "init",
        message:
          "BROWSERBASE_PROJECT_ID is required for some Browserbase features that may not work without it.",
        level: 1,
      });
    }
  }

  if (env === "BROWSERBASE") {
    if (!apiKey) {
      throw new Error("BROWSERBASE_API_KEY is required.");
    }

    let debugUrl: string | undefined = undefined;
    let sessionUrl: string | undefined = undefined;
    let sessionId: string;
    let connectUrl: string;

    const browserbase = new Browserbase({
      apiKey,
    });

    if (browserbaseSessionID) {
      // Validate the session status
      try {
        const sessionStatus =
          await browserbase.sessions.retrieve(browserbaseSessionID);

        if (sessionStatus.status !== "RUNNING") {
          throw new Error(
            `Session ${browserbaseSessionID} is not running (status: ${sessionStatus.status})`,
          );
        }

        sessionId = browserbaseSessionID;
        const browserbaseDomain =
          BROWSERBASE_REGION_DOMAIN[sessionStatus.region] ||
          "wss://connect.browserbase.com";
        connectUrl = `${browserbaseDomain}?apiKey=${apiKey}&sessionId=${sessionId}`;

        logger({
          category: "init",
          message: "resuming existing browserbase session...",
          level: 1,
          auxiliary: {
            sessionId: {
              value: sessionId,
              type: "string",
            },
          },
        });
      } catch (error) {
        logger({
          category: "init",
          message: "failed to resume session",
          level: 1,
          auxiliary: {
            error: {
              value: error.message,
              type: "string",
            },
            trace: {
              value: error.stack,
              type: "string",
            },
          },
        });
        throw error;
      }
    } else {
      // Create new session (existing code)
      logger({
        category: "init",
        message: "creating new browserbase session...",
        level: 0,
      });

      if (!projectId) {
        throw new Error(
          "BROWSERBASE_PROJECT_ID is required for new Browserbase sessions.",
        );
      }

      const session = await browserbase.sessions.create({
        projectId,
        ...browserbaseSessionCreateParams,
      });

      sessionId = session.id;
      connectUrl = session.connectUrl;
      logger({
        category: "init",
        message: "created new browserbase session",
        level: 1,
        auxiliary: {
          sessionId: {
            value: sessionId,
            type: "string",
          },
        },
      });
    }

    const browser = await chromium.connectOverCDP(connectUrl);
    const { debuggerUrl } = await browserbase.sessions.debug(sessionId);

    debugUrl = debuggerUrl;
    sessionUrl = `https://www.browserbase.com/sessions/${sessionId}`;

    logger({
      category: "init",
      message: browserbaseSessionID
        ? "browserbase session resumed"
        : "browserbase session started",
      level: 0,
      auxiliary: {
        sessionUrl: {
          value: sessionUrl,
          type: "string",
        },
        debugUrl: {
          value: debugUrl,
          type: "string",
        },
        sessionId: {
          value: sessionId,
          type: "string",
        },
      },
    });

    const context = browser.contexts()[0];

    return { browser, context, debugUrl, sessionUrl, sessionId, env };
  } else {
    logger({
      category: "init",
      message: "launching local browser",
      level: 0,
      auxiliary: {
        headless: {
          value: headless.toString(),
          type: "boolean",
        },
      },
    });

    const tmpDirPath = path.join(os.tmpdir(), "stagehand");
    if (!fs.existsSync(tmpDirPath)) {
      fs.mkdirSync(tmpDirPath, { recursive: true });
    }

    const tmpDir = fs.mkdtempSync(path.join(tmpDirPath, "ctx_"));
    fs.mkdirSync(path.join(tmpDir, "userdir/Default"), { recursive: true });

    const defaultPreferences = {
      plugins: {
        always_open_pdf_externally: true,
      },
    };

    fs.writeFileSync(
      path.join(tmpDir, "userdir/Default/Preferences"),
      JSON.stringify(defaultPreferences),
    );

    const downloadsPath = path.join(process.cwd(), "downloads");
    fs.mkdirSync(downloadsPath, { recursive: true });

    const context = await chromium.launchPersistentContext(
      path.join(tmpDir, "userdir"),
      {
        acceptDownloads: true,
        headless: headless,
        viewport: {
          width: 1250,
          height: 800,
        },
        locale: "en-US",
        timezoneId: "America/New_York",
        deviceScaleFactor: 1,
        args: [
          "--enable-webgl",
          "--use-gl=swiftshader",
          "--enable-accelerated-2d-canvas",
          "--disable-blink-features=AutomationControlled",
          "--disable-web-security",
        ],
        bypassCSP: true,
      },
    );

    logger({
      category: "init",
      message: "local browser started successfully.",
    });

    await applyStealthScripts(context);

    return { context, contextPath: tmpDir, env: "LOCAL" };
  }
}

export async function applyStealthScripts(context: BrowserContext) {
  await context.addInitScript(() => {
    // Override the navigator.webdriver property
    Object.defineProperty(navigator, "webdriver", {
      get: () => undefined,
    });

    // Mock languages and plugins to mimic a real browser
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
    });

    Object.defineProperty(navigator, "plugins", {
      get: () => [1, 2, 3, 4, 5],
    });

    // Remove Playwright-specific properties
    delete window.__playwright;
    delete window.__pw_manual;
    delete window.__PW_inspect;

    // Redefine the headless property
    Object.defineProperty(navigator, "headless", {
      get: () => false,
    });

    // Override the permissions API
    const originalQuery = window.navigator.permissions.query;
    window.navigator.permissions.query = (parameters) =>
      parameters.name === "notifications"
        ? Promise.resolve({
            state: Notification.permission,
          } as PermissionStatus)
        : originalQuery(parameters);
  });
}
