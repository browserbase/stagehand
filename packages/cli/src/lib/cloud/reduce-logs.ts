// Deterministic reducer for `browse cloud sessions logs --only-errors`.
// Turns the raw CDP firehose (~hundreds of events per session) into the high-signal error slice:
// console errors/warnings/asserts, uncaught exceptions, HTTP 4xx/5xx responses, and net-level load
// failures. No LLM — pure allowlist + severity/status filter + field projection + dedupe + stack trim.

export interface ReduceLogsOptions {
  /** Only failed / error-status network requests (4xx/5xx + load failures). */
  failedRequests?: boolean;
}

interface RawLog {
  method?: string;
  request?: { rawBody?: string; params?: unknown };
}

interface CdpLogParams {
  args?: Array<{ description?: string; value?: unknown }>;
  entry?: { level?: string; text?: unknown; url?: unknown };
  errorText?: unknown;
  exceptionDetails?: {
    exception?: { description?: string };
    text?: string;
  };
  response?: { status?: number; url?: unknown };
  type?: string;
}

function paramsOf(e: RawLog): CdpLogParams {
  try {
    const parsed = JSON.parse(e.request?.rawBody ?? "{}") as {
      params?: CdpLogParams;
    };
    return parsed.params ?? {};
  } catch {
    return {};
  }
}

// Keep the message line + the app (`/src/`) stack frames; drop framework/vendor frames and hosts.
function trimStack(s: string): string {
  return (s || "")
    .split("\n")
    .filter(
      (l, i) =>
        i === 0 || (/\/src\//.test(l) && !/node_modules|\.vite/.test(l)),
    )
    .slice(0, 4)
    .map((l) =>
      l
        .replace(/https?:\/\/[^/)]+/g, "")
        .replace(/\?[^):]*/, "")
        .trim(),
    )
    .join("\n");
}

export function reduceLogs(
  raw: RawLog[],
  opts: ReduceLogsOptions = {},
): unknown[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  const push = (rec: Record<string, unknown>) => {
    const k = JSON.stringify(rec);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(rec);
    }
  };

  for (const e of raw) {
    const p = paramsOf(e);
    const m = e.method;
    const responseStatus = p.response?.status;
    let rec: Record<string, unknown> | null = null;

    if (
      m === "Runtime.consoleAPICalled" &&
      typeof p.type === "string" &&
      ["error", "warning", "assert"].includes(p.type)
    ) {
      const text = (p.args ?? [])
        .map((a) => a.description || a.value || "")
        .join(" ");
      if (text && !/^%[os]/.test(text))
        rec = {
          kind: `console.${p.type}`,
          domain: "Runtime",
          severity: p.type,
          text: trimStack(text),
        };
    } else if (m === "Runtime.exceptionThrown") {
      rec = {
        kind: "exception",
        domain: "Runtime",
        severity: "error",
        text: trimStack(
          p.exceptionDetails?.exception?.description ??
            p.exceptionDetails?.text ??
            "",
        ),
      };
    } else if (
      m === "Log.entryAdded" &&
      typeof p.entry?.level === "string" &&
      ["error", "warning"].includes(p.entry?.level)
    ) {
      rec = {
        kind: `log.${p.entry.level}`,
        domain: "Log",
        severity: p.entry.level,
        text: p.entry.text,
        url: p.entry.url,
      };
    } else if (
      m === "Network.responseReceived" &&
      typeof responseStatus === "number" &&
      responseStatus >= 400
    ) {
      rec = {
        kind: "network",
        domain: "Network",
        status: responseStatus,
        url: p.response?.url,
        type: p.type,
      };
    } else if (
      m === "Network.loadingFailed" &&
      p.errorText !== "net::ERR_ABORTED"
    ) {
      rec = {
        kind: "network.failed",
        domain: "Network",
        error: p.errorText,
        type: p.type,
      };
    } else {
      continue; // everything else (byte-chunk / lifecycle events) is noise
    }

    if (!rec) continue; // e.g. a console.error whose text was empty / formatting noise
    if (opts.failedRequests && rec.domain !== "Network") continue;
    push(rec);
  }

  return out;
}
