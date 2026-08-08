import { defineMcpClientConnection } from "eve/connections";

const endpoint = process.env.STAGEHAND_MCP_URL ?? "http://127.0.0.1:3000/mcp";

export default defineMcpClientConnection({
  url: endpoint,
  description:
    "Stagehand browser automation isolated behind an authenticated code-mode MCP gateway.",
  auth: {
    getToken: async () => {
      const token = process.env.STAGEHAND_MCP_TOKEN;
      if (!token) throw new Error("STAGEHAND_MCP_TOKEN is required");
      return { token };
    },
  },
  tools: { allow: ["code_execute"] },
});
