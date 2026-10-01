import type { Page, Stagehand } from "@browserbasehq/stagehand";
import { z } from "zod/v4";

// Every word Wordle accepts as a guess, from github.com/tabatkins/wordle-list.
const WORDS_URL = "https://raw.githubusercontent.com/tabatkins/wordle-list/main/words";
const MAX_GUESSES = 6;

type TileState = "correct" | "present" | "absent";

const row = z.object({
  tiles: z.array(
    z.object({
      letter: z.string(),
      state: z.enum(["correct", "present", "absent", "empty"]),
    }),
  ),
});

export const schema = z.object({
  solved: z.boolean(),
  answer: z.string().nullable(),
  guesses: z.array(z.object({ word: z.string(), feedback: z.string() })),
});

// The feedback Wordle would show for `guess` if the answer were `answer`,
// including its duplicate-letter rules.
function feedback(guess: string, answer: string): TileState[] {
  const result: TileState[] = Array(5).fill("absent");
  const unmatched: string[] = [];
  for (let i = 0; i < 5; i++) {
    if (guess[i] === answer[i]) result[i] = "correct";
    else unmatched.push(answer[i]!);
  }
  for (let i = 0; i < 5; i++) {
    if (result[i] === "correct") continue;
    const at = unmatched.indexOf(guess[i]!);
    if (at !== -1) {
      result[i] = "present";
      unmatched.splice(at, 1);
    }
  }
  return result;
}

// Favour words whose distinct letters are common among the remaining candidates.
function bestGuess(candidates: string[]): string {
  const counts = new Map<string, number>();
  for (const word of candidates) {
    for (const letter of new Set(word)) counts.set(letter, (counts.get(letter) ?? 0) + 1);
  }
  const score = (word: string) =>
    [...new Set(word)].reduce((sum, letter) => sum + (counts.get(letter) ?? 0), 0);
  return candidates.reduce((best, word) => (score(word) > score(best) ? word : best));
}

const emoji = { correct: "🟩", present: "🟨", absent: "⬛" } as const;

export async function run(stagehand: Stagehand, page: Page): Promise<z.output<typeof schema>> {
  let candidates = (await (await fetch(WORDS_URL)).text())
    .split("\n")
    .map((word) => word.trim().toLowerCase())
    .filter((word) => /^[a-z]{5}$/.test(word));

  await page.goto("https://www.nytimes.com/games/wordle/index.html");
  await stagehand.act("Click the Play button", { page });
  // Dismiss the how-to-play dialog that opens on a first visit.
  await page.keyPress("Escape");

  const guesses: z.output<typeof schema>["guesses"] = [];
  while (guesses.length < MAX_GUESSES && candidates.length > 0) {
    const guess = bestGuess(candidates);
    await page.type(guess);
    await page.keyPress("Enter");
    // Tiles flip one after another before the row settles.
    await page.waitForTimeout(2_500);

    const { data } = await stagehand.extract(
      `The letter and state of each tile in row ${guesses.length + 1} of the game board`,
      row,
      { page },
    );
    const states = data.tiles.map((tile) => tile.state);
    if (states.length !== 5 || states.includes("empty")) {
      // Not in Wordle's word list: clear the row and try the next candidate.
      for (let i = 0; i < 5; i++) await page.keyPress("Backspace");
      candidates = candidates.filter((word) => word !== guess);
      continue;
    }

    const observed = states as TileState[];
    guesses.push({ word: guess, feedback: observed.map((state) => emoji[state]).join("") });
    if (observed.every((state) => state === "correct")) {
      return { solved: true, answer: guess, guesses };
    }
    const key = observed.join();
    candidates = candidates.filter(
      (word) => word !== guess && feedback(guess, word).join() === key,
    );
  }
  return { solved: false, answer: null, guesses };
}
