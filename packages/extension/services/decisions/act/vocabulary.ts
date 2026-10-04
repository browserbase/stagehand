import { choiceAnswer } from "../client.js";

/**
 * The closed sets the intent question chooses from: action families, keys, and the page
 * methods each family maps to.
 */

const MERGED_FAMILY_MASS = 0.85;

export const FAMILIES: Record<string, string> = {
  click:
    "Click or tap an element: a button, link, checkbox, radio button, tab, menu item, calendar day, or a control that expands something. Includes opening, going to, or following something through a link or button on the page",
  double_click: "Explicitly double-click an element",
  hover: "Hover the mouse over an element without clicking",
  fill: "Type or fill text into an input field, search box, or text area",
  select: "Choose an option from a dropdown, combobox, or select menu",
  press: "Press a keyboard key such as Enter, Tab, or Escape",
  scroll: "Scroll the page or a container to a position or percentage",
  next_chunk: "Scroll down by one screen to the next chunk of the page",
  prev_chunk: "Scroll up by one screen to the previous chunk of the page",
  drag: "Drag one element and drop it onto another element",
  not_an_action:
    "Not a request to interact with the page at all: a general knowledge question, chit-chat, or nonsense",
  unsupported:
    "A browser task outside the other kinds: reading or extracting information, loading a typed URL in the address bar, or uploading a file",
};

export const KEYS = [
  "Enter",
  "Tab",
  "Escape",
  "Space",
  "Backspace",
  "Delete",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "PageUp",
  "PageDown",
  "Home",
  "End",
];

export const POINTER_METHODS: Record<string, string> = {
  click: "click",
  double_click: "doubleClick",
  hover: "hover",
};

export const SCROLL_METHODS: Record<string, string> = {
  scroll: "scrollTo",
  next_chunk: "nextChunk",
  prev_chunk: "prevChunk",
};

/**
 * "Pick the Chicory suggestion" splits the decision model between click and select, and
 * "open the folder" between click and double-click. Those pairs lead to the
 * same first step, so their combined weight decides, not the split.
 */
export function resolveFamily(
  answer: ReturnType<typeof choiceAnswer>,
  threshold: number,
): { choice: string; confidence: number; top: string } {
  const ranked = Object.entries(answer.probabilities).sort((a, b) => b[1] - a[1]);
  const top = ranked
    .slice(0, 3)
    .map(([name, p]) => `${name}=${Math.round(p * 100) / 100}`)
    .join(",");
  if (answer.confidence >= threshold)
    return { choice: answer.choice, confidence: answer.confidence, top };

  const p = (name: string) => answer.probabilities[name] ?? 0;
  for (const [a, b, winner] of [
    ["click", "select", undefined],
    ["click", "double_click", "click"],
    // "Run the search": a button click and Enter do the same thing, so the
    // combined mass counts; the more likely of the two is what gets done
    // ("press Enter in the search box" must not turn into a click on it).
    ["click", "press", undefined],
  ] as const) {
    const combined = p(a) + p(b);
    if (combined >= MERGED_FAMILY_MASS && ranked[0] && [a, b].includes(ranked[0][0] as typeof a)) {
      return { choice: winner ?? (p(a) >= p(b) ? a : b), confidence: combined, top };
    }
  }
  return { choice: answer.choice, confidence: answer.confidence, top };
}
