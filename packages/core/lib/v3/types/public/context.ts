/** A cookie as returned by the browser. */
export interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  /** Unix time in seconds. -1 means session cookie. */
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

/** Parameters for setting a cookie. Provide `url` OR `domain`+`path`, not both. */
export interface CookieParam {
  name: string;
  value: string;
  /** Convenience: if provided, domain/path/secure are derived from this URL. */
  url?: string;
  domain?: string;
  path?: string;
  /** Unix timestamp in seconds. -1 or omitted = session cookie. */
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

/** Filter options for clearing cookies selectively. */
export interface ClearCookieOptions {
  name?: string | RegExp;
  domain?: string | RegExp;
  path?: string | RegExp;
}
