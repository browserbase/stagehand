import * as Sentry from "@sentry/node";

import { env } from "./env.js";

const PROFILE_SAMPLE_RATE = 0.5;

Sentry.init({
  dsn: env.SENTRY_DSN,
  profilesSampleRate: PROFILE_SAMPLE_RATE,
});
