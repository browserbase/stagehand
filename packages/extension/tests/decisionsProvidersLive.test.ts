import { describe, expect, it } from "vitest";
import {
  decide,
  type DecisionChoiceAnswer,
  type DecisionModelConfig,
  type DecisionNoulAnswer,
  type DecisionQuestion,
} from "../services/decisions/client.js";

/**
 * Live conformance: the same questions against every provider a key exists
 * for. Never runs in CI; opt in with DECISIONS_LIVE=1 and any of
 *   TYPESAFE_API_KEY
 *   CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID
 *   PERPLEXITY_API_KEY
 *   OPENAI_API_KEY   (needs Decisions preview access)
 * The questions are unambiguous on purpose: this checks that a provider is
 * wired correctly and answers in a usable shape, not how good its model is.
 */
const env = process.env;
const LIVE = env.DECISIONS_LIVE === "1";

const PROVIDERS: Array<{ name: string; config: DecisionModelConfig | undefined }> = [
  { name: "typesafe", config: env.TYPESAFE_API_KEY ? { apiKey: env.TYPESAFE_API_KEY } : undefined },
  {
    name: "cloudflare",
    config:
      env.CLOUDFLARE_API_TOKEN && env.CLOUDFLARE_ACCOUNT_ID
        ? {
            provider: "cloudflare",
            apiKey: env.CLOUDFLARE_API_TOKEN,
            accountId: env.CLOUDFLARE_ACCOUNT_ID,
            ...(env.DECISIONS_CLOUDFLARE_MODEL ? { model: env.DECISIONS_CLOUDFLARE_MODEL } : {}),
          }
        : undefined,
  },
  {
    name: "perplexity",
    config: env.PERPLEXITY_API_KEY
      ? { provider: "perplexity", apiKey: env.PERPLEXITY_API_KEY }
      : undefined,
  },
  {
    name: "openai",
    config: env.OPENAI_API_KEY ? { provider: "openai", apiKey: env.OPENAI_API_KEY } : undefined,
  },
];

const STATE = {
  instruction: "click the Checkout button",
  page: "Shop — cart with 2 items. Buttons: Add to cart, Checkout. Link: Help.",
};

const QUESTIONS: Record<string, DecisionQuestion> = {
  family: {
    type: "choice",
    instructions: "Which kind of browser action does the instruction ask for?",
    criteria: {
      click: "Clicking or pressing an element with the pointer",
      fill: "Typing text into a field",
      scroll: "Scrolling the page",
    },
  },
  // A key and option ids outside every strict provider's alphabet, and JSON
  // instructions and descriptions: the client has to make these acceptable.
  "target:pointer/0": {
    type: "choice",
    instructions: { task: "Which element should receive the click?", request: STATE.instruction },
    criteria: {
      "0-5 / a": { role: "button", name: "Add to cart" },
      "0-7 / b": { role: "button", name: "Checkout" },
      "0-9 / c": { role: "link", name: "Help" },
      none_match: "None of these elements is what the instruction refers to",
    },
  },
  is_click: {
    type: "noul",
    instructions: "Does the instruction ask to click something?",
    criteria: { true: "It asks for a click", false: "It asks for something else" },
  },
  mentions_refund: { type: "noul", instructions: "Does the instruction mention a refund?" },
};

describe.skipIf(!LIVE)("live decision providers", () => {
  for (const { name, config } of PROVIDERS) {
    it.skipIf(!config)(
      `${name} answers the canonical questions`,
      async (ctx) => {
        let response;
        try {
          response = await decide(config!, STATE, QUESTIONS);
        } catch (error) {
          // A key without access to a gated preview is a skip, not a failure of the adapter.
          if (error instanceof Error && /decisions_not_enabled/.test(error.message)) {
            ctx.skip(`${name}: ${error.message}`);
            return;
          }
          throw error;
        }
        const family = response.answers.family as DecisionChoiceAnswer;
        const target = response.answers["target:pointer/0"] as DecisionChoiceAnswer;
        const isClick = response.answers.is_click as DecisionNoulAnswer;
        const refund = response.answers.mentions_refund as DecisionNoulAnswer;
        // eslint-disable-next-line no-console -- the point of a live run is to see the numbers
        console.info(
          `[${name}] model=${response.model} ${response.durationMs} ms in=${response.usage.inputTokens} ` +
            `family=${family.choice}@${family.confidence.toFixed(2)} target=${target.choice}@${target.confidence.toFixed(2)} ` +
            `is_click=${isClick.noul.toFixed(2)} refund=${refund.noul.toFixed(2)}`,
        );
        expect(family.choice).toBe("click");
        expect(family.confidence).toBeGreaterThan(0.5);
        expect(target.choice).toBe("0-7 / b");
        expect(
          Object.keys(target.probabilities).every(
            (id) => id in QUESTIONS["target:pointer/0"]!.criteria!,
          ),
        ).toBe(true);
        expect(isClick.noul).toBeGreaterThan(0.5);
        expect(refund.noul).toBeLessThan(0.5);
        expect(response.usage.inputTokens).toBeGreaterThan(0);
      },
      30_000,
    );
  }
});
