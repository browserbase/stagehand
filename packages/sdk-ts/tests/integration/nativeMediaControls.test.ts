import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { LLMGenerateParams } from "@browserbasehq/stagehand-protocol/types";
import type { ClientLLM, Stagehand } from "../../src/index.js";
import {
  closeStagehand,
  createStagehand,
  firstPage,
  startFixtureServer,
  type FixtureServer,
} from "./_support.js";

/** One second of 8 kHz, 8-bit mono silence as a WAV data URL. */
function silentWav(): string {
  const samples = 8000;
  const wav = Buffer.alloc(44 + samples, 0x80);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + samples, 4);
  wav.write("WAVEfmt ", 8, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(8000, 24);
  wav.writeUInt32LE(8000, 28);
  wav.writeUInt16LE(1, 32);
  wav.writeUInt16LE(8, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(samples, 40);
  return `data:audio/wav;base64,${wav.toString("base64")}`;
}

describe("page.snapshot() with native media elements", () => {
  let fixture: FixtureServer;
  let stagehand: Stagehand;

  beforeAll(async () => {
    fixture = await startFixtureServer(
      `<!doctype html><body>
        <button id="start">Start</button>
        <video controls aria-label="Intro" width="320" height="180" src="${silentWav()}"></video>
        <audio controls muted loop src="${silentWav()}"></audio>
      </body>`,
    );
    stagehand = await createStagehand();
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
    await fixture.close();
  });

  it("shows whether each media element is playing and muted", async () => {
    const page = await firstPage(stagehand);
    await page.goto(fixture.url);

    const { formattedTree: before } = await page.snapshot();
    expect(before).toMatch(/\] Video: Intro \[paused\]$/m);
    expect(before).toMatch(/\] Audio \[paused\] \[muted\]$/m);

    // A real click gives the page the user activation that play() requires.
    await page.locator("#start").click();
    await page.evaluate(() => document.querySelector("audio")!.play());

    const { formattedTree: after } = await page.snapshot();
    expect(after).toMatch(/\] Audio \[playing\] \[muted\]$/m);
  });
});

function promptText(params: LLMGenerateParams): string {
  return params.messages
    .flatMap((message) => (Array.isArray(message.content) ? message.content : [message.content]))
    .filter((content) => content.type === "text")
    .map((content) => content.text)
    .join("\n");
}

describe("act() on a native media control", () => {
  let fixture: FixtureServer;
  let stagehand: Stagehand | undefined;

  beforeAll(async () => {
    fixture = await startFixtureServer(
      `<!doctype html><body><audio controls src="${silentWav()}"></audio></body>`,
    );
  });

  afterAll(async () => {
    await closeStagehand(stagehand);
    await fixture.close();
  });

  it("clicks the control itself, not the middle of its media element", async () => {
    let muteId: string | undefined;
    const model: ClientLLM = {
      generate: async (params) => {
        muteId = /\[(\d+-\d+)\] button: mute$/m.exec(promptText(params))?.[1];
        return {
          role: "assistant",
          content: { type: "text", text: "structured action" },
          outputFormat: "json_schema",
          structuredContent: {
            action: muteId
              ? { elementId: muteId, description: "Mute button", method: "click", arguments: [] }
              : null,
            twoStep: false,
          },
        };
      },
    };
    stagehand = await createStagehand({ model });
    const page = await firstPage(stagehand);
    await page.goto(fixture.url);

    const acted = await stagehand.act("Mute the audio");

    expect(muteId).toMatch(/^0-\d+$/);
    expect(acted.data.success).toBe(true);
    // A click at the middle of the <audio> would seek its timeline instead.
    expect(
      await page.evaluate(() => {
        const audio = document.querySelector("audio")!;
        return { muted: audio.muted, paused: audio.paused, time: audio.currentTime };
      }),
    ).toEqual({ muted: true, paused: true, time: 0 });
  });
});
