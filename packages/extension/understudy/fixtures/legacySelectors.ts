import type { LegacyXPathStep, SelectorQuery } from "../selectorQuery.js";

// Released behavior, including known quirks. Expected values are shared by the
// pure normalization tests and the resolver-boundary tests; do not derive them
// by calling either implementation.
export const legacyEngineCases: Array<{ name: string; input: string; query: SelectorQuery }> = [
  { name: "plain CSS", input: "button.submit", query: { kind: "css", value: "button.submit" } },
  {
    name: "outer whitespace",
    input: " \n button > span \t",
    query: { kind: "css", value: "button > span" },
  },
  { name: "CSS prefix", input: "CSS=button", query: { kind: "css", value: "button" } },
  {
    name: "whitespace after CSS prefix",
    input: "css=  button ",
    query: { kind: "css", value: "  button" },
  },
  {
    name: "explicit CSS beats XPath inference",
    input: "css=//button",
    query: { kind: "css", value: "//button" },
  },
  {
    name: "unknown prefix stays CSS",
    input: "role=button",
    query: { kind: "css", value: "role=button" },
  },
  {
    name: "slash in CSS attribute",
    input: 'a[href="/docs/start"]',
    query: { kind: "css", value: 'a[href="/docs/start"]' },
  },
  { name: "empty string", input: " \t", query: { kind: "css", value: "" } },
  { name: "empty CSS payload", input: "css=", query: { kind: "css", value: "" } },
  {
    name: "text prefix and whitespace",
    input: " TeXt=  Save changes  ",
    query: { kind: "text", value: "Save changes" },
  },
  {
    name: "double quoted text",
    input: 'text=" Save "',
    query: { kind: "text", value: " Save " },
  },
  { name: "single quoted text", input: "text='Save'", query: { kind: "text", value: "Save" } },
  {
    name: "mismatched quotes remain literal",
    input: `text="Save'`,
    query: { kind: "text", value: `"Save'` },
  },
  {
    name: "escaped quotes are not decoded",
    input: String.raw`text="Say \"Save\""`,
    query: { kind: "text", value: String.raw`Say \"Save\"` },
  },
  { name: "empty quoted text", input: 'text=""', query: { kind: "text", value: "" } },
  {
    name: "text with slashes",
    input: 'text="https://example.com/a/b"',
    query: { kind: "text", value: "https://example.com/a/b" },
  },
  {
    name: "text hop literal at engine boundary",
    input: 'text="a >> b"',
    query: { kind: "text", value: "a >> b" },
  },
  {
    name: "absolute XPath",
    input: "/html/body/button[2]",
    query: { kind: "xpath", value: "/html/body/button[2]" },
  },
  { name: "descendant XPath", input: "//button", query: { kind: "xpath", value: "//button" } },
  {
    name: "parenthesized XPath",
    input: "(//button)[2]",
    query: { kind: "xpath", value: "(//button)[2]" },
  },
  {
    name: "case-insensitive XPath prefix",
    input: "XpAtH=//iframe//button",
    query: { kind: "xpath", value: "//iframe//button" },
  },
  {
    name: "whitespace after XPath prefix",
    input: "xpath=  .//button ",
    query: { kind: "xpath", value: "  .//button" },
  },
  {
    name: "relative XPath requires a prefix",
    input: ".//button",
    query: { kind: "css", value: ".//button" },
  },
  {
    name: "explicit relative XPath",
    input: "xpath=.//button",
    query: { kind: "xpath", value: ".//button" },
  },
  {
    name: "malformed XPath is not validated here",
    input: "xpath=//button[",
    query: { kind: "xpath", value: "//button[" },
  },
  { name: "empty XPath payload", input: "xpath=", query: { kind: "xpath", value: "" } },
  // Frame routing handles these strings differently; see the next suite.
  {
    name: "CSS hops become descendant spaces at engine boundary",
    input: "iframe >> button",
    query: { kind: "css", value: "iframe button" },
  },
  {
    name: "CSS hop splitting is not quote-aware",
    input: 'css=[data-label="a >> b"]',
    query: { kind: "css", value: '[data-label="a b"]' },
  },
  {
    name: "empty CSS hop segments are discarded",
    input: " >> iframe >> >> button >> ",
    query: { kind: "css", value: "iframe button" },
  },
];

export const legacyRoutingCases: Array<{
  name: string;
  input: string;
  hops: string[];
  selector: string;
}> = [
  {
    name: "ordinary CSS stays in the current frame",
    input: " css=button ",
    hops: [],
    selector: "css=button",
  },
  {
    name: "text slash literals stay intact",
    input: 'text="https://example.com/a/b"',
    hops: [],
    selector: 'text="https://example.com/a/b"',
  },
  {
    name: "one explicit iframe hop",
    input: " iframe.checkout >> css=button ",
    hops: ["iframe.checkout"],
    selector: "css=button",
  },
  {
    name: "nested explicit iframe hops",
    input: "#outer >> iframe.inner >> text='Pay'",
    hops: ["#outer", "iframe.inner"],
    selector: "text='Pay'",
  },
  {
    name: "empty hop segments are ignored when multiple segments remain",
    input: " >> #outer >> >> #inner >> button >> ",
    hops: ["#outer", "#inner"],
    selector: "button",
  },
  {
    name: "a single remaining hop segment leaves the original string",
    input: " >> button >> ",
    hops: [],
    selector: ">> button >>",
  },
  {
    name: "empty input is not validated at this boundary",
    input: " \t ",
    hops: [],
    selector: "",
  },
  {
    name: "quoted text is still split on hop delimiters",
    input: 'text="a >> b"',
    hops: ['text="a'],
    selector: 'b"',
  },
  {
    name: "quoted CSS attributes are still split on hop delimiters",
    input: '[data-label="a >> b"]',
    hops: ['[data-label="a'],
    selector: 'b"]',
  },
  {
    name: "generated indexed iframe XPath",
    input: "/html/body/iframe[2]/html/body/button[3]",
    hops: ["xpath=/html/body/iframe[2]"],
    selector: "xpath=/html/body/button[3]",
  },
  {
    name: "nested frame XPath preserves descendant axes",
    input: "xpath=//iframe[2]//frame[1]//button[3]",
    hops: ["xpath=//iframe[2]", "xpath=//frame[1]"],
    selector: "xpath=//button[3]",
  },
  {
    name: "trailing iframe is an element target",
    input: "xpath=/html/body/iframe[2]",
    hops: [],
    selector: "xpath=/html/body/iframe[2]",
  },
  {
    name: "trailing frame after a hop remains a child-frame element",
    input: "//iframe[2]//frame[1]",
    hops: ["xpath=//iframe[2]"],
    selector: "xpath=//frame[1]",
  },
  {
    name: "shadow-hop XPath does not imply a frame hop",
    input: "xpath=/html/body/my-widget//button",
    hops: [],
    selector: "xpath=/html/body/my-widget//button",
  },
  {
    name: "XPath predicates retain slash literals",
    input: "xpath=//a[@href='/docs/start']",
    hops: [],
    selector: "xpath=//a[@href='/docs/start']",
  },
  {
    name: "attribute-qualified iframe is not recognized as a hop",
    input: "xpath=//iframe[@id='checkout']//button",
    hops: [],
    selector: "xpath=//iframe[@id='checkout']//button",
  },
  {
    name: "uppercase XPath prefix bypasses frame planning",
    input: "XPATH=//iframe//button",
    hops: [],
    selector: "XPATH=//iframe//button",
  },
  {
    name: "unprefixed parenthesized XPath bypasses frame planning",
    input: "(//iframe)[2]//button",
    hops: [],
    selector: "(//iframe)[2]//button",
  },
  {
    name: "prefixed relative XPath gains a leading slash",
    input: "xpath=.//button",
    hops: [],
    selector: "xpath=/.//button",
  },
  {
    name: "explicit hops take precedence over deep XPath in the final segment",
    input: "#outer >> xpath=//iframe//button",
    hops: ["#outer"],
    selector: "xpath=//iframe//button",
  },
  {
    name: "malformed XPath is passed on for evaluation",
    input: "xpath=//button[",
    hops: [],
    selector: "xpath=//button[",
  },
  {
    name: "empty XPath payload becomes the root path",
    input: "xpath=",
    hops: [],
    selector: "xpath=/",
  },
];

export const legacyXPathCases: Array<{
  name: string;
  input: string;
  steps: LegacyXPathStep[];
  rebuilt: string;
}> = [
  { name: "empty path rebuilds as root", input: "  ", steps: [], rebuilt: "/" },
  { name: "root has no steps", input: "/", steps: [], rebuilt: "/" },
  {
    name: "axes, case, and numeric predicates",
    input: " /HTML[1]//IFRAME[2]/button[3] ",
    steps: [
      { axis: "child", raw: "HTML[1]", name: "html" },
      { axis: "desc", raw: "IFRAME[2]", name: "iframe" },
      { axis: "child", raw: "button[3]", name: "button" },
    ],
    rebuilt: "/HTML[1]//IFRAME[2]/button[3]",
  },
  {
    name: "relative path is rebuilt with a leading slash",
    input: ".//button",
    steps: [
      { axis: "child", raw: ".", name: "." },
      { axis: "desc", raw: "button", name: "button" },
    ],
    rebuilt: "/.//button",
  },
  {
    name: "non-numeric predicates remain part of the step name",
    input: "//iframe[@id='checkout']//button",
    steps: [
      { axis: "desc", raw: "iframe[@id='checkout']", name: "iframe[@id='checkout']" },
      { axis: "desc", raw: "button", name: "button" },
    ],
    rebuilt: "//iframe[@id='checkout']//button",
  },
  {
    name: "slash literals are tokenized but reconstructed unchanged",
    input: "//a[@href='/docs/start']",
    steps: [
      { axis: "desc", raw: "a[@href='", name: "a[@href='" },
      { axis: "child", raw: "docs", name: "docs" },
      { axis: "child", raw: "start']", name: "start']" },
    ],
    rebuilt: "//a[@href='/docs/start']",
  },
  {
    name: "malformed predicates remain unvalidated",
    input: "//button[",
    steps: [{ axis: "desc", raw: "button[", name: "button[" }],
    rebuilt: "//button[",
  },
  {
    name: "empty slash segments and step whitespace are discarded",
    input: "/// html / body /",
    steps: [
      { axis: "child", raw: "html", name: "html" },
      { axis: "child", raw: "body", name: "body" },
    ],
    rebuilt: "/html/body",
  },
];
