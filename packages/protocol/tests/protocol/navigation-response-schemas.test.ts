import { describe, expect, it } from "vitest";
import { encodeWireValue, wireSchema } from "../../json-rpc/wire-casing.js";
import { StagehandMethods } from "../../schema-registry.js";
import {
  NavigationResponseDescriptorSchema,
  PageNavigationResultSchema,
  ResponseBodyResultSchema,
  ResponseFinishedResultSchema,
  ResponseSecurityDetailsResultSchema,
} from "../../schemas.js";

const descriptor = {
  responseId: "response-1",
  url: "https://example.test/final",
  status: 200,
  statusText: "OK",
  headers: {
    "content-type": "text/html",
    "X-Custom-Header": "value",
  },
  fromServiceWorker: false,
};

describe("navigation response protocol", () => {
  it("defines a strict, immediate-only response initializer", () => {
    expect(NavigationResponseDescriptorSchema.parse(descriptor)).toStrictEqual(descriptor);
    expect(() =>
      NavigationResponseDescriptorSchema.parse({
        ...descriptor,
        requestId: "cdp-request-1",
      }),
    ).toThrow();
    expect(() =>
      NavigationResponseDescriptorSchema.parse({
        ...descriptor,
        body: "eager-body",
      }),
    ).toThrow();
  });

  it("uses one nullable response envelope for every navigation method", () => {
    for (const method of [
      StagehandMethods.pageGoto,
      StagehandMethods.pageReload,
      StagehandMethods.pageGoBack,
      StagehandMethods.pageGoForward,
    ]) {
      expect(method.result).toBe(PageNavigationResultSchema);
      expect(
        method.result.parse({
          page: { pageId: "page-1", url: descriptor.url },
          response: descriptor,
        }),
      ).toStrictEqual({
        page: { pageId: "page-1", url: descriptor.url },
        response: descriptor,
      });
      expect(
        method.result.parse({
          page: { pageId: "page-1" },
          response: null,
        }),
      ).toStrictEqual({ page: { pageId: "page-1" }, response: null });
    }
  });

  it("preserves arbitrary header names across wire casing", () => {
    const result = {
      page: { pageId: "page-1" },
      response: descriptor,
    };
    const wireResult = encodeWireValue(result, StagehandMethods.pageGoto.resultWire);

    expect(wireResult).toMatchObject({
      page: { page_id: "page-1" },
      response: {
        response_id: "response-1",
        status_text: "OK",
        from_service_worker: false,
        headers: {
          "content-type": "text/html",
          "X-Custom-Header": "value",
        },
      },
    });
    expect(
      wireSchema(StagehandMethods.pageGoto.result, StagehandMethods.pageGoto.resultWire).parse(
        wireResult,
      ),
    ).toStrictEqual(result);
  });

  it("defines lazy response methods around the opaque handle", () => {
    const methods = [
      StagehandMethods.responseBody,
      StagehandMethods.responseAllHeaders,
      StagehandMethods.responseHeadersArray,
      StagehandMethods.responseSecurityDetails,
      StagehandMethods.responseServerAddr,
      StagehandMethods.responseFinished,
    ];

    for (const method of methods) {
      expect(method.params.parse({ responseId: "response-1" })).toStrictEqual({
        responseId: "response-1",
      });
      expect(() => method.params.parse({ responseId: "" })).toThrow();
    }

    expect(ResponseBodyResultSchema.parse({ body: "AAE=", base64Encoded: true })).toStrictEqual({
      body: "AAE=",
      base64Encoded: true,
    });
    expect(() => ResponseBodyResultSchema.parse({ body: "AAE=", base64Encoded: false })).toThrow();
    expect(
      ResponseSecurityDetailsResultSchema.parse({
        value: {
          issuer: "Example CA",
          protocol: "TLS 1.3",
          subjectName: "example.test",
          validFrom: 1,
          validTo: 2,
        },
      }),
    ).toBeDefined();
    expect(ResponseFinishedResultSchema.parse({ error: null })).toStrictEqual({ error: null });
    expect(ResponseFinishedResultSchema.parse({ error: { message: "failed" } })).toStrictEqual({
      error: { message: "failed" },
    });
  });
});
