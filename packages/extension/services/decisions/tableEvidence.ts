import { parseOutline } from "./outline.js";
import type { HybridSnapshot } from "../../types/private/snapshot.js";

export type TableScope = { years?: [number, number] };
export type ColumnCell = { text: string; beforeLink: string };
export type TableEvidence = {
  title: string;
  headers: string[];
  rows: ColumnCell[][];
  groups: { year: number; table: number; firstRecord: number }[];
  tableSizes: number[];
  positions: [number, number][];
  markers: [number, number, string[]][];
};

// Runs in the page. Keep cell layout until a projection is selected so inline text stays intact.
export function readTableEvidence(scope: TableScope): TableEvidence | null {
  const visible = (e: Element) =>
    e.checkVisibility({ opacityProperty: true, visibilityProperty: true }) &&
    !e.closest('[hidden],[inert],[aria-hidden="true" i]') &&
    e.getClientRects().length > 0;
  if (
    document.readyState === "loading" ||
    document.contentType !== "text/html" ||
    [...document.querySelectorAll("iframe,frame,object,embed")].some(visible) ||
    document.querySelector(
      '[role~="table" i],[role~="grid" i],[role~="row" i],[aria-rowcount],[aria-rowindex]',
    )
  )
    return null;
  const tables = [...document.querySelectorAll("table")].filter(
    (t) => !t.parentElement?.closest("table"),
  );
  if (!tables.length || tables.length > 32 || (!scope.years && tables.length !== 1)) return null;
  const years = new Set<number>();
  const rows: ColumnCell[][] = [];
  const groups: TableEvidence["groups"] = [];
  let headers: string[] = [];
  let size = 0;
  const clean = (s: string) => s.replace(/\s+/gu, " ").trim();
  const positions: [number, number][] = [];
  const markers: [number, number, string[]][] = [];
  let previousBottom = -Infinity;
  for (const [tableIndex, table] of tables.entries()) {
    if (!visible(table) || table.rows.length > 512) return null;
    let selected = !scope.years;
    let sectionRows = 0;
    let needsHeader = true;
    let year: number | undefined;
    for (const row of table.rows) {
      // The DOM and accessibility tree may agree even when CSS reorders the rows.
      const bounds = row.getBoundingClientRect();
      if (bounds.height <= 0 || bounds.top < previousBottom) return null;
      previousBottom = bounds.bottom;
      const cells = [...row.cells];
      if (
        scope.years &&
        cells.length === 1 &&
        cells[0]!.colSpan > 1 &&
        /^\d{4}$/.test(cells[0]!.innerText.trim())
      ) {
        if (selected && !sectionRows) return null;
        year = Number(cells[0]!.innerText.trim());
        if (years.has(year) || !visible(cells[0]!)) return null;
        years.add(year);
        markers.push([tableIndex, row.rowIndex, [String(year)]]);
        selected = year >= scope.years[0] && year <= scope.years[1];
        needsHeader = true;
        sectionRows = 0;
        continue;
      }
      if (scope.years && year === undefined) return null;
      if (!selected) continue;
      if (
        cells.length < 2 ||
        cells.length > 12 ||
        cells.some((c) => c.colSpan !== 1 || c.rowSpan !== 1 || !visible(c))
      )
        return null;
      if (needsHeader) {
        if (!scope.years && cells.some((c) => c.tagName !== "TH")) return null;
        const labels = cells.map((c) => clean(c.innerText));
        if (
          labels.some((s) => !s || s.length > 100) ||
          new Set(labels).size !== labels.length ||
          (headers.length && JSON.stringify(headers) !== JSON.stringify(labels))
        )
          return null;
        markers.push([tableIndex, row.rowIndex, labels]);
        headers = labels;
        needsHeader = false;
        if (year !== undefined) groups.push({ year, table: tableIndex, firstRecord: rows.length });
        continue;
      }
      if (
        cells.length !== headers.length ||
        cells.every((c) => c.tagName === "TH") ||
        cells.every((c, i) => clean(c.innerText) === headers[i]) ||
        cells.some(
          (c) => c.closest("thead,tfoot") || c.querySelector("table,input,textarea,select,button"),
        )
      )
        return null;
      const values: ColumnCell[] = [];
      for (const cell of cells) {
        const text = cell.innerText;
        if (!text.trim() || text.length > 6000) return null;
        // Preformatted cells can encode columns with spaces, outside these line-based rules.
        if (
          [cell, ...cell.querySelectorAll("*")].some(
            (el) => !["normal", "nowrap"].includes(getComputedStyle(el).whiteSpace),
          )
        )
          return null;
        const lines = text.split("\n");
        const links = new Set(
          [...cell.querySelectorAll("a")].filter(visible).map((a) => a.innerText),
        );
        const cut = lines.findIndex((line) => links.has(line));
        const label = lines[cut];
        // An earlier occurrence of the link label may be plain text.
        if (label && text.indexOf(label) !== text.lastIndexOf(label)) return null;
        // Keep the prefix byte-for-byte, removing only the break(s) separating the link.
        const beforeLink = cut > 0 ? lines.slice(0, cut).join("\n").replace(/\n+$/u, "") : text;
        values.push({ text, beforeLink });
        size += text.length;
      }
      positions.push([tableIndex, row.rowIndex]);
      rows.push(values);
      sectionRows++;
      if (rows.length > 128 || size > 64000) return null;
    }
    if (selected && !sectionRows) return null;
  }
  if (scope.years)
    for (let y = scope.years[0]; y <= scope.years[1]; y++) if (!years.has(y)) return null;
  return rows.length
    ? {
        headers,
        rows,
        groups,
        positions,
        markers,
        tableSizes: tables.map((t) => t.rows.length),
        title: document.title,
      }
    : null;
}

export function tableContext(
  snapshot: HybridSnapshot,
  evidence: TableEvidence,
): string[] | undefined {
  const outside: string[] = [];
  const tables: string[][][] = [];
  const byPath = new Map<string, number>();
  const rowByPath = new Map<string, string[]>();
  for (const node of parseOutline(snapshot.combinedTree)) {
    const path = snapshot.combinedXpathMap[node.id] ?? "";
    if (
      (/^(?:button|link)$/i.test(node.role) &&
        /^(?:next(?: page)?|load more|show more(?: results| rows)?|›|»|→)$/iu.test(node.name)) ||
      /\b(?:showing|displaying)\s+\d+\s*(?:to|[-–])\s*\d+\s+(?:of|out of)\s+\d+/iu.test(node.name)
    )
      return;
    if (node.role === "grid" || (node.role === "table" && !/\/table\[\d+\]$/.test(path))) return;
    if (!path.includes("/table[")) {
      if (node.name && outside.at(-1) !== node.name) outside.push(node.name);
      continue;
    }
    if (path.indexOf("/table[") !== path.lastIndexOf("/table[")) continue;
    if (/\/table\[\d+\]$/.test(path) && /^(?:table|layouttable)$/i.test(node.role)) {
      outside.push(`[Table ${tables.length}: ${node.name}]`);
      byPath.set(path, tables.length);
      tables.push([]);
    } else if (node.role === "row") {
      const owner = path.match(
        /^(.*\/table\[\d+\])\/(?:t(?:body|head|foot)\[\d+\]\/)?tr\[\d+\]$/,
      )?.[1];
      const index = owner && byPath.get(owner);
      if (typeof index !== "number") return;
      const row: string[] = [];
      tables[index]!.push(row);
      rowByPath.set(path, row);
    } else if (["cell", "rowheader", "columnheader"].includes(node.role)) {
      const row = rowByPath.get(path.replace(/\/t[dh]\[\d+\]$/, ""));
      if (!row) return;
      row.push(node.name);
    }
  }
  if (
    tables.length !== evidence.tableSizes.length ||
    tables.some((t, i) => t.length !== evidence.tableSizes[i])
  )
    return;
  // The accessibility tree flattens whitespace. Use that equivalence only for corroboration.
  const same = (a: string, b: string) =>
    a.replace(/\s+/gu, " ").trim() === b.replace(/\s+/gu, " ").trim();
  const matches = (t: number, r: number, values: string[]) => {
    const cells = tables[t]?.[r];
    return cells?.length === values.length && values.every((v, i) => same(v, cells[i]!));
  };
  const matchesAll =
    evidence.markers.every(([t, r, v]) => matches(t, r, v)) &&
    evidence.positions.every(([t, r], i) =>
      matches(
        t,
        r,
        evidence.rows[i]!.map((c) => c.text),
      ),
    );
  return matchesAll ? outside : undefined;
}
