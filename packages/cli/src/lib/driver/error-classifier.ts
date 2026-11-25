import { DriverError } from "./errors.js";

const ELEMENT_NOT_FOUND_PATTERN = /^Could not find an element for the given xPath\(s\): (.*)$/;

const WAIT_FOR_SELECTOR_TIMEOUT_PATTERN = /waitForSelector timed out after \d+ms/;

const RPC_NAVIGATION_TIMEOUT_PATTERN =
  /RPC response timed out after \d+ms: page\.(goto|reload|go_back|go_forward)/;
const NAVIGATION_START_TIMEOUT_PATTERN = /Navigation start timed out after \d+ms/;

const RPC_PAGE_UNRESPONSIVE_PATTERN =
  /RPC response timed out after \d+ms: page\.(title|url|evaluate|screenshot)/;
const ENABLING_DOM_TIMEOUT_PATTERN = /timed out after \d+ms while enabling DOM/;

const INVALID_URL_PATTERN = /Cannot navigate to invalid URL/;

const RPC_CLIENT_CLOSED_PATTERN = /RPC client is closed/;

const CDP_UNREACHABLE_PATTERN = /Unable to resolve CDP endpoint from/;

const LAST_TAB_PATTERN = /^Cannot close the last tab\.$/;

/**
 * Classify a non-DriverError into a typed DriverError with a stable code.
 * Returns null if the error is not recognized and should remain `unexpected`.
 */
export function classifyDriverError(error: unknown): DriverError | null {
  const message = error instanceof Error ? error.message : String(error);

  const elementMatch = ELEMENT_NOT_FOUND_PATTERN.exec(message);
  if (elementMatch) {
    const selector = elementMatch[1];
    return new DriverError(
      `No element matches "${selector}". Run browse snapshot for fresh refs or check the selector.`,
      { code: "element_not_found", cause: error },
    );
  }

  if (WAIT_FOR_SELECTOR_TIMEOUT_PATTERN.test(message)) {
    return new DriverError(message, { code: "wait_timeout", cause: error });
  }

  if (
    RPC_NAVIGATION_TIMEOUT_PATTERN.test(message) ||
    NAVIGATION_START_TIMEOUT_PATTERN.test(message)
  ) {
    return new DriverError(message, { code: "navigation_timeout", cause: error });
  }

  if (RPC_PAGE_UNRESPONSIVE_PATTERN.test(message) || ENABLING_DOM_TIMEOUT_PATTERN.test(message)) {
    return new DriverError(
      `${message}. The page may have a JavaScript dialog open or be busy; run browse open <url> to reset.`,
      { code: "page_unresponsive", cause: error },
    );
  }

  if (INVALID_URL_PATTERN.test(message)) {
    return new DriverError(message, { code: "invalid_url", cause: error });
  }

  if (RPC_CLIENT_CLOSED_PATTERN.test(message)) {
    return new DriverError(message, { code: "browser_disconnected", cause: error });
  }

  if (CDP_UNREACHABLE_PATTERN.test(message)) {
    return new DriverError(message, { code: "cdp_unreachable", cause: error });
  }

  if (LAST_TAB_PATTERN.test(message)) {
    return new DriverError(message, { code: "last_tab", cause: error });
  }

  return null;
}
