import {
  cleanupV4CodeBrowserbaseResources,
  readV4CodeBrowserbaseCleanupInputFromEnv,
} from "./v4CodeBrowserbaseCleanup.js";

try {
  await cleanupV4CodeBrowserbaseResources(
    readV4CodeBrowserbaseCleanupInputFromEnv(),
  );
} catch {
  process.exitCode = 1;
}
