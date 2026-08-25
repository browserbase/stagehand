import { describe, expect, it } from "vitest";
import { buildPrintToPDFParams, pdfLengthToInches } from "../understudy/pdfUtils.js";

describe("pdfLengthToInches", () => {
  it("treats bare numbers as CSS pixels", () => {
    expect(pdfLengthToInches(96)).toBeCloseTo(1);
    expect(pdfLengthToInches(48)).toBeCloseTo(0.5);
  });

  it("converts explicit units", () => {
    expect(pdfLengthToInches("1in")).toBeCloseTo(1);
    expect(pdfLengthToInches("96px")).toBeCloseTo(1);
    expect(pdfLengthToInches("2.54cm")).toBeCloseTo(1);
    expect(pdfLengthToInches("25.4mm")).toBeCloseTo(1);
  });

  it("rejects malformed lengths", () => {
    expect(() => pdfLengthToInches("10pt")).toThrow(TypeError);
    expect(() => pdfLengthToInches("wide")).toThrow(TypeError);
    expect(() => pdfLengthToInches(Number.NaN)).toThrow(TypeError);
  });
});

describe("buildPrintToPDFParams", () => {
  it("defaults to letter portrait with zero margins and no background", () => {
    expect(buildPrintToPDFParams({})).toStrictEqual({
      displayHeaderFooter: false,
      landscape: false,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
      marginTop: 0,
      paperHeight: 11,
      paperWidth: 8.5,
      printBackground: false,
      scale: 1,
    });
  });

  it("maps formats to paper sizes", () => {
    expect(buildPrintToPDFParams({ format: "a4" })).toMatchObject({
      paperWidth: 8.27,
      paperHeight: 11.7,
    });
  });

  it("rejects unknown formats", () => {
    expect(() => buildPrintToPDFParams({ format: "b5" as "a4" })).toThrow(TypeError);
  });

  it("lets explicit width and height override the format", () => {
    const params = buildPrintToPDFParams({ format: "a4", height: "11in", width: 408 });
    expect(params.paperHeight).toBeCloseTo(11);
    expect(params.paperWidth).toBeCloseTo(4.25);
  });

  it("converts margin lengths to inches and defaults missing sides to zero", () => {
    const params = buildPrintToPDFParams({
      margin: { top: "1cm", right: 24, bottom: "0.5in" },
    });
    expect(params.marginTop).toBeCloseTo(1 / 2.54);
    expect(params.marginRight).toBeCloseTo(0.25);
    expect(params.marginBottom).toBeCloseTo(0.5);
    expect(params.marginLeft).toBe(0);
  });

  it("passes print controls through to their CDP counterparts", () => {
    const params = buildPrintToPDFParams({
      displayHeaderFooter: true,
      footerTemplate: "<span class=pageNumber></span>",
      headerTemplate: "<span class=title></span>",
      landscape: true,
      outline: true,
      pageRanges: "1-5, 8",
      preferCssPageSize: true,
      printBackground: true,
      scale: 1.5,
      tagged: true,
    });
    expect(params).toStrictEqual({
      displayHeaderFooter: true,
      footerTemplate: "<span class=pageNumber></span>",
      generateDocumentOutline: true,
      generateTaggedPDF: true,
      headerTemplate: "<span class=title></span>",
      landscape: true,
      marginBottom: 0,
      marginLeft: 0,
      marginRight: 0,
      marginTop: 0,
      pageRanges: "1-5, 8",
      paperHeight: 11,
      paperWidth: 8.5,
      preferCSSPageSize: true,
      printBackground: true,
      scale: 1.5,
    });
  });
});
