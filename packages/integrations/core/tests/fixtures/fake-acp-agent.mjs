import { PROTOCOL_VERSION, agent, methods, ndJsonStream } from "@agentclientprotocol/sdk";
import { spawn } from "node:child_process";
import { appendFile } from "node:fs/promises";
import { Readable, Writable } from "node:stream";

const behavior = process.env.ACP_FAKE_BEHAVIOR ?? "success";
const recordPath = process.env.ACP_RECORD_PATH;
let sessionId = "fake-session";

async function record(event) {
  if (recordPath) await appendFile(recordPath, `${JSON.stringify(event)}\n`);
}

const app = agent({ name: "fake-stagehand-test-agent" })
  .onRequest(methods.agent.initialize, async ({ params }) => {
    await record({ type: "initialize", params });
    if (behavior === "hang-with-descendant") {
      const descendant = spawn(
        process.execPath,
        ["-e", "process.on('SIGTERM', () => undefined); setInterval(() => undefined, 1000)"],
        { stdio: "ignore" },
      );
      await record({ type: "descendant", pid: descendant.pid });
    }
    if (behavior === "exit-after-initialize") {
      setTimeout(() => process.exit(17), 0);
    }
    return {
      protocolVersion: behavior === "protocol-mismatch" ? 99 : PROTOCOL_VERSION,
      agentCapabilities: {},
      agentInfo: { name: "fake-agent", version: "1.0.0" },
      ...(behavior === "no-auth" ? {} : { authMethods: [{ id: "test-auth", name: "Test auth" }] }),
    };
  })
  .onRequest(methods.agent.authenticate, async ({ params }) => {
    await record({ type: "authenticate", params });
    return {};
  })
  .onRequest(methods.agent.session.new, async ({ params }) => {
    await record({ type: "session-new", params });
    return { sessionId };
  })
  .onNotification(methods.agent.session.cancel, async ({ params }) => {
    await record({ type: "cancel", params });
  })
  .onRequest(methods.agent.session.prompt, async ({ params, client }) => {
    await record({ type: "prompt", params });
    if (behavior === "hang" || behavior === "hang-with-descendant") {
      process.on("SIGTERM", () => undefined);
      return await new Promise(() => undefined);
    }

    if (behavior === "permission" || behavior === "deny-permission") {
      const allowed = behavior === "permission";
      const permission = await client.request(methods.client.session.requestPermission, {
        sessionId,
        toolCall: {
          toolCallId: "tool-1",
          title: allowed ? "stagehand__snapshot" : "bash",
          _meta: allowed ? { allowed: true } : { allowed: false },
        },
        options: [
          { optionId: "allow", name: "Allow once", kind: "allow_once" },
          { optionId: "reject", name: "Reject once", kind: "reject_once" },
        ],
      });
      await record({ type: "permission-result", permission });
    }

    if (behavior !== "empty") {
      await client.notify(methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "Hello " },
        },
      });
      await client.notify(methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "agent_thought_chunk",
          content: { type: "text", text: "ignored" },
        },
      });
      await client.notify(methods.client.session.update, {
        sessionId,
        update: {
          sessionUpdate: "agent_message_chunk",
          content: { type: "text", text: "browser" },
        },
      });
    }
    return { stopReason: behavior === "refusal" ? "refusal" : "end_turn" };
  });

const connection = app.connect(
  ndJsonStream(Writable.toWeb(process.stdout), Readable.toWeb(process.stdin)),
);
await connection.closed;
