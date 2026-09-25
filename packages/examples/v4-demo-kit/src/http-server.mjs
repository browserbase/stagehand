import { createServer } from "node:http";
import { run } from "../scripts/research-hacker-news.mjs";
import { createSession } from "./session.mjs";

const port = Number(process.env.PORT || 8787);
const token = process.env.DEMO_BEARER_TOKEN?.trim();

if (!token) {
  throw new Error("Set DEMO_BEARER_TOKEN before you start the HTTP demo.");
}

const server = createServer(async (request, response) => {
  response.setHeader("content-type", "application/json");
  if (request.method !== "POST" || request.url !== "/run") {
    response.writeHead(404).end(JSON.stringify({ ok: false, error: "not_found" }));
    return;
  }
  if (request.headers.authorization !== `Bearer ${token}`) {
    response.writeHead(401).end(JSON.stringify({ ok: false, error: "unauthorized" }));
    return;
  }

  let session;
  try {
    session = await createSession({ requireModel: true });
    const data = await run(session);
    response.writeHead(200).end(JSON.stringify({ ok: true, data }));
  } catch (error) {
    response.writeHead(500).end(
      JSON.stringify({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  } finally {
    await session?.close();
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Stagehand demo server: http://127.0.0.1:${port}/run`);
});
