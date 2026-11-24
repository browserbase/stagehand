import type { LocatorChain, LocatorQueryStep } from "../../types.js";

const card: LocatorQueryStep = {
  type: "query",
  selector: { kind: "css", value: ".card" },
};
const button: LocatorQueryStep = {
  type: "query",
  selector: { kind: "css", value: "button" },
};
const frame: LocatorQueryStep = {
  type: "query",
  selector: { kind: "css", value: "iframe.checkout" },
};

export const validLocatorChains = [
  { name: "single CSS query", chain: { steps: [button] } },
  {
    name: "XPath with whitespace and predicates preserved",
    chain: {
      steps: [
        {
          type: "query",
          selector: { kind: "xpath", value: " .//button[normalize-space(.)='Save'] " },
        },
      ],
    },
  },
  {
    name: "legacy text with Unicode and literal delimiters",
    chain: {
      steps: [{ type: "query", selector: { kind: "text", value: "  保存 >> / 'Save'  " } }],
    },
  },
  {
    name: "position before a descendant query",
    chain: { steps: [card, { type: "nth", index: 1 }, button] },
  },
  {
    name: "position after a descendant query",
    chain: { steps: [card, button, { type: "nth", index: 1 }] },
  },
  {
    name: "repeated positions including zero",
    chain: { steps: [card, { type: "nth", index: 2 }, { type: "nth", index: 0 }, button] },
  },
  { name: "iframe element as the final target", chain: { steps: [frame] } },
  { name: "ordinary query following an iframe query", chain: { steps: [frame, button] } },
  {
    name: "explicit legacy frame hops with positions",
    chain: {
      steps: [
        frame,
        { type: "nth", index: 0 },
        { type: "frame", selector: { kind: "css", value: "iframe.payment" } },
        { type: "frame", selector: { kind: "xpath", value: "//button" } },
        { type: "nth", index: 1 },
      ],
    },
  },
] satisfies Array<{ name: string; chain: LocatorChain }>;

export const invalidLocatorChains: Array<{ name: string; chain: unknown }> = [
  { name: "null", chain: null },
  { name: "missing steps", chain: {} },
  { name: "empty steps", chain: { steps: [] } },
  { name: "non-array steps", chain: { steps: card } },
  { name: "leading position", chain: { steps: [{ type: "nth", index: 0 }, card] } },
  { name: "leading frame hop", chain: { steps: [{ type: "frame", selector: button.selector }] } },
  { name: "unknown step", chain: { steps: [card, { type: "filter", hasText: "Save" }] } },
  { name: "null step", chain: { steps: [card, null] } },
  { name: "missing query selector", chain: { steps: [{ type: "query" }] } },
  { name: "missing frame selector", chain: { steps: [frame, { type: "frame" }] } },
  {
    name: "unknown engine",
    chain: { steps: [{ type: "query", selector: { kind: "role", value: "button" } }] },
  },
  { name: "string selector", chain: { steps: [{ type: "query", selector: "button" }] } },
  {
    name: "selector extra fields",
    chain: { steps: [{ type: "query", selector: { ...button.selector, exact: true } }] },
  },
  { name: "step extra fields", chain: { steps: [{ ...card, nth: 1 }] } },
  { name: "outer position", chain: { steps: [card], nth: 1 } },
  { name: "outer selector", chain: { steps: [card], selector: "button" } },
  ...["css", "xpath", "text"].map((kind) => ({
    name: `empty ${kind} selector`,
    chain: { steps: [{ type: "query", selector: { kind, value: "" } }] },
  })),
  ...[-1, 0.5, "1", true, null, undefined, NaN, Infinity].map((index) => ({
    name: `invalid position ${String(index)}`,
    chain: { steps: [card, { type: "nth", index }] },
  })),
];
