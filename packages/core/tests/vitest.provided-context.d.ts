import "vitest";

declare module "vitest" {
  interface ProvidedContext {
    STAGEHAND_BASE_URL: string;
    STAGEHAND_TEST_TARGET: string;
  }
}
