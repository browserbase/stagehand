import type { ShowcaseTask } from "../_harness/task.ts";
import type { schema } from "./workflow.ts";

export const task: ShowcaseTask<typeof schema> = {
  startUrl: "https://www.nytimes.com/games/wordle/index.html",
  goal: "Play today's Wordle at nytimes.com/games/wordle and solve it in six guesses or fewer. Report whether you solved it, the answer (null if not solved), and each guess in order with its tile feedback as five emoji (🟩 correct, 🟨 present, ⬛ absent).",
  check: ({ solved, answer, guesses }) =>
    solved && answer !== null && guesses.length >= 1 && guesses.length <= 6,
};
