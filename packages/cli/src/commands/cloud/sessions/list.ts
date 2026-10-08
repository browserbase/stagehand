import { Flags } from "@oclif/core";

import {
  createBrowserbaseClient,
  outputJson,
  withBrowserbaseApi,
} from "../../../lib/cloud/api.js";
import { apiCommonFlags, toApiOptions } from "../../../lib/cloud/flags.js";
import { BrowseCommand } from "../../../base.js";
import {
  formatId,
  formatUtcDateTime,
  outputFormatFlags,
  outputTable,
  resolveOutputFormat,
} from "../../../lib/output.js";

type SessionStatus = "RUNNING" | "ERROR" | "TIMED_OUT" | "COMPLETED";

interface BrowserbaseSession {
  contextId?: string;
  createdAt?: string;
  endedAt?: string;
  id: string;
  keepAlive?: boolean;
  region?: string;
  startedAt?: string;
  status?: string;
  userMetadata?: Record<string, unknown>;
}

export default class SessionsList extends BrowseCommand {
  static override description = "List Browserbase sessions.";
  static override examples = [
    "browse cloud sessions list",
    "browse cloud sessions list --limit 5",
    "browse cloud sessions list --status RUNNING",
    `browse cloud sessions list --q "user_metadata['env']:'staging'"`,
    "browse cloud sessions list --json",
  ];

  static override flags = {
    ...apiCommonFlags,
    ...outputFormatFlags,
    all: Flags.boolean({
      description: "Show all returned sessions in table output.",
    }),
    limit: Flags.integer({
      default: 20,
      description: "Maximum sessions to show in table output.",
      helpValue: "<count>",
      min: 1,
    }),
    q: Flags.string({
      description: `Session metadata query (e.g. "user_metadata['env']:'staging'").`,
      helpValue: "<q>",
    }),
    status: Flags.string({
      description: "Filter sessions by status.",
      helpValue: "<status>",
      options: ["RUNNING", "ERROR", "TIMED_OUT", "COMPLETED"],
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(SessionsList);
    await withBrowserbaseApi("sessions", async () => {
      const client = createBrowserbaseClient(toApiOptions(flags));
      const query: { q?: string; status?: SessionStatus } = {};
      if (flags.q) {
        query.q = flags.q;
      }
      if (flags.status) {
        query.status = flags.status as SessionStatus;
      }

      const sessions = (await client.sessions.list(
        query,
      )) as BrowserbaseSession[];
      if (resolveOutputFormat(flags) === "json") {
        outputJson(sessions);
        return;
      }

      outputSessionsTable(sessions, {
        limit: flags.all ? sessions.length : flags.limit,
        wide: flags.wide,
      });
    });
  }
}

function outputSessionsTable(
  sessions: BrowserbaseSession[],
  options: { limit: number; wide?: boolean },
): void {
  const visibleSessions = sessions.slice(0, options.limit);

  if (visibleSessions.length === 0) {
    console.log("No sessions found.");
    return;
  }

  outputTable(
    visibleSessions,
    [
      {
        header: "ID",
        maxWidth: 12,
        value: (session) => formatId(session.id, options.wide),
      },
      {
        header: "Status",
        maxWidth: 12,
        value: (session) => session.status,
      },
      {
        header: "Created",
        maxWidth: 17,
        value: (session) => formatUtcDateTime(session.createdAt),
      },
      {
        header: "Duration",
        maxWidth: 8,
        value: (session) => formatDuration(session.startedAt, session.endedAt),
      },
      {
        header: "Region",
        maxWidth: 12,
        value: (session) => session.region,
      },
      {
        header: "KA",
        maxWidth: 3,
        value: (session) => formatKeepAlive(session.keepAlive),
      },
      {
        header: "Ctx",
        maxWidth: 12,
        value: (session) => formatId(session.contextId, options.wide),
      },
      {
        header: "Metadata",
        maxWidth: 32,
        value: (session) => formatMetadata(session.userMetadata),
      },
    ],
    { wide: options.wide },
  );

  if (visibleSessions.length < sessions.length) {
    console.log(
      `Showing ${visibleSessions.length} of ${sessions.length} sessions returned. Use --limit, --all, --status, --q, or --json.`,
    );
  }
}

function formatDuration(
  startedAt: string | undefined,
  endedAt: string | undefined,
): string {
  if (!startedAt || !endedAt) {
    return "-";
  }

  const started = new Date(startedAt).getTime();
  const ended = new Date(endedAt).getTime();
  if (Number.isNaN(started) || Number.isNaN(ended) || ended < started) {
    return "-";
  }

  const seconds = Math.round((ended - started) / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) {
    return `${minutes}m`;
  }

  return `${Math.floor(minutes / 60)}h`;
}

function formatKeepAlive(value: boolean | undefined): string {
  if (value === undefined) {
    return "-";
  }

  return value ? "yes" : "no";
}

function formatMetadata(metadata: Record<string, unknown> | undefined): string {
  if (!metadata || Object.keys(metadata).length === 0) {
    return "-";
  }

  return Object.entries(metadata)
    .map(([key, value]) =>
      value === true || value === "true" ? key : `${key}=${String(value)}`,
    )
    .join(",");
}
