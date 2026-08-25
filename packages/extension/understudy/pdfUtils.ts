import type { Protocol } from "devtools-protocol";
import type { PagePdfOptions } from "../../protocol/types.js";

// Paper sizes in inches, mirroring Playwright's page.pdf() formats.
const PAPER_FORMATS: Record<string, { width: number; height: number }> = {
  letter: { width: 8.5, height: 11 },
  legal: { width: 8.5, height: 14 },
  tabloid: { width: 11, height: 17 },
  ledger: { width: 17, height: 11 },
  a0: { width: 33.1, height: 46.8 },
  a1: { width: 23.4, height: 33.1 },
  a2: { width: 16.5, height: 23.4 },
  a3: { width: 11.7, height: 16.5 },
  a4: { width: 8.27, height: 11.7 },
  a5: { width: 5.83, height: 8.27 },
  a6: { width: 4.13, height: 5.83 },
};

const CSS_PIXELS_PER_INCH = 96;

// Multipliers converting a known CSS length suffix to inches.
const LENGTH_UNITS: Record<string, number> = {
  px: 1 / CSS_PIXELS_PER_INCH,
  in: 1,
  cm: 1 / 2.54,
  mm: 1 / 25.4,
};

export function pdfLengthToInches(value: number | string): number {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError("pdf: length must be a finite number or px/in/cm/mm string");
    }
    return value / CSS_PIXELS_PER_INCH;
  }

  // Playwright-style parsing: a recognized two-character suffix selects the
  // unit (case-insensitive) and the rest goes through Number(), accepting
  // forms like ".5in" or "1e2px". Unknown suffixes are rejected rather than
  // falling back to pixels ("10pt" is an error, unlike in Playwright).
  const suffix = value.slice(-2).toLowerCase();
  const hasUnit = suffix in LENGTH_UNITS;
  const amountText = hasUnit ? value.slice(0, -2) : value;
  if (amountText.trim() === "") {
    throw new TypeError(`pdf: invalid length "${value}" (expected px/in/cm/mm units)`);
  }
  const amount = Number(amountText);
  if (!Number.isFinite(amount)) {
    throw new TypeError(`pdf: invalid length "${value}" (expected px/in/cm/mm units)`);
  }
  return amount * (hasUnit ? LENGTH_UNITS[suffix] : LENGTH_UNITS.px);
}

export type PrintToPDFParams = Protocol.Page.PrintToPDFRequest & {
  generateTaggedPDF?: boolean;
  generateDocumentOutline?: boolean;
};

export function buildPrintToPDFParams(options: PagePdfOptions): PrintToPDFParams {
  const params: PrintToPDFParams = {};

  params.printBackground = options.printBackground ?? false;
  params.displayHeaderFooter = options.displayHeaderFooter ?? false;
  params.landscape = options.landscape ?? false;
  params.scale = options.scale ?? 1;

  if (options.headerTemplate !== undefined) {
    params.headerTemplate = options.headerTemplate;
  }
  if (options.footerTemplate !== undefined) {
    params.footerTemplate = options.footerTemplate;
  }
  if (options.pageRanges !== undefined) {
    params.pageRanges = options.pageRanges;
  }
  if (options.preferCssPageSize !== undefined) {
    params.preferCSSPageSize = options.preferCssPageSize;
  }
  if (options.tagged !== undefined) {
    params.generateTaggedPDF = options.tagged;
  }
  if (options.outline !== undefined) {
    params.generateDocumentOutline = options.outline;
  }

  // Playwright parity (crPdf.ts): a format wins entirely and ignores
  // explicit width/height; without one, letter defaults are overridden per
  // axis. Falsy inch values fall back to the default like Playwright's
  // `|| default` coercion.
  let paperWidth = 8.5;
  let paperHeight = 11;
  if (options.format !== undefined) {
    const format = PAPER_FORMATS[options.format];
    if (!format) {
      throw new TypeError(`pdf: unsupported paper format "${options.format}"`);
    }
    paperWidth = format.width;
    paperHeight = format.height;
  } else {
    if (options.width !== undefined) {
      paperWidth = pdfLengthToInches(options.width) || paperWidth;
    }
    if (options.height !== undefined) {
      paperHeight = pdfLengthToInches(options.height) || paperHeight;
    }
  }
  params.paperWidth = paperWidth;
  params.paperHeight = paperHeight;

  const margin = options.margin ?? {};
  params.marginTop = margin.top !== undefined ? pdfLengthToInches(margin.top) : 0;
  params.marginBottom = margin.bottom !== undefined ? pdfLengthToInches(margin.bottom) : 0;
  params.marginLeft = margin.left !== undefined ? pdfLengthToInches(margin.left) : 0;
  params.marginRight = margin.right !== undefined ? pdfLengthToInches(margin.right) : 0;

  return params;
}
