import Browserbase from "@browserbasehq/sdk";

export type BrowserbaseSessionCreateParams = Omit<
  Browserbase.Sessions.SessionCreateParams,
  "projectId"
> & { projectId?: string };

export const DEFAULT_BROWSERBASE_VIEWPORT = {
  width: 1288,
  height: 711,
} as const;

export function applyDefaultBrowserSettingsViewport(
  params?: BrowserbaseSessionCreateParams,
): BrowserbaseSessionCreateParams {
  const paramsWithDefaults = {
    ...(params ?? {}),
  } as BrowserbaseSessionCreateParams;

  const viewport = paramsWithDefaults.browserSettings?.viewport ?? {
    width: DEFAULT_BROWSERBASE_VIEWPORT.width,
    height: DEFAULT_BROWSERBASE_VIEWPORT.height,
  };

  return {
    ...paramsWithDefaults,
    browserSettings: {
      ...(paramsWithDefaults.browserSettings ?? {}),
      viewport,
    },
  };
}
