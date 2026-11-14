import { describe, expect, it } from "vitest";

import { formatTable, type TableColumn } from "../src/lib/output.js";

interface Row {
  id: string;
  pages: string;
}

const columns: TableColumn<Row>[] = [
  { header: "Session Identifier", maxWidth: 8, value: (row) => row.id },
  { align: "right", header: "Pages", value: (row) => row.pages },
];

const rows: Row[] = [{ id: "3f9a1c2d4e5f6a7b", pages: "12" }];

describe("formatTable column widths", () => {
  it("keeps the header and every row on one width when a header exceeds the column cap", () => {
    const lines = formatTable(rows, columns).split("\n");

    expect(lines[0]).toBe("Session Identifier  Pages");
    expect(lines[1]).toBe("------------------  -----");
    expect(lines[2]?.length).toBe(lines[0]?.length);
  });

  it("still truncates the cell value to the column cap", () => {
    const line = formatTable(rows, columns).split("\n")[2] ?? "";

    expect(line.startsWith("3f9a1...")).toBe(true);
    expect(line.trimEnd().endsWith("12")).toBe(true);
  });

  it("renders full values and widths when wide output is requested", () => {
    const lines = formatTable(rows, columns, { wide: true }).split("\n");

    expect(lines[1]).toBe("------------------  -----");
    expect(lines[2]?.startsWith("3f9a1c2d4e5f6a7b")).toBe(true);
    expect(lines[2]?.length).toBe(lines[0]?.length);
  });
});
