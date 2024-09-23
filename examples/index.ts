#!/usr/bin/env -S pnpm tsx
import { Stagehand } from "../lib";
import { z } from "zod";

async function example() {
  const stagehand = new Stagehand({
    env: "LOCAL",
    verbose: 1,
    debugDom: true,
  });
  
  await stagehand.init({ modelName: "claude-3-5-sonnet-20240620" }); // optionally specify model_name, defaults to "gpt-4o" (as of sept 18, 2024, we need to specify the model name with date, changing on 10/2/2024)
  await stagehand.page.goto("https://www.nytimes.com/games/wordle/index.html");
  await stagehand.act({ action: "start the game" }); 
  await stagehand.act({ action: "close tutorial popup" });

  let guesses: { guess: string | null; description: string | null }[] = [];
  for (let i = 0; i < 6; i++) {
    const prompt = `I'm trying to win Wordle. Here are my guesses so far.\nPREVIOUS GUESSES:\n${guesses.map((g, index) => `${index}. ${g.guess}. ${g.description}`).join("\n")}\nWhat five letter english word should I guess given the previous guesses? Do not repeat any previous guesses! Return only the new 5 letter word guess you're making.`;
    const response = await stagehand.ask(prompt, "claude-3-5-sonnet-20240620"); // you can specify modelName for each action if you want, otherwise it uses the default modelName from init
    if (!response) {
      throw new Error("no response when asking for a guess");
    }

    await stagehand.page.locator("body").pressSequentially(response);
    await stagehand.page.keyboard.press("Enter");

    const guess = await stagehand.extract({
      instruction: "extract the five letter guess at the bottom",
      schema: z.object({
        guess: z.string().describe("the raw guess").nullable(),
        description: z
          .string()
          .describe("what letters are correct and in the right place, and what letters are correct but in the wrong place, and what letters are incorrect")
          .nullable()
      }),
      modelName: "claude-3-5-sonnet-20240620"
    });

    guesses.push({ guess: guess.guess, description: guess.description });
    stagehand.log({ category: "guesses", message: guesses, level: 1 });

    const correct = await stagehand.ask("Based on this description of the guess, is the guess correct? Every letter must be correct and in the right place. Only output TRUE or FALSE.\nGuess description: " + guess.description, 
      "gpt-4o");
    
    stagehand.log({ category: "correct", message: correct });
    if (correct.trimStart().split(" ").pop() === "TRUE") {
      stagehand.log({ category: "won", message: "I won Wordle!", level: 1 });
      return;
    }
  }
}

(async () => {
  await example();
})();
