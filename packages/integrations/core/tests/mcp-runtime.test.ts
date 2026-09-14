import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createCodeModeMcpHost } from "../src/codemode/mcp-runtime.js";

describe("code-mode MCP host", () => {
  let client: Client;
  let server: ReturnType<typeof createCodeModeMcpHost>;

  beforeEach(async () => {
    server = createCodeModeMcpHost();
    client = new Client({ name: "stagehand-codemode-host-test", version: "1.0.0" });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  });

  afterEach(async () => {
    await client.close();
    await server.close();
  });

  it("initializes without advertising the tools capability", () => {
    expect(client.getServerCapabilities()).not.toHaveProperty("tools");
  });
});
