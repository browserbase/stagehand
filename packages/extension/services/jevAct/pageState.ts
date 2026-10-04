import { ask, round, type AskContext } from "./pick.js";
import { pageDigest, type OutlineNode } from "./tree.js";
import { noulAnswer } from "./typesafeClient.js";

/**
 * Page-state signals from one Jev request over a compact page digest. Used to
 * explain why a target could not be found (the page is a bot wall, not a
 * decision-tree miss) and to stop paying for an LLM fallback that cannot help.
 */
export const PAGE_STATE_SIGNALS = {
  access_denied:
    "The page is an access-denied, forbidden, or 'you have been blocked' page instead of the site's real content",
  captcha: "The page is a CAPTCHA, 'verify you are human', or bot-check interstitial",
  login_wall:
    "The page's main content is a sign-in or registration wall that must be passed to continue",
  cookie_banner: "A cookie-consent or privacy-choices banner or dialog is present on the page",
  error_page:
    "The page is an error page such as 404 not found, 500 server error, or 'something went wrong'",
  empty_or_loading: "The page is essentially empty or still showing only a loading indicator",
} as const;

export type PageSignal = keyof typeof PAGE_STATE_SIGNALS;
export type PageState = Record<PageSignal, number>;

/** A target can never be found on these, whoever looks for it. */
const BLOCKING: PageSignal[] = ["access_denied", "captcha"];
const BLOCKING_THRESHOLD = 0.9;

export async function readPageState(
  ctx: AskContext,
  nodes: OutlineNode[],
  url: string,
): Promise<PageState> {
  const response = await ask(
    ctx,
    "page_state",
    { url, ...pageDigest(nodes) },
    Object.fromEntries(
      Object.entries(PAGE_STATE_SIGNALS).map(([key, instructions]) => [
        key,
        { type: "noul" as const, instructions },
      ]),
    ),
  );
  const state = Object.fromEntries(
    (Object.keys(PAGE_STATE_SIGNALS) as PageSignal[]).map((key) => [
      key,
      round(noulAnswer(response, key).noul),
    ]),
  ) as PageState;
  ctx.trace[ctx.trace.length - 1]!.state = state;
  return state;
}

export function blockingSignal(state: PageState): PageSignal | undefined {
  return BLOCKING.find((signal) => state[signal] >= BLOCKING_THRESHOLD);
}
