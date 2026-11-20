import { describe, expect, it } from "vitest";

import { normalizeUrlScheme } from "../src/lib/normalize-url.js";

describe("normalizeUrlScheme", () => {
  it("prefixes https:// for bare domain", () => {
    expect(normalizeUrlScheme("example.com")).toBe("https://example.com");
  });

  it("prefixes http:// for localhost with port", () => {
    expect(normalizeUrlScheme("localhost:3000")).toBe("http://localhost:3000");
  });

  it("prefixes http:// for 127.0.0.1 with path", () => {
    expect(normalizeUrlScheme("127.0.0.1:8080/x")).toBe("http://127.0.0.1:8080/x");
  });

  it("leaves about:blank unchanged", () => {
    expect(normalizeUrlScheme("about:blank")).toBe("about:blank");
  });

  it("leaves file:// URLs unchanged", () => {
    expect(normalizeUrlScheme("file:///x")).toBe("file:///x");
  });

  it("leaves non-URL strings unchanged", () => {
    expect(normalizeUrlScheme("not a url")).toBe("not a url");
  });

  it("leaves https:// URLs unchanged", () => {
    expect(normalizeUrlScheme("https://example.com")).toBe("https://example.com");
  });

  it("leaves http:// URLs unchanged", () => {
    expect(normalizeUrlScheme("http://localhost:3000")).toBe("http://localhost:3000");
  });

  it("prefixes https:// for IP addresses (non-localhost)", () => {
    expect(normalizeUrlScheme("192.168.1.1:8080")).toBe("https://192.168.1.1:8080");
  });

  it("prefixes https:// for subdomains", () => {
    expect(normalizeUrlScheme("www.example.com/path")).toBe("https://www.example.com/path");
  });

  it("leaves bare words without dots unchanged", () => {
    expect(normalizeUrlScheme("notadomain")).toBe("notadomain");
  });

  it("prefixes http:// for plain localhost", () => {
    expect(normalizeUrlScheme("localhost")).toBe("http://localhost");
  });

  it("prefixes http:// for plain 127.0.0.1", () => {
    expect(normalizeUrlScheme("127.0.0.1")).toBe("http://127.0.0.1");
  });

  it("prefixes http:// for localhost with query string", () => {
    expect(normalizeUrlScheme("localhost?x=1")).toBe("http://localhost?x=1");
  });

  it("prefixes http:// for 127.0.0.1 with query string", () => {
    expect(normalizeUrlScheme("127.0.0.1?x=1")).toBe("http://127.0.0.1?x=1");
  });

  it("prefixes http:// for uppercase LOCALHOST", () => {
    expect(normalizeUrlScheme("LOCALHOST:3000")).toBe("http://LOCALHOST:3000");
  });

  it("prefixes https:// for uppercase domain", () => {
    expect(normalizeUrlScheme("EXAMPLE.COM")).toBe("https://EXAMPLE.COM");
  });
});
