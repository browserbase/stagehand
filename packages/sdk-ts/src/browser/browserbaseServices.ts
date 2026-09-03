import Browserbase from "@browserbasehq/sdk";
import {
  BrowserbaseFetchResultSchema,
  BrowserbaseSearchResultSchema,
  type BrowserbaseFetchResult,
  type BrowserbaseSearchResult,
} from "../clientSchemas.js";

export type BrowserbaseSearchParams = {
  query: string;
  numResults?: number;
};

export type BrowserbaseFetchParams = {
  url: string;
  allowInsecureSsl?: boolean;
  allowRedirects?: boolean;
  format?: "raw" | "json" | "markdown";
  proxies?: boolean;
  schema?: Record<string, unknown>;
};

export type BrowserbaseServicesClient = {
  search(params: BrowserbaseSearchParams): Promise<BrowserbaseSearchResult>;
  fetch(params: BrowserbaseFetchParams): Promise<BrowserbaseFetchResult>;
};

type BrowserbaseSdk = {
  search: {
    web(params: BrowserbaseSearchParams): Promise<unknown>;
  };
  fetchAPI: {
    create(params: BrowserbaseFetchParams): Promise<unknown>;
  };
};
type BrowserbaseSdkFactory = (apiKey: string, baseUrl: string) => BrowserbaseSdk;

export function createBrowserbaseServicesClient(
  apiKey: string,
  baseUrl: string,
  createSdk: BrowserbaseSdkFactory = (key, baseURL) => new Browserbase({ apiKey: key, baseURL }),
): BrowserbaseServicesClient {
  const sdk = createSdk(apiKey, baseUrl);
  return {
    async search(params) {
      return BrowserbaseSearchResultSchema.parse(await sdk.search.web(params));
    },
    async fetch(params) {
      return BrowserbaseFetchResultSchema.parse(await sdk.fetchAPI.create(params));
    },
  };
}
