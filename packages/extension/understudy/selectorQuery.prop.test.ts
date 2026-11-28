import vm from "node:vm";
import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { LocatorChainSchema } from "@browserbasehq/stagehand-protocol/schemas";
import type { LocatorChain, LocatorQuerySelector } from "@browserbasehq/stagehand-protocol/types";
import {
  IFRAME_STEP_RE,
  buildXPathFromSteps,
  locatorSteps,
  parseLegacySelector,
  parseXPathToSteps,
  planDeepXPathTarget,
  planLegacySelector,
  textQueryStep,
} from "./selectorQuery.js";
import { buildLocatorInvocation } from "./locatorInvocation.js";
import { createTextMatcher, normalizeQueryText } from "../dom/locatorScripts/textQuery.js";
import { applyPredicates, parseXPathSteps } from "../dom/locatorScripts/xpathParser.js";

const SEED = 20261124;

const adversarialTokenArb = fc.constantFrom(
  "",
  " ",
  "\t",
  "\n",
  "\r\n",
  "\u00a0",
  "\u2003",
  "\u202f",
  "\u200b",
  "\u00ad",
  "\u2028",
  "\u2029",
  "'",
  '"',
  "`",
  "\\",
  '\\"',
  "\\'",
  "\\\\",
  "${1+1}",
  "</script>",
  "\0",
  "[",
  "]",
  "(",
  ")",
  "*",
  "+",
  "?",
  "$",
  "^",
  "|",
  ".",
  "{",
  "}",
  ">>",
  "/",
  "//",
  ".//",
  "xpath=",
  "XPATH=",
  "XpAtH=",
  "text=",
  "TEXT=",
  "TeXt=",
  "css=",
  "CSS=",
  "iframe",
  "frame",
  "IFRAME[2]",
  "frame[1]",
  "button",
  "div",
  "span",
  " > ",
  " + ",
  " ~ ",
  ":nth-child(2)",
  "[@id='x']",
  '[@title="a[0]/b"]',
  "[text()='Save']",
  "[normalize-space(.)='a b']",
  "[0]",
  "[1]",
  " and ",
  " or ",
  "not(",
  "東京",
  "café",
  "CAFÉ",
  "🚀",
);

const adversarialStringArb = fc.oneof(
  { weight: 3, arbitrary: fc.string({ maxLength: 80 }) },
  {
    weight: 4,
    arbitrary: fc
      .array(adversarialTokenArb, { minLength: 0, maxLength: 14 })
      .map((tokens) => tokens.join("")),
  },
  {
    weight: 1,
    arbitrary: fc
      .tuple(adversarialTokenArb, fc.integer({ min: 50, max: 400 }))
      .map(([token, count]) => token.repeat(count)),
  },
);

const selectorQueryArb: fc.Arbitrary<LocatorQuerySelector> = fc.oneof(
  adversarialStringArb.map((value) => ({ kind: "css" as const, value })),
  adversarialStringArb.map((value) => ({ kind: "xpath" as const, value })),
  adversarialStringArb.map((value) => ({ kind: "text" as const, value })),
  fc.record({
    kind: fc.constant("textMatch" as const),
    value: adversarialStringArb,
    exact: fc.boolean(),
  }),
);

const nonEmptyAdversarialArb = adversarialStringArb.filter((s) => s.length > 0);

const validChainArb: fc.Arbitrary<LocatorChain> = fc
  .tuple(
    fc.oneof(
      nonEmptyAdversarialArb.map((value) => ({ kind: "css" as const, value })),
      nonEmptyAdversarialArb.map((value) => ({ kind: "xpath" as const, value })),
      nonEmptyAdversarialArb.map((value) => ({ kind: "text" as const, value })),
      fc.record({
        kind: fc.constant("textMatch" as const),
        value: adversarialStringArb,
        exact: fc.boolean(),
      }),
    ),
    fc.array(
      fc.oneof(
        fc.record({
          type: fc.constant("nth" as const),
          index: fc.integer({ min: 0, max: 100 }),
        }),
        fc.record({
          type: fc.constantFrom("query" as const, "frame" as const),
          selector: fc.oneof(
            nonEmptyAdversarialArb.map((value) => ({ kind: "css" as const, value })),
            nonEmptyAdversarialArb.map((value) => ({ kind: "xpath" as const, value })),
            nonEmptyAdversarialArb.map((value) => ({ kind: "text" as const, value })),
            fc.record({
              kind: fc.constant("textMatch" as const),
              value: adversarialStringArb,
              exact: fc.boolean(),
            }),
          ),
        }),
      ),
      { maxLength: 5 },
    ),
  )
  .map(([first, rest]) => ({
    steps: [{ type: "query" as const, selector: first }, ...rest],
  }));

function referenceNormalizeText(text: string): string {
  let out = "";
  let inWhitespace = false;
  for (const ch of text) {
    if (ch === "\u200b" || ch === "\u00ad") continue;
    if (/\s/u.test(ch)) {
      if (out.length > 0) inWhitespace = true;
    } else {
      if (inWhitespace) {
        out += " ";
        inWhitespace = false;
      }
      out += ch;
    }
  }
  return out;
}

describe("selectorQuery & textQuery adversarial properties", () => {
  it("never crashes on arbitrary adversarial strings across all parsers and planners", () => {
    fc.assert(
      fc.property(adversarialStringArb, (raw) => {
        const parsed = parseLegacySelector(raw);
        expect(["css", "xpath", "text"]).toContain(parsed.kind);
        expect(typeof parsed.value).toBe("string");

        const plan = planLegacySelector(raw);
        expect(Array.isArray(plan.frameHopSelectors)).toBe(true);
        expect(typeof plan.finalSelector).toBe("string");

        const deepPlan = planDeepXPathTarget(raw);
        expect(deepPlan.finalSelector.startsWith("xpath=")).toBe(true);
        for (const hop of deepPlan.frameHopSelectors) {
          expect(hop.startsWith("xpath=")).toBe(true);
          const hopSteps = parseXPathToSteps(hop.slice("xpath=".length));
          expect(hopSteps.length).toBeGreaterThan(0);
          expect(IFRAME_STEP_RE.test(hopSteps[hopSteps.length - 1]!.name)).toBe(true);
        }

        const steps = locatorSteps(raw);
        expect(steps.length).toBeGreaterThanOrEqual(1);
        expect(steps[0]!.type).toBe("query");
        for (const step of steps.slice(1)) {
          expect(step.type).toBe("frame");
        }

        const legacyXPath = parseXPathToSteps(raw);
        expect(typeof buildXPathFromSteps(legacyXPath)).toBe("string");

        const parsedXPath = parseXPathSteps(raw);
        expect(Array.isArray(parsedXPath)).toBe(true);
      }),
      { seed: SEED, numRuns: 300 },
    );
  });

  it("produces syntactically valid, injection-proof JS expressions with exact argument round-trip", () => {
    fc.assert(
      fc.property(
        selectorQueryArb,
        fc.oneof(
          fc.constant({ mode: "count" as const }),
          fc.constant({ mode: "all" as const }),
          fc.record({
            mode: fc.constant("range" as const),
            start: fc.integer({ min: 0, max: 50 }),
            end: fc.integer({ min: 0, max: 100 }),
          }),
        ),
        (query, resolution) => {
          const expr = buildLocatorInvocation("resolveQuery", [
            JSON.stringify(query),
            JSON.stringify(resolution),
          ]);
          const indexExpr = `(${expr})[0] ?? null`;

          const captured: unknown[][] = [];
          const sandbox = {
            __stagehandLocatorScripts: {
              resolveQuery: (...args: unknown[]) => {
                captured.push(args);
                return ["sentinel"];
              },
            },
          };

          expect(vm.runInNewContext(expr, sandbox)).toEqual(["sentinel"]);
          expect(vm.runInNewContext(indexExpr, sandbox)).toBe("sentinel");

          expect(captured).toHaveLength(2);
          expect(captured[0]).toEqual([query, resolution]);
          expect(captured[1]).toEqual([query, resolution]);
        },
      ),
      { seed: SEED, numRuns: 250 },
    );
  });

  it("round-trips arbitrary LocatorChain payloads through resolveElementChainResult expressions", () => {
    fc.assert(
      fc.property(
        validChainArb,
        fc.oneof(
          fc.constant({ mode: "count" as const }),
          fc.constant({ mode: "all" as const }),
          fc.record({
            mode: fc.constant("selected" as const),
            index: fc.integer({ min: 0, max: 50 }),
          }),
        ),
        (chain, resolution) => {
          const validated = LocatorChainSchema.parse(chain);
          const expr = buildLocatorInvocation("resolveElementChainResult", [
            JSON.stringify(validated),
            JSON.stringify(resolution),
          ]);

          let received: unknown[] | undefined;
          const sandbox = {
            __stagehandLocatorScripts: {
              resolveElementChainResult: (...args: unknown[]) => {
                received = args;
                return 42;
              },
            },
          };
          expect(vm.runInNewContext(expr, sandbox)).toBe(42);
          expect(received).toEqual([validated, resolution]);
        },
      ),
      { seed: SEED, numRuns: 150 },
    );
  });

  it("preserves lone quote characters in text= selectors while stripping matched quote pairs", () => {
    fc.assert(
      fc.property(
        fc.constantFrom("text=", "TEXT=", "TeXt="),
        fc.constantFrom('"', "'"),
        fc.string({ unit: fc.constantFrom(" ", "\t", "\n"), maxLength: 3 }),
        fc.string({ unit: fc.constantFrom(" ", "\t", "\n"), maxLength: 3 }),
        (prefix, quote, before, after) => {
          const lone = parseLegacySelector(`${prefix}${before}${quote}${after}`);
          expect(lone).toEqual({ kind: "text", value: quote });

          const emptyQuoted = parseLegacySelector(`${prefix}${before}${quote}${quote}${after}`);
          expect(emptyQuoted).toEqual({ kind: "text", value: "" });
        },
      ),
      { seed: SEED, numRuns: 100 },
    );

    fc.assert(
      fc.property(fc.constantFrom('"', "'"), adversarialStringArb, (quote, inner) => {
        const parsed = parseLegacySelector(`text=${quote}${inner}${quote}`);
        expect(parsed).toEqual({ kind: "text", value: inner });

        const other = quote === '"' ? "'" : '"';
        const mismatched = parseLegacySelector(`text=${quote}${inner}${other}`);
        expect(mismatched).toEqual({ kind: "text", value: `${quote}${inner}${other}` });
      }),
      { seed: SEED, numRuns: 200 },
    );
  });

  it("keeps buildXPathFromSteps -> parseXPathToSteps round-trip idempotent", () => {
    fc.assert(
      fc.property(adversarialStringArb, (raw) => {
        const steps = parseXPathToSteps(raw);
        const rebuilt = buildXPathFromSteps(steps);
        const reparsed = parseXPathToSteps(rebuilt);
        expect(reparsed).toEqual(steps);
        expect(buildXPathFromSteps(reparsed)).toBe(rebuilt);
      }),
      { seed: SEED, numRuns: 250 },
    );
  });

  it("does not let unmatched closing brackets swallow subsequent XPath path steps", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{1,8}$/),
        fc.integer({ min: 1, max: 4 }),
        fc.stringMatching(/^[a-z]{1,8}$/),
        (firstTag, extraCloses, secondTag) => {
          const steps = parseXPathSteps(`//${firstTag}${"]".repeat(extraCloses)}/${secondTag}`);
          expect(steps.length).toBe(2);
          expect(steps[1]).toEqual({ axis: "child", tag: secondTag, predicates: [] });
        },
      ),
      { seed: SEED, numRuns: 100 },
    );
  });

  it("enforces 1-based XPath positional index semantics (including [0] matching nothing)", () => {
    const fakeElements = Array.from({ length: 5 }, (_, i) => ({ id: i }) as unknown as Element);

    fc.assert(
      fc.property(fc.integer({ min: 0, max: 10 }), (pos) => {
        const steps = parseXPathSteps(`//div[${pos}]`);
        expect(steps).toHaveLength(1);
        const matched = applyPredicates(fakeElements, steps[0]!.predicates);
        if (pos >= 1 && pos <= fakeElements.length) {
          expect(matched).toEqual([fakeElements[pos - 1]]);
        } else {
          expect(matched).toEqual([]);
        }
      }),
      { seed: SEED, numRuns: 50 },
    );
  });

  it("handles nested brackets inside XPath predicates without truncating", () => {
    fc.assert(
      fc.property(
        fc.stringMatching(/^[a-z]{1,8}$/),
        fc.stringMatching(/^[a-z]{1,6}$/),
        fc.stringMatching(/^[a-z0-9]{1,8}$/),
        (tag, attr, value) => {
          const quotedBracket = `//${tag}[@${attr}='${value}[0]']/span`;
          const steps = parseXPathSteps(quotedBracket);
          expect(steps).toEqual([
            {
              axis: "desc",
              tag,
              predicates: [{ type: "attrEquals", name: attr, value: `${value}[0]` }],
            },
            { axis: "child", tag: "span", predicates: [] },
          ]);

          const nestedOuter = `//${tag}[foo[1]][@${attr}='${value}']`;
          const nestedSteps = parseXPathSteps(nestedOuter);
          expect(nestedSteps).toEqual([
            {
              axis: "desc",
              tag,
              predicates: [{ type: "attrEquals", name: attr, value }],
            },
          ]);
        },
      ),
      { seed: SEED, numRuns: 100 },
    );
  });

  it("matches the reference oracle for normalizeQueryText and createTextMatcher", () => {
    fc.assert(
      fc.property(
        adversarialStringArb,
        adversarialStringArb,
        fc.boolean(),
        (needle, candidate, exact) => {
          const normalizedNeedle = normalizeQueryText(needle);
          const normalizedCandidate = normalizeQueryText(candidate);

          expect(normalizedNeedle).toBe(referenceNormalizeText(needle));
          expect(normalizedCandidate).toBe(referenceNormalizeText(candidate));
          expect(normalizeQueryText(normalizedNeedle)).toBe(normalizedNeedle);

          const actual = createTextMatcher(needle, exact)(candidate);
          const expected = exact
            ? normalizedCandidate === normalizedNeedle
            : normalizedCandidate.toLowerCase().includes(normalizedNeedle.toLowerCase());
          expect(actual).toBe(expected);

          if (createTextMatcher(needle, true)(candidate)) {
            expect(createTextMatcher(needle, false)(candidate)).toBe(true);
          }
        },
      ),
      { seed: SEED, numRuns: 300 },
    );
  });

  it("keeps textQueryStep isolated from legacy selector prefixes and delimiters", () => {
    fc.assert(
      fc.property(
        adversarialStringArb,
        fc.option(fc.boolean(), { nil: undefined }),
        (value, exact) => {
          const step = textQueryStep(value, exact === undefined ? {} : { exact });
          expect(step).toEqual({
            type: "query",
            selector: { kind: "textMatch", value, exact: exact ?? false },
          });
          expect(() => LocatorChainSchema.parse({ steps: [step] })).not.toThrow();
        },
      ),
      { seed: SEED, numRuns: 200 },
    );
  });
});
