import { refreshUpdateCheckCache } from "./lib/update.js";

try {
  await refreshUpdateCheckCache();
} catch {
  // Best-effort update refreshes should never surface to users.
}
