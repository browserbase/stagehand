import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProgressRenderer, rowDisplayName } from "../../tui/progress.js";
import type { ConcurrencyQueueSnapshot } from "../../framework/providerConcurrency.js";

function stripAnsi(value: string): string {
  return value.replace(/\[[0-9;?]*[A-Za-z]/g, "");
}

const snapshot = (overrides: Partial<ConcurrencyQueueSnapshot> = {}): ConcurrencyQueueSnapshot => ({
  running: 6,
  queued: 41,
  total: 92,
  throttled: 0,
  semaphores: {
    anthropic: { active: 4, width: 4, baseWidth: 4, waiting: 2 },
    openai: { active: 2, width: 6, baseWidth: 6, waiting: 0 },
  },
  ...overrides,
});

describe("ProgressRenderer queue line", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let written: string[];

  beforeEach(() => {
    written = [];
    stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      written.push(stripAnsi(String(chunk)));
      return true;
    });
  });
  afterEach(() => {
    stdout.mockRestore();
  });

  const output = () => written.join("");

  it("streamed mode prints the line once per 30 s window", () => {
    let now = 0;
    const renderer = new ProgressRenderer({ animated: false, now: () => now });
    renderer.onQueue(snapshot());
    renderer.onQueue(snapshot({ running: 5 }));
    now = 29_999;
    renderer.onQueue(snapshot({ running: 4 }));
    expect(output()).toBe("  running 6 · queued 41 · anthropic 4/4 · openai 2/6\n");

    now = 30_000;
    renderer.onQueue(snapshot({ running: 3, throttled: 1 }));
    expect(output()).toContain("running 3 · queued 41 · anthropic 4/4 · openai 2/6 · throttled 1");
  });

  it("streamed mode always announces a throttle", () => {
    const renderer = new ProgressRenderer({ animated: false });
    renderer.onThrottled("9ab0c1d2 united.com", {
      source: "provider",
      semaphore: "openai",
      reason: "429",
      widthBefore: 6,
      widthAfter: 3,
    });
    renderer.onThrottled("9ab0c1d2 united.com", {
      source: "provider",
      semaphore: "openai",
      reason: "429",
      widthBefore: 3,
      widthAfter: 3,
      extended: true,
    });
    renderer.onThrottled("1f0e33d9 heb.com", { source: "browserbase", reason: "429" });
    expect(output()).toBe(
      [
        "  ↓ 9ab0c1d2 united.com: openai throttled — width 6 → 3 for 60s, retrying",
        "  ↓ 9ab0c1d2 united.com: openai still throttled — window extended 60s, retrying",
        "  ↓ 1f0e33d9 heb.com: Browserbase session create rate-limited — retrying once in 20s",
        "",
      ].join("\n"),
    );
  });

  it("animated mode ignores queue updates before the first row is drawn", () => {
    const renderer = new ProgressRenderer({ animated: true });
    renderer.onQueue(snapshot());
    expect(output()).toBe("");
    renderer.dispose();
  });
});

describe("ProgressRenderer board", () => {
  let written: string[];
  let raw: string[];
  let stdout: ReturnType<typeof vi.spyOn>;
  const savedColumns = process.stdout.columns;
  beforeEach(() => {
    written = [];
    raw = [];
    process.stdout.columns = 140;
    stdout = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
      raw.push(String(chunk));
      written.push(stripAnsi(String(chunk)));
      return true;
    });
  });
  afterEach(() => {
    stdout.mockRestore();
    process.stdout.columns = savedColumns;
  });

  const MODEL = "openai/gpt-5.4-mini";
  const suiteRow = (id: string, web: string, trial = 0, model = MODEL) => ({
    rowKey: `agent/hardbenchmark|${model}||${id}|${trial}`,
    taskName: "agent/hardbenchmark",
    model,
    case: { id, shortId: id.slice(0, 8), domain: web, question: `Do the thing on ${web}` },
    trial,
  });
  const CASES = [
    ["47e314cc452c540524ffb7cf520285a3", "recreation.gov"],
    ["9b2c07aa11112222333344445555aaaa", "imgur.com"],
    ["e81f4c0d66667777888899990000bbbb", "amazon.com"],
    ["1f0e33d9aaaabbbbccccddddeeeeffff", "heb.com"],
    ["6d2a9b710000111122223333444455ab", "allrecipes.com"],
    ["c40e1f88ffffeeeeddddccccbbbbaaaa", "wolframalpha.com"],
  ] as const;

  function board(renderer: ProgressRenderer): string[] {
    return renderer.boardLines().map(stripAnsi);
  }

  it("keeps one row per in-flight suite case even though they share a task name", () => {
    let now = 0;
    const renderer = new ProgressRenderer({ animated: true, now: () => now });
    renderer.onPlanned(46);
    for (const [id, web] of CASES) renderer.onStart(suiteRow(id, web));
    now = 184_000;
    renderer.onPass(suiteRow(...CASES[0]), 184_000);
    renderer.onFail(suiteRow(...CASES[1]), {
      outcome: "max_turns",
      durationMs: 184_000,
      sessionUrl: "https://www.browserbase.com/sessions/77d2e0b4",
    });

    const lines = board(renderer);
    const running = lines.filter((line) => /^ {2}[⣾⣽⣻⢿⡿⣟⣯⣷] /.test(line));
    expect(running).toHaveLength(4);
    expect(running.map((line) => line.split(/\s+/)[3])).toEqual([
      "amazon.com",
      "heb.com",
      "allrecipes.com",
      "wolframalpha.com",
    ]);
    expect(lines.join("\n")).not.toContain("agent/hardbenchmark");
    expect(lines).toContainEqual(expect.stringMatching(/✓ 47e314cc recreation\.gov\s+3m04s$/));
    expect(lines).toContainEqual(
      expect.stringMatching(
        /⏱ 9b2c07aa imgur\.com\s+max_turns\s+3m04s · https:\/\/www\.browserbase\.com\/sessions\/77d2e0b4/,
      ),
    );
    renderer.dispose();
  });

  it("shows phase, question and elapsed per running row, and flags rows past the p75", () => {
    let now = 0;
    const renderer = new ProgressRenderer({ animated: true, now: () => now });
    renderer.onPlanned(10);
    const slow = suiteRow("aaaaaaaa00000000aaaaaaaa00000000", "slow.com");
    renderer.onStart(slow);
    renderer.onPhase(slow, "agent");
    // Four quick finishes set a p75 of ~40s.
    for (let i = 0; i < 4; i++) {
      const row = suiteRow(`${i}bbbbbbb00000000bbbbbbbb0000000${i}`, `q${i}.com`);
      renderer.onStart(row);
      renderer.onPass(row, 40_000);
    }
    const fresh = suiteRow("cccccccc00000000cccccccc00000000", "fresh.com");
    now = 400_000;
    renderer.onStart(fresh);
    renderer.onPhase(fresh, "verify");
    now = 410_000;

    const raw = renderer.boardLines();
    const slowLine = raw.find((line) => stripAnsi(line).includes("slow.com"))!;
    const freshLine = raw.find((line) => stripAnsi(line).includes("fresh.com"))!;
    expect(stripAnsi(slowLine)).toMatch(
      /aaaaaaaa slow\.com\s+Do the thing on slow\.com\s+agent\s+6m50s$/,
    );
    expect(stripAnsi(freshLine)).toMatch(/fresh\.com\s+Do the thing on fresh\.com\s+verify\s+10s$/);
    // 6m50s is past the p75 (40s): rendered in yellow; the fresh row isn't.
    expect(slowLine).toContain("\x1b[33m6m50s");
    expect(freshLine).not.toContain("\x1b[33m");
    renderer.dispose();
  });

  it("gives each trial of the same case its own row", () => {
    const renderer = new ProgressRenderer({ animated: true, now: () => 0 });
    for (const trial of [0, 1, 2]) renderer.onStart(suiteRow(CASES[0][0], CASES[0][1], trial));
    const text = board(renderer).join("\n");
    expect(text).toContain("47e314cc recreation.gov #2");
    expect(text).toContain("47e314cc recreation.gov #3");
    renderer.dispose();
  });

  it("adds a model column only when the run spans more than one model", () => {
    const renderer = new ProgressRenderer({ animated: true, now: () => 0 });
    renderer.onStart(suiteRow(CASES[0][0], CASES[0][1]));
    expect(board(renderer).join("\n")).not.toContain("gpt-5.4-mini");
    renderer.onStart(suiteRow(CASES[1][0], CASES[1][1], 0, "anthropic/claude-sonnet-4-6"));
    const text = board(renderer).join("\n");
    expect(text).toContain("47e314cc recreation.gov gpt-5.4-mini");
    expect(text).toContain("9b2c07aa imgur.com claude-sonnet-4-6");
    renderer.dispose();
  });

  it("status bar counts, eta, queue line, stopping notice and key hints", () => {
    let now = 0;
    const renderer = new ProgressRenderer({ animated: true, now: () => now });
    renderer.onPlanned(10);
    for (let i = 0; i < 4; i++) {
      const row = suiteRow(`${i}0000000aaaaaaaabbbbbbbbcccccccc`, `s${i}.com`);
      renderer.onStart(row);
      now += 60_000;
      if (i < 2) renderer.onPass(row, 60_000);
      else if (i === 2)
        renderer.onFail(row, { outcome: "fail", error: "wrong answer", durationMs: 60_000 });
      else renderer.onFail(row, { outcome: "max_turns" });
    }
    renderer.onQueue({ running: 0, queued: 6, total: 10, throttled: 0, semaphores: {} });
    renderer.setKeyHints("esc stop");
    renderer.setStopping("cooperative");
    const lines = board(renderer);
    // 4 done in 4 min → 6 left at ~1 min each.
    expect(lines[0]).toMatch(/4\/10\s+✓ 2\s+✗ 1\s+⏱ 1\s+4m00s · eta ~6m$/);
    expect(lines[1]).toContain("running 0 · queued 6");
    expect(lines[2]).toContain("⚠ stopping after in-flight rows · esc again to stop now");
    expect(lines.at(-1)).toBe("  esc stop");
    expect(lines.join("\n")).toMatch(/s2\.com\s+failed\s+1m00s · wrong answer/);
    expect(lines.join("\n")).toContain("… 1 more finished");
    // No duration: the tail starts with the next part, not a stray separator.
    expect(lines.join("\n")).toMatch(/⏱ 30000000 s3\.com\s+max_turns\s*$/m);
    renderer.setStopping("aggressive");
    expect(board(renderer)[2]).toContain("✗ stopping now — closing in-flight sessions");
    renderer.dispose();
  });

  it("printSummary leaves the final board without live-only lines", () => {
    const renderer = new ProgressRenderer({ animated: true, now: () => 0 });
    const row = suiteRow(...CASES[0]);
    renderer.onStart(row);
    renderer.onQueue({ running: 1, queued: 0, total: 1, throttled: 0, semaphores: {} });
    renderer.setKeyHints("esc stop");
    renderer.onPass(row, 1000);
    written.length = 0;
    renderer.printSummary();
    const text = written.join("");
    expect(text).toContain("47e314cc recreation.gov");
    expect(text).toContain("Results: 1 passed, 0 failed (1 total)");
    expect(text).not.toContain("esc stop");
    expect(text).not.toContain("queued 0");
  });

  it("shows the error of a failed row that has no outcome (aborted before it ran)", () => {
    const renderer = new ProgressRenderer({ animated: true, now: () => 0 });
    renderer.onPlanned(2);
    renderer.onStart(suiteRow(...CASES[0]));
    renderer.onFail(suiteRow(...CASES[1]), { error: "aborted" });
    expect(board(renderer)).toContainEqual(
      expect.stringMatching(/✗ 9b2c07aa imgur\.com .*aborted/),
    );
    renderer.dispose();
  });

  it("sizes the board to the stream it draws on, not stdout", () => {
    const stderrLike = Object.assign(Object.create(process.stdout), {
      columns: 72,
      write: () => true,
    }) as NodeJS.WriteStream;
    const renderer = new ProgressRenderer({ animated: true, stream: stderrLike, now: () => 0 });
    renderer.onPlanned(6);
    for (const [id, web] of CASES) renderer.onStart(suiteRow(id, web));
    // stdout says 140 columns; the board's own stream says 72.
    for (const line of board(renderer)) expect(line.length).toBeLessThanOrEqual(72);
    renderer.dispose();
  });

  it("logLine scrolls a line above the board and redraws the board under it", () => {
    const renderer = new ProgressRenderer({ animated: true, now: () => 0 });
    renderer.onStart(suiteRow(...CASES[0]));
    written.length = 0;
    renderer.logLine("14:02:11 47e314cc codex  tool browser_navigate");
    const text = written.join("");
    const logAt = text.indexOf("tool browser_navigate");
    const boardAt = text.indexOf("47e314cc recreation.gov");
    expect(logAt).toBeGreaterThanOrEqual(0);
    expect(boardAt).toBeGreaterThan(logAt);
    renderer.dispose();
  });

  it("streams one attributed line per event when not animated, with no cursor movement", () => {
    const renderer = new ProgressRenderer({ animated: false });
    const row = suiteRow(...CASES[0]);
    renderer.onStart(row);
    renderer.onPhase(row, "agent");
    renderer.onFail(row, { outcome: "sdk_error", durationMs: 1500, error: "stream closed" });
    const text = written.join("");
    expect(text).toMatch(/● 47e314cc recreation\.gov .* running/);
    expect(text).toMatch(/✗ 47e314cc recreation\.gov .* sdk_error 1\.5s/);
    expect(text).toContain("→ stream closed");
    expect(raw.join("")).not.toMatch(/\x1b\[\d*[AJ]/);
  });

  it("animated mode does move the cursor (positive control for the check above)", () => {
    const renderer = new ProgressRenderer({ animated: true, now: () => 0 });
    renderer.onStart(suiteRow(...CASES[0]));
    renderer.onStart(suiteRow(...CASES[1]));
    expect(raw.join("")).toMatch(/\x1b\[\d*A/);
    renderer.dispose();
  });
});

describe("rowDisplayName", () => {
  it("falls back to the task name for plain tasks and numbers later trials", () => {
    expect(rowDisplayName({ taskName: "act/dropdown" })).toBe("act/dropdown");
    expect(rowDisplayName({ taskName: "act/dropdown", trial: 2 })).toBe("act/dropdown #3");
    expect(
      rowDisplayName({
        taskName: "agent/webvoyager",
        case: { shortId: "Allrecipes--3", domain: "allrecipes.com" },
      }),
    ).toBe("Allrecipes--3 allrecipes.com");
  });
});
