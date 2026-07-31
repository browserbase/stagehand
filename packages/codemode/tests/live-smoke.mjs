import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  CodeSessionManager,
  createStagehandChildRuntime,
  runtimeConfigFromEnv,
  startCodeModeHttpServer,
} from "../dist/index.mjs";

if (!process.env.BROWSERBASE_API_KEY) {
  throw new Error("BROWSERBASE_API_KEY is required for the live code-mode smoke.");
}

const runtimeConfig = runtimeConfigFromEnv();
const manager = new CodeSessionManager({
  runtimeFactory: (codeSessionId) => createStagehandChildRuntime(codeSessionId, runtimeConfig),
});
const server = await startCodeModeHttpServer({
  manager,
  host: "127.0.0.1",
  port: 0,
});

const connect = async (name) => {
  const client = new Client({ name, version: "0.1.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(server.url)));
  return client;
};

const parseResult = (result) => {
  if (result.structuredContent && typeof result.structuredContent === "object") {
    return result.structuredContent;
  }
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("code_execute returned no JSON result.");
  return JSON.parse(text);
};

try {
  const healthUrl = new URL("/health", server.url);
  const initialHealth = await fetch(healthUrl).then((response) => response.json());
  assert.equal(initialHealth.browserProvisioning, "lazy");
  assert.equal(initialHealth.activeCodeSessions, 0);

  const firstClient = await connect("codemode-live-smoke-first");
  const tools = await firstClient.listTools();
  assert.deepEqual(
    tools.tools.map((tool) => tool.name),
    ["code_execute"],
  );
  assert.equal(tools.tools[0]?.outputSchema?.type, "object");

  const firstToolResult = await firstClient.callTool({
    name: "code_execute",
    arguments: {
      action: "run",
      code: `
        await page.goto(
          "https://browserbase.github.io/stagehand-eval-sites/sites/new-tab/",
          { waitUntil: "load" }
        );
        return {
          phase: "opened",
          title: await page.title(),
          url: await page.url(),
          pageCount: (await context.pages()).length
        };
      `,
    },
  });
  assert.equal(typeof firstToolResult.structuredContent, "object");
  const first = parseResult(firstToolResult);
  assert.equal(first.ok, true);
  assert.equal(first.value.phase, "opened");
  assert.match(first.value.url, /stagehand-eval-sites\/sites\/new-tab/);

  // Destroy the MCP transport. The logical code session and remote browser must
  // outlive this connection.
  await firstClient.close();
  const disconnectedHealth = await fetch(healthUrl).then((response) => response.json());
  assert.equal(disconnectedHealth.activeCodeSessions, 1);

  const secondClient = await connect("codemode-live-smoke-second");
  const second = parseResult(
    await secondClient.callTool({
      name: "code_execute",
      arguments: {
        action: "run",
        code_session_id: first.code_session_id,
        code: `
          return {
            phase: "reused",
            title: await page.title(),
            url: await page.url(),
            bodyIncludesWelcome: (await page.locator("body").innerText()).includes("Welcome"),
            pageCount: (await context.pages()).length
          };
        `,
      },
    }),
  );
  assert.equal(second.ok, true);
  assert.equal(second.code_session_id, first.code_session_id);
  assert.equal(second.value.url, first.value.url);
  assert.equal(second.value.bodyIncludesWelcome, true);

  const closed = parseResult(
    await secondClient.callTool({
      name: "code_execute",
      arguments: {
        action: "close",
        code_session_id: first.code_session_id,
      },
    }),
  );
  assert.equal(closed.state, "closed");

  const finalHealth = await fetch(healthUrl).then((response) => response.json());
  assert.equal(finalHealth.activeCodeSessions, 0);

  const timedOut = parseResult(
    await secondClient.callTool({
      name: "code_execute",
      arguments: {
        action: "run",
        code: "while (true) {}",
        timeout_ms: 10_000,
      },
    }),
  );
  assert.equal(timedOut.ok, false);
  assert.equal(timedOut.error.kind, "timeout");
  assert.equal(timedOut.error.retryable, false);
  assert.equal(timedOut.error.may_have_side_effects, true);

  const recovered = parseResult(
    await secondClient.callTool({
      name: "code_execute",
      arguments: {
        action: "run",
        code_session_id: timedOut.code_session_id,
        code: `
          await page.goto("https://example.com", { waitUntil: "load" });
          return await page.title();
        `,
      },
    }),
  );
  assert.equal(recovered.ok, true);
  assert.equal(recovered.code_session_id, timedOut.code_session_id);
  assert.equal(recovered.value, "Example Domain");
  await secondClient.callTool({
    name: "code_execute",
    arguments: {
      action: "close",
      code_session_id: timedOut.code_session_id,
    },
  });
  await secondClient.close();

  // oxlint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        status: "PASS",
        tools: tools.tools.map((tool) => tool.name),
        browserProvisioning: initialHealth.browserProvisioning,
        structuredOutput: true,
        transportReconnect: true,
        sameCodeSession: true,
        preservedUrl: second.value.url,
        preservedBodyState: second.value.bodyIncludesWelcome,
        explicitClose: closed.state,
        activeCodeSessionsAfterClose: finalHealth.activeCodeSessions,
        synchronousLoopWatchdog: timedOut.error.kind,
        sameHandleRecoveredAfterWatchdog: recovered.code_session_id === timedOut.code_session_id,
      },
      null,
      2,
    ),
  );
} finally {
  await server.close();
}
