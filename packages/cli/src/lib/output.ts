import { Flags } from "@oclif/core";

export type OutputFormat = "json" | "table";

export interface OutputFormatFlags {
  format?: string;
  json?: boolean;
  wide?: boolean;
}

export const outputFormatFlags = {
  format: Flags.string({
    description:
      "Output format. Defaults to table in a terminal and JSON when piped.",
    helpValue: "<format>",
    options: ["table", "json"],
  }),
  json: Flags.boolean({
    description: "Print raw JSON output.",
  }),
  wide: Flags.boolean({
    description: "Show full table values without truncation.",
  }),
};

export function outputJson(value: unknown): void {
  console.log(JSON.stringify(value, null, 2));
}

export function formatUtcDateTime(value: string | undefined): string {
  if (!value) {
    return "-";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return `${date.toISOString().slice(0, 16).replace("T", " ")}Z`;
}

export function formatId(value: string | undefined, wide?: boolean): string {
  if (!value) {
    return "-";
  }

  return wide ? value : value.slice(0, 8);
}

export function resolveOutputFormat(flags: OutputFormatFlags): OutputFormat {
  if (flags.json) {
    return "json";
  }

  if (flags.format) {
    return flags.format === "table" ? "table" : "json";
  }

  return process.stdout.isTTY ? "table" : "json";
}

export interface TableColumn<Row> {
  align?: "left" | "right";
  header: string;
  maxWidth?: number;
  value(row: Row): unknown;
}

export function outputTable<Row>(
  rows: Row[],
  columns: TableColumn<Row>[],
  options: { wide?: boolean } = {},
): void {
  console.log(formatTable(rows, columns, options));
}

export function formatTable<Row>(
  rows: Row[],
  columns: TableColumn<Row>[],
  options: { wide?: boolean } = {},
): string {
  const renderedRows = rows.map((row) =>
    columns.map((column) =>
      formatTableCell(column.value(row), {
        maxWidth: options.wide ? undefined : column.maxWidth,
      }),
    ),
  );

  const widths = columns.map((column, index) => {
    const maxContentWidth = Math.max(
      column.header.length,
      ...renderedRows.map((row) => row[index]?.length ?? 0),
    );
    return options.wide || !column.maxWidth
      ? maxContentWidth
      : Math.min(maxContentWidth, column.maxWidth);
  });

  const lines = [
    columns
      .map((column, index) =>
        padTableCell(column.header, widths[index]!, column.align),
      )
      .join("  ")
      .trimEnd(),
    columns.map((_, index) => "-".repeat(widths[index]!)).join("  "),
    ...renderedRows.map((row) =>
      row
        .map((cell, index) =>
          padTableCell(cell, widths[index]!, columns[index]?.align),
        )
        .join("  ")
        .trimEnd(),
    ),
  ];

  return lines.join("\n");
}

function formatTableCell(
  value: unknown,
  options: { maxWidth?: number } = {},
): string {
  const text =
    value === null || value === undefined || value === "" ? "-" : String(value);
  if (!options.maxWidth || text.length <= options.maxWidth) {
    return text;
  }

  if (options.maxWidth <= 3) {
    return text.slice(0, options.maxWidth);
  }

  return `${text.slice(0, options.maxWidth - 3)}...`;
}

function padTableCell(
  value: string,
  width: number,
  align: "left" | "right" = "left",
): string {
  return align === "right" ? value.padStart(width) : value.padEnd(width);
}
