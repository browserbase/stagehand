import {
  runGeminiCuaSession,
  buildGeminiCuaTranscript,
} from "@browserbasehq/stagehand-integrations-gemini-cua-sdk";
import { vi } from "vitest";
import { describe, expect, it } from "vitest";
import type { GeminiCuaSessionEvent } from "@browserbasehq/stagehand-integrations-gemini-cua-sdk";
import { geminiCuaAdapter } from "../../framework/harnesses/geminiCuaAdapter.js";

describe("geminiCuaAdapter", () => {
  it("pairs tool events with results and preserves reasoning and observations", () => {
    const events: GeminiCuaSessionEvent[] = [
      {
        type: "assistant",
        turn: 1,
        text: "I will click.",
        parts: [],
        usage: { input: 1, output: 1, reasoning: 0, cached_input: 0, total: 0 },
      },
      { type: "tool_use", turn: 1, id: "call-1", name: "click_at", input: { x: 0, y: 0 } },
      {
        type: "tool_result",
        turn: 1,
        id: "call-1",
        name: "click_at",
        text: "Clicked.",
        error: false,
      },
      {
        type: "assistant",
        turn: 2,
        text: 'EVAL_RESULT: {"success":true}',
        parts: [],
        usage: { input: 1, output: 1, reasoning: 0, cached_input: 0, total: 0 },
      },
    ];
    const trajectory = geminiCuaAdapter.fromHarnessResult(
      { events, stepObservations: [{ runIndex: 0, evidence: { url: "https://example.com" } }] },
      { id: "task", instruction: "click", initUrl: "https://example.com" },
    );
    expect(trajectory.steps[0]).toMatchObject({
      actionName: "click_at",
      reasoning: "I will click.",
      toolOutput: { ok: true, result: "Clicked." },
      probeEvidence: { url: "https://example.com" },
    });
    expect(trajectory.finalAnswer).toContain("EVAL_RESULT");
  });
  it("keeps evidence on its tool ID after an earlier failed call", () => {
    const events: GeminiCuaSessionEvent[] = [
      { type: "tool_use", turn: 1, id: "failed", name: "click_at", input: {} },
      {
        type: "tool_result",
        turn: 1,
        id: "failed",
        name: "click_at",
        text: "missing target",
        error: true,
      },
      { type: "tool_use", turn: 1, id: "ok", name: "navigate", input: {} },
      { type: "tool_result", turn: 1, id: "ok", name: "navigate", text: "done", error: false },
    ];
    const trajectory = geminiCuaAdapter.fromHarnessResult(
      {
        events,
        stepObservationsByToolUse: new Map([["ok", { url: "https://fixture.test/after" }]]),
      },
      { id: "identity", instruction: "navigate" },
    );
    expect(trajectory.steps[0]?.probeEvidence).toEqual({});
    expect(trajectory.steps[1]?.probeEvidence).toEqual({ url: "https://fixture.test/after" });
  });
});

it("preserves the exact model-visible response image and URL under the matching tool ID", async () => {
  let turn = 0;
  const screenshots = [Buffer.from("first image"), Buffer.from("second image")];
  let screenshotIndex = 0;
  const screenshot = vi.fn(async () => ({
    data: screenshots[screenshotIndex++]!.toString("base64"),
    mimeType: "image/png" as const,
  }));
  const requests: Record<string, unknown>[] = [];
  const result = await runGeminiCuaSession({
    prompt: "p",
    model: "gemini-3.8-flash",
    logger: { log() {}, warn() {}, error() {} },
    maxTurns: 2,
    client: {
      generateContent: async (request) => {
        requests.push(request);
        return ++turn === 1
          ? {
              candidates: [
                {
                  content: {
                    parts: [
                      { functionCall: { id: "first", name: "click_at", args: {} } },
                      { functionCall: { id: "second", name: "navigate", args: {} } },
                    ],
                  },
                },
              ],
            }
          : { candidates: [{ content: { parts: [{ text: "done" }] } }] };
      },
    },
    tools: { execute: async (name) => ({ text: name, isError: name === "click_at" }) },
    facade: { run: async () => "https://fixture.test/visible", screenshot },
  });
  expect(screenshot).toHaveBeenCalledTimes(2);
  const recorded = result.events.filter((event) => event.type === "tool_result");
  expect(recorded.map((event) => event.id)).toEqual(["first", "second"]);
  const responses = (
    requests[1]!.contents as Array<{
      role: string;
      parts: Array<{
        functionResponse?: {
          id: string;
          response: unknown;
          parts: Array<{ inlineData: { data: string; mimeType: string } }>;
        };
      }>;
    }>
  ).find((entry) => entry.role === "user" && entry.parts[0]?.functionResponse)?.parts;
  for (let index = 0; index < 2; index++) {
    expect(recorded[index]?.response).toEqual(responses?.[index]?.functionResponse?.response);
    expect(recorded[index]?.image).toEqual(
      responses?.[index]?.functionResponse?.parts[0]?.inlineData,
    );
  }
  const trajectory = geminiCuaAdapter.fromHarnessResult(
    { events: result.events },
    { id: "images", instruction: "act" },
  );
  for (let index = 0; index < 2; index++)
    expect(trajectory.steps[index]?.agentEvidence.modalities).toContainEqual({
      type: "image",
      bytes: screenshots[index],
      mediaType: "image/png",
    });
  expect(trajectory.steps[0]?.toolOutput).toMatchObject({
    ok: false,
    result: { error: "click_at", url: "https://fixture.test/visible" },
  });
  expect(buildGeminiCuaTranscript(result.events)).toContain("https://fixture.test/visible");
  expect(buildGeminiCuaTranscript(result.events)).toContain("[image: image/png]");
});

it("keeps an explicitly empty answer and marks an unmatched call failed", () => {
  const trajectory = geminiCuaAdapter.fromHarnessResult(
    {
      finalAnswer: "",
      status: "error",
      events: [
        {
          type: "assistant",
          turn: 1,
          text: "I will finish now",
          parts: [],
          usage: { input: 0, output: 0, reasoning: 0, cached_input: 0, total: 0 },
        },
        { type: "tool_use", turn: 1, id: "unfinished", name: "click", input: {} },
      ],
    },
    { id: "incomplete", instruction: "act" },
  );
  expect(trajectory.finalAnswer).toBe("");
  expect(trajectory.steps[0]?.toolOutput).toMatchObject({ ok: false });
});

it("uses the last recorded tool screenshot without losing final metadata or replacing a final capture", () => {
  const shot = Buffer.from("last screenshot");
  const events: GeminiCuaSessionEvent[] = [
    { type: "tool_use", turn: 1, id: "one", name: "click", input: {} },
    {
      type: "tool_result",
      turn: 1,
      id: "one",
      name: "click",
      text: "ok",
      error: false,
      image: { data: shot.toString("base64"), mimeType: "image/png" },
    },
  ];
  const result = {
    events,
    finalObservation: { url: "https://fixture.test", ariaTree: "button Done" },
  };
  const fallback = geminiCuaAdapter.fromHarnessResult(result, {
    id: "last-image",
    instruction: "act",
  });
  expect(fallback.finalObservation).toMatchObject({ ...result.finalObservation, screenshot: shot });
  const final = Buffer.from("terminal capture");
  const captured = geminiCuaAdapter.fromHarnessResult(
    { ...result, finalObservation: { ...result.finalObservation, screenshot: final } },
    { id: "final", instruction: "act" },
  );
  expect(captured.finalObservation?.screenshot).toEqual(final);
});
