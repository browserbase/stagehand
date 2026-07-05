import { describe, expect, it, vi, beforeEach } from "vitest";
import { AnthropicCUAClient } from "../../lib/v3/agent/AnthropicCUAClient.js";

// Helper to create a client with a specific model
function createClient(modelName: string = "claude-sonnet-4-6") {
  return new AnthropicCUAClient(
    "anthropic",
    modelName,
    undefined,
    { apiKey: "test-key" },
  );
}

describe("AnthropicCUAClient zoom tool", () => {
  describe("tool definition", () => {
    it("includes enable_zoom: true for models using computer_20251124", async () => {
      const client = createClient("claude-sonnet-4-6");

      // Access the private method through type casting
      const getActionMethod = (client as unknown as {
        getAction: (inputItems: unknown[]) => Promise<{ content: unknown[]; id: string; usage: Record<string, number> }>;
      }).getAction.bind(client);

      // Mock the Anthropic client to capture the request params
      let capturedParams: Record<string, unknown> | null = null;
      const mockCreate = vi.fn().mockImplementation((params) => {
        capturedParams = params;
        return Promise.resolve({
          id: "test-id",
          content: [{ type: "text", text: "test response" }],
          usage: { input_tokens: 10, output_tokens: 5 },
        });
      });

      // Replace the client's internal Anthropic client
      (client as unknown as { client: { beta: { messages: { create: typeof mockCreate } } } }).client = {
        beta: {
          messages: {
            create: mockCreate,
          },
        },
      };

      // Make a request
      await getActionMethod([{ role: "user", content: "test" }]);

      // Verify the tool definition includes enable_zoom: true
      expect(capturedParams).not.toBeNull();
      const tools = capturedParams!.tools as Array<{ type: string; name: string; enable_zoom?: boolean }>;
      const computerTool = tools.find(t => t.name === "computer");
      expect(computerTool).toBeDefined();
      expect(computerTool!.type).toBe("computer_20251124");
      expect(computerTool!.enable_zoom).toBe(true);
    });

    it("does NOT include enable_zoom for models using computer_20250124", async () => {
      // Use a model that requires the older tool version
      const client = createClient("claude-sonnet-4-20250514");

      let capturedParams: Record<string, unknown> | null = null;
      const mockCreate = vi.fn().mockImplementation((params) => {
        capturedParams = params;
        return Promise.resolve({
          id: "test-id",
          content: [{ type: "text", text: "test response" }],
          usage: { input_tokens: 10, output_tokens: 5 },
        });
      });

      (client as unknown as { client: { beta: { messages: { create: typeof mockCreate } } } }).client = {
        beta: {
          messages: {
            create: mockCreate,
          },
        },
      };

      const getActionMethod = (client as unknown as {
        getAction: (inputItems: unknown[]) => Promise<{ content: unknown[]; id: string; usage: Record<string, number> }>;
      }).getAction.bind(client);

      await getActionMethod([{ role: "user", content: "test" }]);

      const tools = capturedParams!.tools as Array<{ type: string; name: string; enable_zoom?: boolean }>;
      const computerTool = tools.find(t => t.name === "computer");
      expect(computerTool).toBeDefined();
      expect(computerTool!.type).toBe("computer_20250124");
      expect(computerTool!.enable_zoom).toBeUndefined();
    });
  });

  describe("convertToolUseToAction", () => {
    it("converts zoom tool use to a zoom action with region", () => {
      const client = createClient();

      const convertMethod = (client as unknown as {
        convertToolUseToAction: (item: { name: string; input: Record<string, unknown> }) => { type: string; region?: number[] } | null;
      }).convertToolUseToAction.bind(client);

      const toolUseItem = {
        name: "computer",
        input: {
          action: "zoom",
          region: [100, 200, 400, 350],
        },
      };

      const action = convertMethod(toolUseItem);

      expect(action).not.toBeNull();
      expect(action!.type).toBe("zoom");
      expect(action!.region).toEqual([100, 200, 400, 350]);
    });
  });

  describe("takeAction with zoom", () => {
    it("captures a cropped screenshot for the specified region", async () => {
      const client = createClient();

      // Mock screenshot provider to return a full screenshot
      const mockScreenshot = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      client.setScreenshotProvider(async () => mockScreenshot);

      // Mock the cropped screenshot capture method
      let capturedRegion: number[] | undefined;
      const mockCaptureZoomedScreenshot = vi.fn().mockImplementation(async (region: number[]) => {
        capturedRegion = region;
        return `data:image/png;base64,${mockScreenshot}`;
      });

      // Set up the mock for captureZoomedScreenshot
      (client as unknown as { captureZoomedScreenshot: typeof mockCaptureZoomedScreenshot }).captureZoomedScreenshot = mockCaptureZoomedScreenshot;

      const takeActionMethod = (client as unknown as {
        takeAction: (
          toolUseItems: Array<{ id: string; name: string; input: Record<string, unknown> }>,
          logger: (msg: { category: string; message: string; level: number }) => void,
        ) => Promise<Array<{ type: string; tool_use_id: string; content: unknown[] }>>;
      }).takeAction.bind(client);

      const toolUseItems = [
        {
          id: "tool-use-1",
          name: "computer",
          input: {
            action: "zoom",
            region: [100, 200, 400, 350],
          },
        },
      ];

      const results = await takeActionMethod(toolUseItems, vi.fn());

      // Verify that captureZoomedScreenshot was called with the correct region
      expect(mockCaptureZoomedScreenshot).toHaveBeenCalledWith([100, 200, 400, 350]);
      expect(capturedRegion).toEqual([100, 200, 400, 350]);

      // Verify the result contains an image
      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("tool_result");
      expect(results[0].tool_use_id).toBe("tool-use-1");

      const imageContent = results[0].content.find(
        (c: { type: string }) => c.type === "image"
      );
      expect(imageContent).toBeDefined();
    });

    it("falls back to regular screenshot when zoomedScreenshotProvider is not set", async () => {
      const client = createClient();

      // Only set the regular screenshot provider
      const mockScreenshot = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
      client.setScreenshotProvider(async () => mockScreenshot);

      const takeActionMethod = (client as unknown as {
        takeAction: (
          toolUseItems: Array<{ id: string; name: string; input: Record<string, unknown> }>,
          logger: (msg: { category: string; message: string; level: number }) => void,
        ) => Promise<Array<{ type: string; tool_use_id: string; content: unknown[] }>>;
      }).takeAction.bind(client);

      const toolUseItems = [
        {
          id: "tool-use-1",
          name: "computer",
          input: {
            action: "zoom",
            region: [100, 200, 400, 350],
          },
        },
      ];

      // Should not throw, should return a result with an image
      const results = await takeActionMethod(toolUseItems, vi.fn());

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe("tool_result");

      // Should have image content from the regular screenshot
      const imageContent = results[0].content.find(
        (c: { type: string }) => c.type === "image"
      );
      expect(imageContent).toBeDefined();
    });
  });

  describe("setZoomedScreenshotProvider", () => {
    it("allows setting a custom zoomed screenshot provider", () => {
      const client = createClient();

      const mockProvider = vi.fn().mockResolvedValue("base64-image");

      // This method should exist on the client
      expect(typeof client.setZoomedScreenshotProvider).toBe("function");

      // Should not throw
      client.setZoomedScreenshotProvider(mockProvider);
    });
  });
});
