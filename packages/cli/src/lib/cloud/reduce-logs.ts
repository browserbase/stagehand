export interface ReduceLogsOptions {
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
      params?: unknown;
    } | null;
    if (
      parsed &&
      typeof parsed === "object" &&
      parsed.params &&
      typeof parsed.params === "object" &&
      !Array.isArray(parsed.params)
    ) {
      return parsed.params as CdpLogParams;
    }
    return {};
  } catch {
    return {};
  }
}

function formatConsoleArg(arg: unknown): string {
  if (!arg || typeof arg !== "object") return "";
  const { description, value } = arg as { description?: unknown; value?: unknown };
  const raw = description || value;
  if (!raw) return "";
  if (typeof raw === "string") return raw;
  if (typeof raw === "number" || typeof raw === "boolean") return String(raw);
  try {
    return JSON.stringify(raw) ?? "";
  } catch {
    return "";
  }
}
function trimStack(s: unknown): string {
  if (typeof s !== "string" || !s) return "";
  return s
    .split("\n")
    .filter((l, i) => i === 0 || (/\/src\//.test(l) && !/node_modules|\.vite/.test(l)))
    .slice(0, 4)
    .map((l) =>
      l
        .replace(/https?:\/\/[^/)]+/g, "")
        .replace(/\?[^):]*/, "")
        .trim(),
    )
    .join("\n");
}

export function reduceLogs(raw: RawLog[], opts: ReduceLogsOptions = {}): unknown[] {
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
    if (!e || typeof e !== "object") continue;
    const p = paramsOf(e);
    const m = e.method;
    const responseStatus = p.response?.status;
    let rec: Record<string, unknown> | null = null;

    if (
      m === "Runtime.consoleAPICalled" &&
      typeof p.type === "string" &&
      ["error", "warning", "assert"].includes(p.type)
    ) {
      const text = (Array.isArray(p.args) ? p.args : [])
        .map(formatConsoleArg)
        .filter(Boolean)
        .join(" ");
      if (text && !/^%[os]/.test(text))
        rec = {
          kind: `console.${p.type}`,
          domain: "Runtime",
          severity: p.type,
          text: trimStack(text),
        };
    } else if (m === "Runtime.exceptionThrown") {
      const description = p.exceptionDetails?.exception?.description;
      const fallbackText = p.exceptionDetails?.text;
      rec = {
        kind: "exception",
        domain: "Runtime",
        severity: "error",
        text: trimStack(
          typeof description === "string"
            ? description
            : typeof fallbackText === "string"
              ? fallbackText
              : "",
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
    } else if (m === "Network.loadingFailed" && p.errorText !== "net::ERR_ABORTED") {
      rec = {
        kind: "network.failed",
        domain: "Network",
        error: p.errorText,
        type: p.type,
      };
    } else {
      continue;
    }

    if (!rec) continue;
    if (opts.failedRequests && rec.domain !== "Network") continue;
    push(rec);
  }

  return out;
}
