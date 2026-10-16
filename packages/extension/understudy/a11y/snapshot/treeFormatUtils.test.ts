import { describe, expect, it } from "vitest";
import type { A11yNode } from "../../../types/private/snapshot.js";
import { formatTreeLine } from "./treeFormatUtils.js";

function line(node: Partial<A11yNode>): string {
  return formatTreeLine({ role: "textbox", nodeId: "1", encodedId: "0-12", ...node });
}

describe("formatTreeLine values", () => {
  it("prints the value after the name and before the state flags", () => {
    expect(line({ name: "Email", value: "a@b.co" })).toBe('[0-12] textbox: Email = "a@b.co"');
    expect(line({ role: "combobox", value: "Banana", selected: true })).toBe(
      '[0-12] combobox = "Banana" [selected]',
    );
  });

  it("prints numbers unquoted", () => {
    expect(line({ role: "slider", name: "Volume", value: 3 })).toBe("[0-12] slider: Volume = 3");
    expect(line({ role: "progressbar", value: Number.NaN })).toBe("[0-12] progressbar");
  });

  it("quotes values so multi-line text stays on one outline line", () => {
    expect(line({ name: "Notes", value: 'line one\nline "two"' })).toBe(
      '[0-12] textbox: Notes = "line one\\nline \\"two\\""',
    );
  });

  it("prints a date or time input's format with the state flags", () => {
    expect(line({ role: "Date", name: "Birthday", format: "YYYY-MM-DD" })).toBe(
      "[0-12] Date: Birthday [format: YYYY-MM-DD]",
    );
    expect(
      line({
        role: "DateTime",
        name: "Meeting",
        value: "2025-07-23T10:00",
        format: "YYYY-MM-DDThh:mm",
      }),
    ).toBe('[0-12] DateTime: Meeting = "2025-07-23T10:00" [format: YYYY-MM-DDThh:mm]');
  });

  it("prints a media element's playback state", () => {
    expect(line({ role: "Video", media: { paused: true, muted: false } })).toBe(
      "[0-12] Video [paused]",
    );
    expect(line({ role: "Audio", media: { paused: false, muted: true } })).toBe(
      "[0-12] Audio [playing] [muted]",
    );
  });

  it("leaves out empty values, values that repeat the name, and booleans", () => {
    expect(line({ name: "Search", value: "  " })).toBe("[0-12] textbox: Search");
    expect(line({ role: "button", name: "Send", value: "Send" })).toBe("[0-12] button: Send");
    expect(line({ role: "checkbox", name: "Agree", value: true, checked: true })).toBe(
      "[0-12] checkbox: Agree [checked]",
    );
  });
});
