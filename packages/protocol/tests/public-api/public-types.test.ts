import { describe, expectTypeOf, it } from "vite-plus/test";
import type { z } from "zod/v4";
import type * as Stagehand from "../../../server/types/public/index.js";

// Type-level manifest of all expected exported types
// Since these types don't exist at runtime, we currently need to manually add new publicly exported types
// to this list ourselves - it's not automatically going to catch changes like our export-surface.test.ts does.

// eslint-disable-next-line @typescript-eslint/no-unused-vars
type ExpectedExportedTypes = {
  // Types from model.ts
  AvailableModel: Stagehand.AvailableModel;
  ModelProvider: Stagehand.ModelProvider;
  VertexProviderOptions: Stagehand.VertexProviderOptions;
  AzureProviderOptions: Stagehand.AzureProviderOptions;
  ModelProviderOptions: Stagehand.ModelProviderOptions;
  ClientOptions: Stagehand.ClientOptions;
  ModelConfiguration: Stagehand.ModelConfiguration;
  LLMTool: Stagehand.LLMTool;
  // Types from methods.ts
  ActOptions: Stagehand.ActOptions;
  ActResultData: Stagehand.ActResultData;
  ActResult: Stagehand.ActResult;
  ExtractResult: Stagehand.ExtractResult<z.ZodType>;
  Action: Stagehand.Action;
  HistoryEntry: Stagehand.HistoryEntry;
  ExtractOptions: Stagehand.ExtractOptions;
  ObserveOptions: Stagehand.ObserveOptions;
  ObserveResult: Stagehand.ObserveResult;
  V3FunctionName: Stagehand.V3FunctionName;
  VariablePrimitive: Stagehand.VariablePrimitive;
  VariableValue: Stagehand.VariableValue;
  Variables: Stagehand.Variables;
  // Types from logs.ts
  LogLevel: Stagehand.LogLevel;
  LogLine: Stagehand.LogLine;
  // Types from metrics.ts
  StagehandMetrics: Stagehand.StagehandMetrics;
  // Types from options.ts
  V3Env: Stagehand.V3Env;
  LocalBrowserLaunchOptions: Stagehand.LocalBrowserLaunchOptions;
  V3Options: Stagehand.V3Options;
  // Types from page.ts
  LocatorCoordinates: Stagehand.LocatorCoordinates;
  PageLocator: Stagehand.PageLocator;
  Locator: Stagehand.Locator;
  ConsoleListener: Stagehand.ConsoleListener;
  LoadState: Stagehand.LoadState;
  // Types from cookies.ts
  Cookie: Stagehand.Cookie;
  CookieParam: Stagehand.CookieParam;
  ClearCookieOptions: Stagehand.ClearCookieOptions;
  // Types from clipboard.ts
  ClipboardOptions: Stagehand.ClipboardOptions;
  ClipboardPasteOptions: Stagehand.ClipboardPasteOptions;
  BrowserClipboard: Stagehand.BrowserClipboard;
};

describe("Stagehand public API types", () => {
  describe("PageLocator", () => {
    type ExpectedPageLocator = {
      pageIdx?: number | null;
      url?: string | null;
      title?: string | null;
      active?: boolean | null;
      targetId?: string | null;
      tabId?: number | null;
      frameId?: string | null;
    };

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.PageLocator>().toEqualTypeOf<ExpectedPageLocator>();
    });
  });

  describe("LocatorCoordinates", () => {
    type ExpectedLocatorCoordinates = {
      x?: number | null;
      y?: number | null;
      top?: number | null;
      left?: number | null;
      bottom?: number | null;
      right?: number | null;
    };

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.LocatorCoordinates>().toEqualTypeOf<ExpectedLocatorCoordinates>();
    });
  });

  describe("Locator", () => {
    type ExpectedLocator = {
      pageIdx?: number | null;
      url?: string | null;
      title?: string | null;
      active?: boolean | null;
      targetId?: string | null;
      tabId?: number | null;
      frameId?: string | null;
      idx?: number | null;
      frameIdx?: number | null;
      xpath?: string | null;
      css?: string | null;
      text?: string | null;
      reactElementName?: string | null;
      coordinates?: Stagehand.LocatorCoordinates | null;
      snapshotId?: string | null;
      elementId?: string | null;
    };

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.Locator>().toEqualTypeOf<ExpectedLocator>();
    });
  });

  describe("ModelProviderOptions", () => {
    type ExpectedModelProviderOptions =
      | {
          type: "vertex";
          options: Stagehand.VertexProviderOptions;
        }
      | {
          type: "azure";
          options: Stagehand.AzureProviderOptions;
        };

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.ModelProviderOptions>().toEqualTypeOf<ExpectedModelProviderOptions>();
    });
  });

  describe("ActOptions", () => {
    type ExpectedActOptions = {
      model?: Stagehand.ModelConfiguration;
      variables?: Stagehand.Variables;
      timeout?: number;
      locator?: Stagehand.Locator;
      serverCache?: boolean;
    };

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.ActOptions>().toEqualTypeOf<ExpectedActOptions>();
    });
  });

  describe("ActResult", () => {
    type ExpectedActResultData = {
      success: boolean;
      message: string;
      actionDescription: string;
      actions: Stagehand.Action[];
    };

    type ExpectedActResult = {
      result: ExpectedActResultData;
      actionId?: string;
      cacheStatus?: "HIT" | "MISS";
    };

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.ActResultData>().toEqualTypeOf<ExpectedActResultData>();
      expectTypeOf<Stagehand.ActResult>().toEqualTypeOf<ExpectedActResult>();
    });
  });

  describe("ExtractOptions", () => {
    type ExpectedExtractOptions = {
      model?: Stagehand.ModelConfiguration;
      timeout?: number;
      selector?: string;
      ignoreSelectors?: string[];
      screenshot?: boolean;
      locator?: Stagehand.Locator;
      serverCache?: boolean;
    };

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.ExtractOptions>().toEqualTypeOf<ExpectedExtractOptions>();
    });
  });

  describe("ObserveOptions", () => {
    type ExpectedObserveOptions = {
      model?: Stagehand.ModelConfiguration;
      variables?: Stagehand.Variables;
      timeout?: number;
      selector?: string;
      ignoreSelectors?: string[];
      locator?: Stagehand.Locator;
      serverCache?: boolean;
    };

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.ObserveOptions>().toEqualTypeOf<ExpectedObserveOptions>();
    });
  });

  describe("ObserveResult", () => {
    type ExpectedObserveResult = {
      result: Stagehand.Action[];
      actionId?: string;
      cacheStatus?: "HIT" | "MISS";
    };

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.ObserveResult>().toEqualTypeOf<ExpectedObserveResult>();
    });
  });

  describe("Action", () => {
    type ExpectedAction = {
      selector: string;
      description: string;
      method?: string;
      arguments?: string[];
    };

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.Action>().toEqualTypeOf<ExpectedAction>();
    });
  });

  describe("ClipboardOptions", () => {
    type ExpectedClipboardOptions = {
      locator?: Stagehand.PageLocator;
    };

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.ClipboardOptions>().toEqualTypeOf<ExpectedClipboardOptions>();
    });
  });

  describe("ClipboardPasteOptions", () => {
    type ExpectedClipboardPasteOptions = {
      locator?: Stagehand.PageLocator;
      shortcut?: "ControlOrMeta+V" | "Meta+V" | "Control+V";
    };

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.ClipboardPasteOptions>().toEqualTypeOf<ExpectedClipboardPasteOptions>();
    });
  });

  describe("BrowserClipboard", () => {
    type ExpectedBrowserClipboard = {
      readText(options?: Stagehand.ClipboardOptions): Promise<string>;
      writeText(text: string, options?: Stagehand.ClipboardOptions): Promise<void>;
      clear(options?: Stagehand.ClipboardOptions): Promise<void>;
      paste(options?: Stagehand.ClipboardPasteOptions): Promise<void>;
      copy(options?: Stagehand.ClipboardOptions): Promise<void>;
      cut(options?: Stagehand.ClipboardOptions): Promise<void>;
    };

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.BrowserClipboard>().toEqualTypeOf<ExpectedBrowserClipboard>();
    });
  });

  describe("HistoryEntry", () => {
    type ExpectedHistoryEntry = {
      method: "act" | "extract" | "observe" | "navigate";
      parameters: unknown;
      result: unknown;
      timestamp: string;
    };

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.HistoryEntry>().toEqualTypeOf<ExpectedHistoryEntry>();
    });
  });

  describe("Cookie", () => {
    type ExpectedCookie = {
      name: string;
      value: string;
      domain: string;
      path: string;
      expires: number;
      httpOnly: boolean;
      secure: boolean;
      sameSite: "Strict" | "Lax" | "None";
    };

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.Cookie>().toEqualTypeOf<ExpectedCookie>();
    });
  });

  describe("CookieParam", () => {
    type ExpectedCookieParam = {
      name: string;
      value: string;
      url?: string;
      domain?: string;
      path?: string;
      expires?: number;
      httpOnly?: boolean;
      secure?: boolean;
      sameSite?: "Strict" | "Lax" | "None";
    };

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.CookieParam>().toEqualTypeOf<ExpectedCookieParam>();
    });
  });

  describe("ClearCookieOptions", () => {
    type ExpectedClearCookieOptions = {
      name?: string;
      domain?: string;
      path?: string;
    };

    it("matches expected type shape", () => {
      expectTypeOf<Stagehand.ClearCookieOptions>().toEqualTypeOf<ExpectedClearCookieOptions>();
    });
  });
});
