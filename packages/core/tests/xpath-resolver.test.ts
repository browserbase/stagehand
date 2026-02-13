// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  countXPathMatches,
  resolveXPathAtIndex,
} from "../lib/v3/dom/locatorScripts/xpathResolver";

describe("xpathResolver composed traversal", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("counts matches across light + shadow DOM without double counting", () => {
    document.body.innerHTML =
      '<div id="light-1"></div>' +
      '<shadow-host id="host"></shadow-host>' +
      '<div id="light-2"></div>';

    const host = document.getElementById("host") as HTMLElement;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<div id="shadow-1"></div><div id="shadow-2"></div>';

    expect(countXPathMatches("//div")).toBe(4);
  });

  it("resolves nth over composed tree in document-order DFS", () => {
    document.body.innerHTML =
      '<div id="light-1"></div>' +
      '<shadow-host id="host"></shadow-host>' +
      '<div id="light-2"></div>';

    const host = document.getElementById("host") as HTMLElement;
    const shadow = host.attachShadow({ mode: "open" });
    shadow.innerHTML = '<div id="shadow-1"></div><div id="shadow-2"></div>';

    expect(resolveXPathAtIndex("//div", 0)?.id).toBe("light-1");
    expect(resolveXPathAtIndex("//div", 1)?.id).toBe("shadow-1");
    expect(resolveXPathAtIndex("//div", 2)?.id).toBe("shadow-2");
    expect(resolveXPathAtIndex("//div", 3)?.id).toBe("light-2");
  });
});
