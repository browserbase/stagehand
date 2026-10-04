import { expect, test } from "vitest";
import { answerStructure } from "../src/answerStructure.js";

test("classifies answer structures per the table ruling", () => {
  expect(answerStructure("| a | b |\n| --- | --- |\n| 1 | 2 |")).toBe("markdown-table");
  expect(answerStructure("<table><tr><td>1</td></tr></table>")).toBe("html-table");
  expect(answerStructure("brand | price\nLE | $16.50\nMRM | $19.99")).toBe("multiline-pipe-rows");
  expect(answerStructure("brand,price,iu\nLE,$16.50,5000\nMRM,$19.99,5000")).toBe("csv-rows");
  expect(
    answerStructure(
      "Table: PetSmart 4lb $20.68 | 16lb $54.99 | 30lb $77.99 | Amazon 40lb $94.99 | done",
    ),
  ).toBe("inline-delimited");
  expect(answerStructure("A: fee $30, pass $55; B: fee $55, pass $0")).toBe("inline-delimited");
  expect(
    answerStructure(
      "Table: PetSmart 4 lb $20.68 (list $21.99 crossed out) = $5.17/lb ($5.50/lb at list); PetSmart 16 lb $54.99 = $3.44/lb; PetSmart 30 lb $77.99 = $2.60/lb; Amazon 41 lb $148.49 = $3.62/lb (largest size)",
    ),
  ).toBe("inline-delimited");
  expect(answerStructure("")).toBe("empty");
});

test("rejects prose that merely mentions tables, links, or ends sentences with semicolons", () => {
  expect(answerStructure("The page had a <table of prices but I could not read it.")).toBe("prose");
  expect(
    answerStructure(
      "See https://a.com/x:1,2; https://b.com/y:3,4; https://c.com/z:5,6 for details.",
    ),
  ).toBe("prose");
  expect(
    answerStructure(
      "FEES: vehicle = $30.00; Annual Pass = $55.00 (nps.gov). AVAILABILITY: NO site is open on all three nights; several sites (A058, A062) are open Thu; the loop is generator prohibited; totals follow.",
    ),
  ).toBe("prose");
  expect(
    answerStructure(
      "First, I searched the site.\nThen, I opened the product page, which listed the price.\nFinally, I stopped at the cart.",
    ),
  ).toBe("prose");
});

test("unwraps JSON-fenced answers before classifying", () => {
  const wrapped =
    '```json\n{"success": true, "finalAnswer": "| Item | Details |\\n| --- | --- |\\n| Program | Ranger Walk |"}\n```';
  expect(answerStructure(wrapped)).toBe("markdown-table");
});

test("rubricRequiresTable detects table deliverables", async () => {
  const { rubricRequiresTable } = await import("../src/answerStructure.js");
  expect(
    rubricRequiresTable({
      items: [
        {
          criterion: "Deliverable shape",
          description: "The final answer is a table with one row per retailer",
        },
      ],
    }),
  ).toBe(true);
  expect(
    rubricRequiresTable({ items: [{ criterion: "Price", description: "Report the price" }] }),
  ).toBe(false);
});

test("appended v1.2 convention text does not create a table requirement", async () => {
  const { rubricRequiresTable } = await import("../src/answerStructure.js");
  expect(
    rubricRequiresTable({
      items: [
        {
          criterion: "Cheapest bed",
          description:
            "Pick the cheapest qualifying bed. Source convention: a value about a retailer must come from that entity's own page; another company's comparison table is not an authoritative source.",
        },
      ],
    }),
  ).toBe(false);
  expect(
    rubricRequiresTable({
      items: [
        {
          criterion: "Deliverable",
          description:
            "No credit if no table. Format convention: any consistent delimited structure counts.",
        },
      ],
    }),
  ).toBe(true);
});

test("JSON deliverables with record arrays or field/value objects count as structured", () => {
  expect(
    answerStructure(
      '{"rows":[{"retailer":"PetSmart","price":20.68},{"retailer":"Amazon","price":94.99}]}',
    ),
  ).toBe("json-records");
  expect(
    answerStructure(
      '{"course":"18.06","instructor":"Strang","textbook":"Intro to Linear Algebra","isbn":"9780980232714"}',
    ),
  ).toBe("json-records");
  expect(answerStructure('{"answer":"The cheapest park is Huron-Manistee"}')).toBe("prose");
  expect(
    answerStructure(
      '{"event":"Bill Burr Live","date":"Oct 3","parking_price":"$11","hotel":"SI Resorts"} Done.',
    ),
  ).toBe("json-records");
});
