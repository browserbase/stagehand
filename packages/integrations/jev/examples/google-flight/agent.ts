/**
 * A browser agent whose only input is a goal.
 *
 * Stagehand v4 ships no agent harness, so this is the harness: each turn it
 * lists what is on the page, asks Jev what to do about it, and does that. The
 * division of labour is the point of the demo —
 *
 *   observe()  Stagehand, no instruction: every interactive element, no model
 *   decide     Jev: one or two typed questions, ~100-300ms each, never an LLM
 *   act()      Stagehand, given the observed Action: deterministic replay
 *
 * Nothing here knows anything about the site it is driving. The only page
 * knowledge in the loop is that a field gets filled and a button gets clicked,
 * which observe() already decided from each element's role.
 */
import type { Action, Page, Stagehand } from "@browserbasehq/stagehand";
import { choiceAnswer, type JevConfig, noulAnswer, systemOne } from "./jev.ts";
import { fillCandidates } from "./goal.ts";

const NONE = "none";
/**
 * Above this many candidates the choice is split into parallel shards. Kept
 * small on purpose: Jev reports confidence from the probability spread, so a
 * 100-way question answers correctly but too weakly to clear a threshold.
 */
const SHARD_SIZE = 30;
/** Probes spent waiting for an autocomplete to answer a fill. */
const CHOICE_PROBES = 4;
/** Probes allowed while the page is still changing, and repeats that mean quiet. */
const QUIET_PROBES = 8;
const QUIET_REPEATS = 2;
/** Candidate lists longer than this are cut down before Jev is asked. */
const PRUNE_ABOVE = 40;
const PRUNE_TO = 30;
/** Controls that carry a page setting the goal may disagree with. */
const SETTING_ROLES = /^(combobox|textbox|searchbox|checkbox|radio|spinbutton)\b/i;
/** Roles that hold choices rather than being one. */
const CONTAINER_ROLES = /^(listbox|list|group|menu|table|grid|region|form)\b/i;
/** Roles that mean the page is waiting for a pick. */
const CHOICE_ROLES = /^(option|menuitem|menuitemradio|menuitemcheckbox)\b/i;
/** Roles that make up a page's form surface, kept regardless of wording. */
const FORM_ROLES =
  /^(button|textbox|combobox|searchbox|spinbutton|checkbox|radio|option|listbox|slider)\b/i;
/** An element acted on this many times without finishing is a loop. */
const MAX_REPEATS = 2;
/** Turns a banned element stays out of the running before it is offered again. */
const BAN_TURNS = 4;
/**
 * Descriptions of what is on screen, shown to the done judge. 60 rather than
 * 30 because a results page opens with a screenful of chrome — menus, the
 * search form, sign-in — and the rows that prove the goal was reached start
 * well after it. Measured on the flights results page, the same judge scores
 * 0.14 on the first 30 descriptions and 0.96 on the first 60.
 */
const PAGE_SAMPLE = 60;
/** Each one trimmed, so a page of long labels cannot blow up the payload. */
const SAMPLE_CHARS = 160;
/** Entries of any one repeated shape allowed into that sample. */
const SAMPLE_PER_SHAPE = 3;
/** A repeated entry this long, this many times over, is a list of results. */
const RESULT_ROW_CHARS = 60;
const RESULT_ROW_COUNT = 5;
/** How much wider the family's vocabulary must be than one member's. */
const RESULT_ROW_VARIETY = 1.5;
/** Settings shown to the mismatch check each turn. */
const SETTINGS_SAMPLE = 12;
/** A page this much smaller than the last one is probably still rendering. */
const COLLAPSE_FLOOR = 0.15;
const COLLAPSE_RETRIES = 3;
/** Extra reads allowed while a freshly navigated page is still filling in. */
const GROWTH_READS = 3;
/** How much of the page has to change for the next read to be treated as fresh. */
const TRANSITION_SHARE = 0.3;
/** Consecutive turns with nothing worth doing before the run is given up. */
const IDLE_TURNS = 3;
/** Turns of history Jev is shown, so it does not repeat what it just did. */
const HISTORY_DEPTH = 8;

export type AgentOptions = {
  goal: string;
  /** Where the run began; completion requires having navigated away from it. */
  startUrl: string;
  jev: JevConfig;
  /** Minimum Jev confidence to act on a choice. */
  confidence?: number;
  /** Minimum "goal reached" score to stop. */
  doneAbove?: number;
  maxTurns?: number;
  /** How long to wait between reads while the page is still changing. */
  pollMs?: number;
  /** Candidates the goal rules out, e.g. booking controls. */
  avoid?: RegExp;
};

export type TurnRecord = {
  index: number;
  url: string;
  candidates: number;
  /** What the turn did, or why it stopped. */
  decision: string;
  value?: string;
  confidence?: number;
  doneScore?: number;
  observeMs: number;
  decideMs: number;
  actMs: number;
  jevRequests: number;
  jevTokens: number;
  jevMs: number;
};

export type AgentStatus = "done" | "abstained" | "stalled" | "max-turns" | "observe-failed";

export type AgentResult = {
  status: AgentStatus;
  turns: TurnRecord[];
  history: string[];
};

type Usage = { requests: number; tokens: number; ms: number };

function addUsage(
  into: Usage,
  from: { usage: { inputTokens: number; outputTokens: number }; durationMs: number },
): void {
  into.requests += 1;
  into.tokens += from.usage.inputTokens + from.usage.outputTokens;
  into.ms += from.durationMs;
}

/** Accent- and case-insensitive, so "Zurich" matches a field showing "Zürich". */
function loose(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .trim();
}

/**
 * The goal values not already sitting in a field.
 *
 * Offering one twice is what makes an agent type the origin into the
 * destination: the goal names Zurich, so Zurich stays the most salient thing
 * to type long after it has been entered. Dropping it once it is on the page
 * narrows the next fill to what is genuinely still outstanding, without
 * telling Jev which field to put it in.
 */
function unusedValues(goalValues: string[], present: Iterable<string>): string[] {
  const seen = [...present].map(loose).filter(Boolean);
  const unused = goalValues.filter((wanted) => {
    const needle = loose(wanted);
    return !seen.some((value) => value.includes(needle) || needle.includes(value));
  });
  return unused.length > 0 ? unused : goalValues;
}

/**
 * A URL flattened into something a goal value can be looked for in, query
 * strings decoded and any base64 blob among them unpacked. Sites pack search
 * state into one — Google Flights carries the whole itinerary in `tfs` — so
 * the committed date is in the URL long before any of it is on screen.
 */
export function urlHaystack(url: string): string {
  const parts = [safeDecode(url)];
  try {
    for (const [, value] of new URL(url).searchParams) {
      if (!/^[A-Za-z0-9_-]{8,}$/.test(value)) continue;
      try {
        const padded = value.replace(/-/g, "+").replace(/_/g, "/");
        parts.push(Buffer.from(padded, "base64").toString("latin1"));
      } catch {
        // Not base64 after all; the raw value is already in `parts`.
      }
    }
  } catch {
    // Not a parseable URL; the raw string still gets searched.
  }
  return loose(parts.join(" "));
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}

/**
 * Whether a page is showing a list of results rather than a form or a grid.
 *
 * Many long entries sharing a shape is the start of it, but a calendar is that
 * too — thirty day buttons, each a long string. What separates them is
 * vocabulary: results vary ("easyJet", "Gatwick", "Nonstop", "1 stop"), while
 * a date grid repeats one sentence with the numbers changed. So the family
 * also has to use far more distinct words than any single member does.
 */
export function showsResultRows(descriptions: string[]): boolean {
  const long = [...new Set(descriptions.map((text) => text.trim()))].filter(
    (text) => text.length >= RESULT_ROW_CHARS,
  );
  if (long.length < RESULT_ROW_COUNT) return false;

  const words = long.map(
    (text) =>
      new Set(
        loose(text)
          .split(/[^a-z]+/)
          .filter((word) => word.length > 2),
      ),
  );
  const union = new Set(words.flatMap((set) => [...set]));
  const average = words.reduce((total, set) => total + set.size, 0) / words.length;
  return average > 0 && union.size / average >= RESULT_ROW_VARIETY;
}

/**
 * Whether the browser has moved off the page the run started on. The reference
 * demo asserts the path is `/travel/flights/search`; this is that check without
 * the site in it. A form that rejects its own submission leaves you where you
 * were, with the query string updated and the results still unrendered — which
 * is exactly the state that otherwise reads as success.
 */
function navigatedAway(url: string, startUrl: string): boolean {
  try {
    const [now, start] = [new URL(url), new URL(startUrl)];
    return now.pathname !== start.pathname || now.host !== start.host;
  } catch {
    return url !== startUrl;
  }
}

/**
 * The reference demo's `verify()`, generalised: every goal value has to be
 * committed somewhere the page or its URL admits to, and the page has to be
 * listing results. Costs nothing, so it can be asked after every read rather
 * than once a turn — which is the difference between noticing a finished task
 * immediately and spending a turn to find out.
 */
function verifyGoal(
  goalValues: string[],
  url: string,
  startUrl: string,
  held: Iterable<string>,
  descriptions: string[],
): { committed: number; done: boolean } {
  // Three places a value can be committed, and a page uses whichever suits it:
  // the URL's packed state (the date, as `tfs`), a field still holding what was
  // typed, or the results themselves — a flight row names "Zurich Airport"
  // where the URL only ever says "ZRH".
  const haystack = `${urlHaystack(url)} ${loose(descriptions.join(" "))}`;
  const values = [...held].map(loose);
  const committed = goalValues.filter(
    (wanted) =>
      haystack.includes(loose(wanted)) ||
      values.some((value) => value.includes(loose(wanted)) || loose(wanted).includes(value)),
  ).length;
  return {
    committed,
    done:
      committed === goalValues.length &&
      navigatedAway(url, startUrl) &&
      showsResultRows(descriptions),
  };
}

/** A stable identity for an element, so a repeat can be recognised and banned. */
function identity(action: Action): string {
  return `${action.method ?? "click"}\u0000${action.description}`;
}

function describe(action: Action, value?: string): string {
  const method = action.method ?? "click";
  const head = method === "click" ? action.description : `${action.description} (${method})`;
  return value ? `${head} — currently "${value}"` : head;
}

/** Words from the goal worth matching a candidate against. */
function goalWords(goal: string): string[] {
  return [...new Set(goal.toLowerCase().match(/[a-z]{3,}/g) ?? [])];
}

/**
 * Cuts a long candidate list down to the ones that share wording with the goal.
 * Mirrors what the act pipeline does in `jevAct/pick.ts`, for the same reason:
 * Jev reports confidence from the probability spread, so asking over 100
 * candidates answers correctly but too weakly to act on. Measured on the flights
 * page, the same correct element comes back at 0.61 over the full list and 1.00
 * over the shortlist. Order is preserved so equal scores stay in reading order.
 */
function prune(
  candidates: Action[],
  goal: string,
  label: (action: Action) => string,
  tier = 0,
): Action[] {
  if (candidates.length <= PRUNE_ABOVE) return tier === 0 ? candidates : [];
  const words = goalWords(goal);
  const scored = candidates.map((action, at) => {
    const text = label(action).toLowerCase();
    return { action, at, score: words.filter((word) => text.includes(word)).length };
  });

  // The form surface goes in whatever it scores. Ranking on goal words alone
  // cuts the very controls a goal is carried out through: "textbox: Departure"
  // shares no word with "…on September 28, 2026", and a page whose shortlist
  // has no date field has no next step. Links and images are the long tail
  // that pruning exists to remove, so they compete for what is left.
  const surface = scored.filter((entry) => FORM_ROLES.test(entry.action.description));
  const tail = scored
    .filter((entry) => !FORM_ROLES.test(entry.action.description))
    .sort((x, y) => y.score - x.score || x.at - y.at);

  const keep = new Set<number>();
  if (tier === 0) {
    const ranked = surface.slice().sort((x, y) => y.score - x.score || x.at - y.at);
    for (const entry of ranked.slice(0, PRUNE_TO)) keep.add(entry.at);
  }
  for (const entry of tail.slice(tier * PRUNE_TO)) {
    if (keep.size >= PRUNE_TO) break;
    keep.add(entry.at);
  }
  if (keep.size === 0) return [];

  return scored.filter((entry) => keep.has(entry.at)).map((entry) => entry.action);
}

/**
 * Blocks until two consecutive reads see the same number of interactive
 * elements, which is the cheapest available "the page has stopped moving"
 * signal. Replaces a flat sleep after every action: a settled page costs one
 * probe, and a page still rendering gets exactly as long as it needs.
 */
type PageProbe = { count: number; fields: [string, string, boolean][] };

/**
 * One round trip that answers both questions a turn has about the raw page:
 * has it stopped changing, and what do its fields hold.
 *
 * They used to be two — a counter to poll, then an xpath lookup per observed
 * element — and the second was the largest untracked cost in a turn. Reading
 * the inputs by name instead of by xpath lets the poll carry them for free.
 */
async function probePage(page: Page): Promise<PageProbe> {
  try {
    return await page.evaluate<PageProbe>(() => {
      const fields: [string, string, boolean][] = [];
      for (const node of document.querySelectorAll<HTMLInputElement>(
        "input,textarea,[contenteditable='true']",
      )) {
        const name = (
          node.getAttribute("aria-label") ??
          node.getAttribute("placeholder") ??
          ""
        ).trim();
        if (!name) continue;
        const tag = node.tagName;
        const typeable =
          node.isContentEditable === true ||
          tag === "TEXTAREA" ||
          (tag === "INPUT" &&
            !["checkbox", "radio", "button", "submit", "file", "image"].includes(
              (node.getAttribute("type") ?? "text").toLowerCase(),
            ));
        fields.push([name, (node.value ?? "").trim().slice(0, 60), typeable]);
      }
      return {
        count: document.querySelectorAll("a,button,input,select,textarea,[role]").length,
        fields,
      };
    });
  } catch {
    // Mid-navigation the evaluate is refused; that is itself "not settled".
    return { count: -1, fields: [] };
  }
}

/**
 * Blocks until the page stops changing, then hands back what it last saw.
 * Replaces a flat sleep after every action: a settled page costs one probe,
 * and a page still rendering gets exactly as long as it needs.
 */
async function waitForQuiet(
  page: Page,
  pollMs: number,
  repeats = QUIET_REPEATS,
): Promise<PageProbe> {
  let previous = -1;
  let stable = 0;
  let probe: PageProbe = { count: -1, fields: [] };
  for (let attempt = 0; attempt < QUIET_PROBES; attempt++) {
    probe = await probePage(page);
    // Two equal reads are not enough. A suggestion list arrives a beat after
    // the box it belongs to, so the page goes quiet, changes, and goes quiet
    // again; reading during the first lull sees a half-built dialog.
    stable = probe.count > 0 && probe.count === previous ? stable + 1 : 0;
    if (stable >= repeats) return probe;
    previous = probe.count;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return probe;
}

/**
 * Whether the page is offering something to pick — an autocomplete list, a
 * menu, a set of options. Distinguishes a fill that is finished from one the
 * page is still asking about.
 */
async function hasChoices(page: Page): Promise<boolean> {
  try {
    return await page.evaluate<boolean>(() =>
      [...document.querySelectorAll('[role="option"],[role="listbox"] li,[role="menuitem"]')].some(
        (node) => {
          const rect = (node as HTMLElement).getBoundingClientRect();
          return rect.width > 0 && rect.height > 0;
        },
      ),
    );
  } catch {
    return true; // Unknown: leave it to the next turn rather than commit blind.
  }
}

/** Bounded wait for that list, so a fill is not judged before the page answers. */
async function waitForChoices(page: Page, pollMs: number): Promise<boolean> {
  for (let attempt = 0; attempt < CHOICE_PROBES; attempt++) {
    if (await hasChoices(page)) return true;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return false;
}

/** The element's own name, as observe() spells it: "role: name". */
function elementName(description: string): string {
  const at = description.indexOf(": ");
  return loose(at < 0 ? description : description.slice(at + 2));
}

/**
 * observe() infers a method from each element's role, and only a textbox-like
 * role becomes a `fill`. A combobox is reported as a click, which is right for
 * the ones that open a list and wrong for the ones you type into. The role
 * cannot tell them apart, but the DOM can: only a real input or a
 * contenteditable gets a fill twin, so the ticket-type dropdown is never
 * offered a date to type.
 */
function withTypeableTwins(actions: Action[], typeable: Map<string, boolean>): Action[] {
  const expanded: Action[] = [];
  for (const action of actions) {
    expanded.push(action);
    if (
      (action.method ?? "click") === "click" &&
      /^combobox\b/i.test(action.description) &&
      // The probe names every real input on the page, including the ones
      // inside a dialog, so silence here means "not an input" — a dropdown
      // dressed as a combobox, which must never be offered a value to type.
      typeable.get(elementName(action.description)) === true
    ) {
      expanded.push({ ...action, method: "fill", arguments: [] });
    }
  }
  return expanded;
}

/**
 * A throwaway question, fired while the browser is still starting. The first
 * call to TypeSafe pays for connection setup — about twice the latency of
 * every call after it — and a run has no reason to pay it on the turn that
 * matters.
 */
export async function warmUp(jev: JevConfig): Promise<void> {
  await systemOne(
    jev,
    { warmup: true },
    { ok: { type: "noul", instructions: "Is this a warm-up request?" } },
  ).catch(() => undefined);
}

export async function runAgent(
  stagehand: Stagehand,
  page: Page,
  options: AgentOptions,
): Promise<AgentResult> {
  const {
    goal,
    startUrl,
    jev,
    confidence: minConfidence = 0.35,
    doneAbove = 0.7,
    maxTurns = 20,
    pollMs = 40,
    avoid,
  } = options;

  const goalValues = fillCandidates(goal);
  const turns: TurnRecord[] = [];
  const history: string[] = [];
  // Banned until a given turn, not for ever. A modal's confirm button is worth
  // using again the next time a modal opens, and permanently barring it after
  // two uses is what leaves the agent unable to close the date picker it is
  // standing in.
  const banned = new Map<string, number>();
  const timesActed = new Map<string, number>();
  let lastSignature = "";
  let lastActed: string | undefined;
  let lastCount = 0;
  // A page that has just navigated arrives in pieces: the first thing that
  // looks settled is a half-built document, and a turn spent on it is a turn
  // spent clicking something that is about to be replaced.
  let justNavigated = false;
  let idleTurns = 0;

  const finish = (status: AgentStatus): AgentResult => ({ status, turns, history });

  for (let index = 1; index <= maxTurns; index++) {
    const usage: Usage = { requests: 0, tokens: 0, ms: 0 };
    const turnStart = performance.now();

    const probe = await waitForQuiet(
      page,
      pollMs,
      justNavigated ? QUIET_REPEATS + 2 : QUIET_REPEATS,
    );
    const typeable = new Map(probe.fields.map(([name, , can]) => [loose(name), can]));
    const held = new Map(
      probe.fields.filter(([, value]) => value).map(([name, value]) => [loose(name), value]),
    );

    let observed = await stagehand.observe();
    // A modal that has opened but not populated is briefly stable at a handful
    // of actionable elements, and the DOM counter cannot see it — the elements
    // behind the overlay are still there, just no longer reachable. Judge it on
    // what observe() reports instead, and look again before believing a page
    // that has collapsed far below the last one.
    for (
      let attempt = 0;
      attempt < COLLAPSE_RETRIES && observed.data.length < lastCount * COLLAPSE_FLOOR;
      attempt++
    ) {
      await new Promise((resolve) => setTimeout(resolve, pollMs * 2));
      observed = await stagehand.observe();
    }
    // After a navigation the page arrives in pieces: a results list is still
    // filling when the element count first holds steady, and reading it then
    // costs a whole turn to discover there is nothing to do yet. Keep reading
    // while it is still growing — it is one extra read against one full turn.
    if (justNavigated) {
      for (let attempt = 0; attempt < GROWTH_READS; attempt++) {
        const check = verifyGoal(
          goalValues,
          await page.url(),
          startUrl,
          held.values(),
          observed.data.map((action) => action.description),
        );
        if (check.done) break;
        await new Promise((resolve) => setTimeout(resolve, pollMs * 2));
        const again = await stagehand.observe();
        const grew = again.data.length > observed.data.length;
        observed = again;
        if (!grew) break;
      }
    }
    lastCount = observed.data.length;
    const observeMs = Math.round(performance.now() - turnStart);
    const url = await page.url();

    // Nothing observable changed since the last action: whatever it was is a
    // dead end for this goal, so stop offering it.
    const signature = `${url}\u0000${observed.data.length}`;
    if (lastActed && signature === lastSignature) banned.set(lastActed, index + BAN_TURNS);
    lastSignature = signature;

    const offered = withTypeableTwins(observed.data, typeable).filter(
      (action) =>
        action.description.trim().length > 0 &&
        (banned.get(identity(action)) ?? 0) <= index &&
        !(avoid && avoid.test(action.description)),
    );

    /** What a candidate's field currently holds, by the element's own name. */
    const fieldValues = new Map(
      observed.data.flatMap((action) => {
        const value = held.get(elementName(action.description));
        return value ? [[action.selector, value] as const] : [];
      }),
    );

    // A field already holding one of the goal's own values has been dealt
    // with, so typing a different one into it is a regression, not progress.
    // This is what stops the agent overwriting the origin it just set, and
    // what keeps it out of mirror inputs like "Where else?" that echo it.
    const settledValue = (action: Action) => {
      if (action.method !== "fill") return false;
      const current = fieldValues.get(action.selector)?.toLowerCase();
      return current !== undefined && goalValues.some((v) => v.toLowerCase() === current);
    };
    // A listbox or a group is a container for choices, not a choice: clicking
    // one does nothing and costs a turn, and it looks plausible enough to be
    // picked over the options inside it.
    const usable = offered.filter(
      (action) => !settledValue(action) && !CONTAINER_ROLES.test(action.description),
    );
    // A page showing a list of options is asking a question, and nothing
    // underneath it can be reached until it is answered. …but an open list is
    // an offer, not an ultimatum: clicking a city box shows recent searches,
    // and if the goal wants none of them the answer is to type, so the text
    // fields stay on the table beside the options.
    const choosing = usable.filter((action) => CHOICE_ROLES.test(action.description));
    const candidates =
      choosing.length > 0
        ? [...choosing, ...usable.filter((action) => action.method === "fill")]
        : usable;

    /** Candidate description, carrying whatever the element already holds. */
    const label = (action: Action) => describe(action, fieldValues.get(action.selector));

    const record = (partial: Partial<TurnRecord> & { decision: string }): TurnRecord => {
      const turn: TurnRecord = {
        index,
        url,
        candidates: candidates.length,
        observeMs,
        decideMs: 0,
        actMs: 0,
        jevRequests: usage.requests,
        jevTokens: usage.tokens,
        jevMs: usage.ms,
        ...partial,
      };
      turns.push(turn);
      return turn;
    };

    // What is on screen, including everything `avoid` bars the agent from
    // touching. Without this the done judge cannot see the very thing a
    // read-only goal ends at: on a results page the "Select flight" buttons
    // are the evidence, and they are exactly what the booking rail removes.
    // What is on screen, for the done judge, including everything `avoid` bars
    // the agent from touching — on a results page the "Select flight" rows are
    // the evidence, and they are exactly what the booking rail removes.
    //
    // Longest first, because a page's content lives in its long accessible
    // names while its chrome is "link: Flights" and "image". But a repetitive
    // family — sixty calendar days, each a long string — would then be the
    // whole sample, so each shape is capped: without that the judge sees an
    // open date picker and never the flights behind it.
    const shapes = new Map<string, number>();
    const onScreen: string[] = [];
    for (const text of [...new Set(observed.data.map((action) => action.description.trim()))]
      .filter(Boolean)
      .sort((left, right) => right.length - left.length)) {
      const shape = text
        .replace(/[\d\W]+/g, " ")
        .trim()
        .slice(0, 40);
      const seen = shapes.get(shape) ?? 0;
      if (seen >= SAMPLE_PER_SHAPE) continue;
      shapes.set(shape, seen + 1);
      onScreen.push(text.length > SAMPLE_CHARS ? `${text.slice(0, SAMPLE_CHARS)}…` : text);
      if (onScreen.length >= PAGE_SAMPLE) break;
    }

    // The page's current settings, as the controls that hold them. A goal
    // states an outcome — "one-way", "economy", "one adult" — and a page
    // arrives with defaults that may already contradict it. Nothing in a
    // thirty-way "which element next" question asks whether a setting is
    // wrong, so a default like Google's round trip survives until it blocks
    // the search, and by then the agent is looking at a date picker instead.
    const seenSetting = new Set<string>();
    const settings = usable
      .filter((action) => SETTING_ROLES.test(action.description) && action.method !== "fill")
      .filter((action) => {
        // Pages mirror a field into a hidden twin — "Where from?" and "Where
        // else?" hold the same city — and nominating the twin wastes a turn
        // fixing something already right. One control per distinct value.
        const key = `${action.selector}\u0000${fieldValues.get(action.selector) ?? ""}`;
        const value = fieldValues.get(action.selector);
        const dupe = value ? `v:${loose(value)}` : key;
        if (seenSetting.has(dupe)) return false;
        seenSetting.add(dupe);
        return true;
      })
      .slice(0, SETTINGS_SAMPLE);

    const state = {
      goal,
      page: { url },
      history: history.slice(-HISTORY_DEPTH),
    };

    const offerValues = unusedValues(goalValues, fieldValues.values());

    // Verified, not judged. The reference demo checks the page it ended on —
    // it base64-decodes Google's `tfs` parameter for the date and reads the
    // route out of the form's own fields — rather than trusting the model's
    // "done", and that is the right instinct: this costs nothing, cannot drift
    // with a threshold, and is the same answer every run.
    const check = verifyGoal(
      goalValues,
      url,
      startUrl,
      held.values(),
      observed.data.map((action) => action.description),
    );
    const { committed } = check;
    const verified = check.done;

    // Checked before anything is asked: it costs nothing, so a finished run
    // stops here without paying for a decision it will not use.
    if (verified) {
      record({
        decision: `goal reached (${committed}/${goalValues.length} committed, results listed)`,
        decideMs: 0,
      });
      return finish("done");
    }

    const decideStart = performance.now();

    /**
     * Asks one shard-set. `done` rides along with the first shard rather than
     * costing a round trip of its own, and is still asked when there is nothing
     * to choose between — a page with no candidate worth acting on is exactly
     * what the end of a read-only goal looks like.
     */
    const pickFrom = async (list: Action[], withDone: boolean) => {
      const shards: Action[][] = [];
      for (let at = 0; at < list.length; at += SHARD_SIZE) {
        shards.push(list.slice(at, at + SHARD_SIZE));
      }
      const responses = await Promise.all(
        (shards.length > 0 ? shards : [[]]).map((shard, shardIndex) =>
          systemOne(
            jev,
            {
              ...state,
              candidates: shard.map(label),
              ...(withDone && shardIndex === 0 ? { visible: onScreen } : {}),
            },
            {
              ...(shard.length > 0
                ? {
                    next: {
                      type: "choice" as const,
                      instructions:
                        "Which element should be used next to make progress toward the goal? " +
                        "Consider what the history shows has already been done. If something " +
                        "the page " +
                        "opened on top of the rest — a dialog, a calendar, a suggestion " +
                        "list — is waiting on a choice, settle that first: until it is " +
                        "dismissed the controls beneath it cannot be used.",
                      criteria: {
                        ...Object.fromEntries(shard.map((action, at) => [`c${at}`, label(action)])),
                        [NONE]: "None of these elements is the right next step",
                      },
                    },
                  }
                : {}),
              ...(shard.length > 0 && goalValues.length > 0
                ? {
                    value: {
                      type: "choice" as const,
                      instructions:
                        "If the element chosen above is a field to type into, which of these " +
                        "belongs in it to serve the goal? Answer even if unsure; it is ignored " +
                        "when the chosen element is not a field.",
                      criteria: {
                        ...Object.fromEntries(offerValues.map((v, at) => [`v${at}`, v])),
                        [NONE]: "None of these belongs in the chosen field",
                      },
                    },
                  }
                : {}),
              ...(withDone && shardIndex === 0 && settings.length > 0
                ? {
                    mismatch: {
                      type: "choice" as const,
                      instructions:
                        "Each of these is a setting the page currently holds. Which one " +
                        "disagrees with what the goal asks for? Judge the setting's current " +
                        "value against the goal, not whether the goal mentions it.",
                      criteria: {
                        ...Object.fromEntries(settings.map((s, at) => [`s${at}`, label(s)])),
                        [NONE]: "Every setting here already agrees with the goal",
                      },
                    },
                  }
                : {}),
              ...(withDone && shardIndex === 0
                ? {
                    done: {
                      type: "noul" as const,
                      instructions:
                        "Judge the goal against `visible`, which lists what is on screen now. " +
                        "Is the goal already achieved?",
                      criteria: {
                        true: "What the goal asked to reach is on screen; the remaining steps in the goal are ones it says NOT to take",
                        false: "The goal still needs at least one more action to be taken",
                      },
                    },
                  }
                : {}),
            },
          ),
        ),
      );
      for (const response of responses) addUsage(usage, response);

      // One winner per shard, then a runoff between them.
      const winners = responses.flatMap((response, shardIndex) => {
        if (shards.length === 0) return [];
        const answer = choiceAnswer(response, "next");
        if (answer.choice === NONE) return [];
        const at = Number(answer.choice.slice(1));
        const action = shards[shardIndex]![at];
        return action ? [{ action, confidence: answer.confidence, shardIndex }] : [];
      });

      let chosen = winners[0];
      if (winners.length > 1) {
        const runoff = await systemOne(
          jev,
          { ...state, candidates: winners.map((winner) => label(winner.action)) },
          {
            next: {
              type: "choice",
              instructions: "Which of these is the best next step toward the goal?",
              criteria: Object.fromEntries(
                winners.map((winner, at) => [`c${at}`, label(winner.action)]),
              ),
            },
          },
        );
        addUsage(usage, runoff);
        const answer = choiceAnswer(runoff, "next");
        const winner = winners[Number(answer.choice.slice(1))];
        if (winner) {
          chosen = { ...winner, confidence: answer.confidence };
        }
      }

      // The value rode along with the element choice, so a fill costs no extra
      // round trip. Read it from whichever shard produced the winner.
      let value: { choice: string; confidence: number } | undefined;
      if (chosen) {
        const response = responses[chosen.shardIndex];
        const answer =
          response && "value" in response.answers ? choiceAnswer(response, "value") : undefined;
        if (answer && answer.choice !== NONE) {
          const picked = offerValues[Number(answer.choice.slice(1))];
          if (picked) value = { choice: picked, confidence: answer.confidence };
        }
      }

      let wrongSetting: { action: Action; confidence: number; shardIndex: number } | undefined;
      if (withDone && settings.length > 0 && responses[0] && "mismatch" in responses[0].answers) {
        const answer = choiceAnswer(responses[0], "mismatch");
        const setting =
          answer.choice === NONE ? undefined : settings[Number(answer.choice.slice(1))];
        if (setting)
          wrongSetting = { action: setting, confidence: answer.confidence, shardIndex: 0 };
      }

      const doneScore = withDone ? noulAnswer(responses[0]!, "done").noul : undefined;
      return { chosen, doneScore, value, wrongSetting };
    };

    // A wide choice spreads Jev's probability mass: over the full page the
    // right element comes back at ~0.6, and over a list cut to the 30 sharing
    // words with the goal the same element comes back at ~1.0 — with fewer
    // shards, so it is cheaper too. Pruning can drop the answer, though, so an
    // abstention falls back to the whole list rather than ending the run.
    const shortlist = prune(candidates, goal, label);
    const first = await pickFrom(shortlist, true);
    const doneScore = first.doneScore!;

    if (doneScore >= doneAbove) {
      record({
        decision: "goal reached",
        doneScore,
        decideMs: Math.round(performance.now() - decideStart),
      });
      return finish("done");
    }

    if (candidates.length === 0) {
      record({
        decision: "nothing left to act on, and the goal is not met",
        doneScore,
        decideMs: Math.round(performance.now() - decideStart),
      });
      return finish("stalled");
    }

    // A setting that contradicts the goal outranks whatever looked most
    // goal-shaped: until it is fixed the page cannot produce what the goal
    // asks for, and on this one it is the difference between a search that
    // runs and a date picker that will not stop asking for a return date.
    let chosen = first.chosen;
    let pickedValue = first.value;
    if (
      first.wrongSetting &&
      first.wrongSetting.confidence >= minConfidence &&
      (banned.get(identity(first.wrongSetting.action)) ?? 0) <= index
    ) {
      // A dropdown set wrong is fixed by opening it; a text field set wrong is
      // fixed by typing in it, not by clicking it and hoping. Prefer the fill
      // twin where there is one, and carry the value that was chosen in the
      // same breath as the setting.
      const twin = usable.find(
        (action) =>
          action.selector === first.wrongSetting!.action.selector && action.method === "fill",
      );
      chosen = twin ? { ...first.wrongSetting, action: twin } : first.wrongSetting;
      pickedValue = twin ? first.value : undefined;
    }
    // A weak or absent answer gets one more look — at the next tier of the
    // ranking, not at the whole page. Re-asking over everything costs a shard
    // per thirty candidates, which on a results page is thirteen requests for
    // a question the first tier usually answered well enough.
    if (!chosen || chosen.confidence < minConfidence) {
      const second = prune(candidates, goal, label, 1);
      if (second.length > 0) {
        const runner = await pickFrom(second, false);
        if (runner.chosen && (!chosen || runner.chosen.confidence > chosen.confidence)) {
          chosen = runner.chosen;
          pickedValue = runner.value;
        }
      }
    }

    // Confidence decides whether to widen the search, not whether to carry on.
    // A weak best guess still beats stopping: a ten-step goal has ten chances
    // to meet an ambiguous page, and the repeat, stall and settled-field guards
    // are what catch a wrong move. Only a page where Jev rejects every
    // candidate outright ends the run.
    if (!chosen) {
      // Nothing worth doing is also what a page looks like while it is still
      // arriving — and the results page the goal ends at is the slowest one of
      // all. Giving up here would throw away a finished task, so wait and look
      // again; only a page that stays indecisive ends the run.
      idleTurns += 1;
      record({
        decision:
          idleTurns < IDLE_TURNS ? "nothing to do yet; waiting for the page" : "no element chosen",
        doneScore,
        decideMs: Math.round(performance.now() - decideStart),
      });
      if (idleTurns >= IDLE_TURNS) return finish("abstained");
      await new Promise((resolve) => setTimeout(resolve, pollMs * 5));
      continue;
    }
    idleTurns = 0;

    // Jev cannot write the text, so a fill uses one of the goal's own spans —
    // already chosen alongside the element, in the same request.
    let action = chosen.action;
    let value: string | undefined;
    if (action.method === "fill") {
      // The merged answer was given before the element was settled, so it is
      // weaker than a dedicated one. Re-ask only when it wavers: the common
      // case still costs no extra round trip.
      if (!pickedValue || pickedValue.confidence < minConfidence) {
        const response = await systemOne(
          jev,
          { ...state, field: label(action) },
          {
            value: {
              type: "choice",
              instructions: `Which of these belongs in "${action.description}" to serve the goal?`,
              criteria: {
                ...Object.fromEntries(offerValues.map((option, at) => [`v${at}`, option])),
                [NONE]: "None of these belongs in this field",
              },
            },
          },
        );
        addUsage(usage, response);
        const answer = choiceAnswer(response, "value");
        const picked =
          answer.choice === NONE ? undefined : offerValues[Number(answer.choice.slice(1))];
        pickedValue =
          picked && answer.confidence >= minConfidence
            ? { choice: picked, confidence: answer.confidence }
            : undefined;
      }
      if (!pickedValue) {
        banned.set(identity(action), index + BAN_TURNS);
        record({
          decision: `no value for "${label(action)}"`,
          doneScore,
          decideMs: Math.round(performance.now() - decideStart),
        });
        continue;
      }
      value = pickedValue.choice;
      action = { ...action, arguments: [value] };
    } else if (action.method === "selectOptionFromDropdown") {
      const options = action.arguments ?? [];
      if (options.length === 0) {
        // A native <select> only: observe() reports the control but not its
        // option list, so there is nothing for Jev to choose between.
        banned.set(identity(action), index + BAN_TURNS);
        record({
          decision: `no options to choose from for "${label(action)}"`,
          doneScore,
          decideMs: Math.round(performance.now() - decideStart),
        });
        continue;
      }
      const response = await systemOne(
        jev,
        { ...state, field: label(action) },
        {
          value: {
            type: "choice",
            instructions: `Which of these belongs in "${action.description}" to serve the goal?`,
            criteria: {
              ...Object.fromEntries(options.map((option, at) => [`v${at}`, option])),
              [NONE]: "None of these belongs in this field",
            },
          },
        },
      );
      addUsage(usage, response);
      const answer = choiceAnswer(response, "value");
      if (answer.choice === NONE || answer.confidence < minConfidence) {
        banned.set(identity(action), index + BAN_TURNS);
        record({
          decision: `no value for "${label(action)}"`,
          confidence: answer.confidence,
          doneScore,
          decideMs: Math.round(performance.now() - decideStart),
        });
        continue;
      }
      value = options[Number(answer.choice.slice(1))]!;
      action = { ...action, arguments: [value] };
    }

    const decideMs = Math.round(performance.now() - decideStart);

    const actStart = performance.now();
    const urlBefore = url;
    let result = await stagehand.act(action);

    // A click that opens a dropdown deserves the same patience as a fill that
    // opens an autocomplete: read too early and the options are not there yet,
    // the only candidate left is the dropdown itself, and clicking it again
    // just shuts what was opening.
    if (
      result.data.success &&
      (action.method ?? "click") === "click" &&
      SETTING_ROLES.test(action.description)
    ) {
      await waitForChoices(page, pollMs);
    }

    // A stale element is a re-render, not a wrong choice. Finding it again by
    // name costs one read; giving up costs a whole turn and a decision.
    if (!result.data.success) {
      const again = (await stagehand.observe()).data.find(
        (other) => other.description === action.description && other.selector !== action.selector,
      );
      if (again)
        result = await stagehand.act({
          ...again,
          method: action.method,
          arguments: action.arguments ?? [],
        });
    }
    // Typed text that is never committed is not really entered: a date field
    // keeps its calendar open waiting for one. But an autocomplete answers a
    // fill with a list of choices, and Enter there takes whichever is
    // highlighted — on this page that submits the whole search from the origin
    // box. The page tells the two apart: commit only when nothing appeared to
    // choose from.
    // An autocomplete answers a fill with a list, but not instantly, and a turn
    // spent looking before it arrives is a turn spent walking away from the
    // box just filled. Wait for the list; if none comes the field wanted a
    // commit instead, which is the case a date picker is stuck in.
    // …except a date. A date field's commit is the picker's own confirm button,
    // and Enter here just closes the calendar, so the submit that follows has
    // to reopen it and be dismissed again — three turns to get back where the
    // calendar already was. Leave it open and the agent presses "Done" itself.
    const isDate = value !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(value);
    if (
      value !== undefined &&
      !isDate &&
      result.data.success &&
      !(await waitForChoices(page, pollMs))
    ) {
      await stagehand
        .act({
          selector: action.selector,
          description: `commit ${action.description}`,
          method: "press",
          arguments: ["Enter"],
        })
        .catch(() => undefined);
    }
    const actMs = Math.round(performance.now() - actStart);

    const outcome = value ? `${label(action)} ← "${value}"` : label(action);
    record({
      decision: result.data.success ? outcome : `failed: ${outcome}`,
      value,
      confidence: chosen.confidence,
      doneScore,
      decideMs,
      actMs,
    });
    if (!result.data.success) {
      banned.set(identity(action), index + BAN_TURNS);
      lastActed = undefined;
      continue;
    }
    history.push(outcome);
    // "Transitioned" is wider than "navigated": closing a calendar rewrites
    // half the page without touching the URL, and reading that mid-flight is
    // how a turn ends up clicking a button that no longer exists.
    const after = await probePage(page);
    justNavigated =
      (await page.url()) !== urlBefore ||
      Math.abs(after.count - probe.count) > probe.count * TRANSITION_SHARE;
    // Next turn's observation decides whether this action moved anything.
    lastActed = identity(action);
    // A page that changes just enough to defeat the signature check can still
    // be a loop; the same element twice has had its chance either way.
    const repeats = (timesActed.get(lastActed) ?? 0) + 1;
    timesActed.set(lastActed, repeats);
    if (repeats >= MAX_REPEATS) {
      banned.set(lastActed, index + BAN_TURNS);
      timesActed.set(lastActed, 0);
    }
  }

  return finish("max-turns");
}
