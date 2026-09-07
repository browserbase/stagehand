/**
 * Anthropic Browser Use toolset (`browser_toolset_20260801`) as declared on the
 * Messages API: a fixed-member toolset (no `input_schema`, no `name`), every
 * `tool_use` block carries `toolset_name: "browser"` and every `tool_result`
 * sent back must echo it.
 * https://platform.claude.com/docs/en/agents-and-tools/tool-use/browser-use-tool
 */

export const ANTHROPIC_BROWSER_TOOLSET_TYPE = "browser_toolset_20260801" as const;
export const ANTHROPIC_BROWSER_TOOLSET_NAME = "browser" as const;

export type BrowserToolsetMemberConfig = { enabled?: boolean; defer_loading?: boolean };
export type BrowserToolsetConfigs = Record<string, BrowserToolsetMemberConfig>;

/** Members the API enables by default. */
export const BROWSER_TOOLSET_DEFAULT_MEMBERS = [
  "navigate",
  "screenshot",
  "zoom",
  "left_click",
  "right_click",
  "middle_click",
  "double_click",
  "triple_click",
  "hover",
  "left_click_drag",
  "left_mouse_down",
  "left_mouse_up",
  "mouse_move",
  "scroll",
  "scroll_to",
  "type",
  "key",
  "hold_key",
  "wait",
  "read_page",
  "find",
  "get_page_text",
  "form_input",
  "new_tab",
  "list_tabs",
  "switch_tab",
  "close_tab",
] as const;

/** Members the API leaves off unless enabled in `configs`. */
export const BROWSER_TOOLSET_OPTIONAL_MEMBERS = [
  "javascript_exec",
  "file_upload",
  "read_console",
  "read_network",
] as const;

export type BrowserToolsetMember =
  | (typeof BROWSER_TOOLSET_DEFAULT_MEMBERS)[number]
  | (typeof BROWSER_TOOLSET_OPTIONAL_MEMBERS)[number];

export const BROWSER_TOOLSET_MEMBERS: ReadonlySet<string> = new Set<string>([
  ...BROWSER_TOOLSET_DEFAULT_MEMBERS,
  ...BROWSER_TOOLSET_OPTIONAL_MEMBERS,
]);

/**
 * `javascript_exec` is on by default: the eval browser is isolated and
 * credential-free, and the agent benefits from reading computed state directly.
 */
export const DEFAULT_BROWSER_TOOLSET_CONFIGS: BrowserToolsetConfigs = {
  javascript_exec: { enabled: true },
};

/** Text sent for the remaining members of a turn after one of them failed. */
export const BROWSER_TOOLSET_BATCH_HALT_TEXT =
  "Not executed: an earlier action in this turn failed.";

export function isBrowserToolsetMember(name: string): name is BrowserToolsetMember {
  return BROWSER_TOOLSET_MEMBERS.has(name);
}

/** The `tools` entry for the request; member overrides merge over the defaults. */
export function buildBrowserToolsetDeclaration(
  configOverrides?: BrowserToolsetConfigs,
): Record<string, unknown> {
  return {
    type: ANTHROPIC_BROWSER_TOOLSET_TYPE,
    configs: { ...DEFAULT_BROWSER_TOOLSET_CONFIGS, ...(configOverrides ?? {}) },
  };
}

/** Whether a member is enabled under the effective configs. */
export function isBrowserMemberEnabled(
  member: string,
  configOverrides?: BrowserToolsetConfigs,
): boolean {
  const configs = { ...DEFAULT_BROWSER_TOOLSET_CONFIGS, ...(configOverrides ?? {}) };
  const explicit = configs[member]?.enabled;
  if (typeof explicit === "boolean") return explicit;
  return (BROWSER_TOOLSET_DEFAULT_MEMBERS as readonly string[]).includes(member);
}

/** Content blocks a member may return inside its tool_result. */
export type CuaToolResultBlock =
  | { type: "text"; text: string }
  | { type: "image"; source: { type: "base64"; media_type: string; data: string } }
  | {
      type: "browser_state";
      tabs: Array<{ tab_id: string; title: string; url: string; active: boolean }>;
      state_changes?: Array<{ type: "tab_opened"; tab_id: string }>;
    };

export type CuaToolResult = {
  content: string | CuaToolResultBlock[];
  isError?: boolean;
};

/**
 * Runs one toolset member against a browser. Implementations must not throw
 * for member-level failures; return `{ isError: true }` with a message the
 * model can act on. Throwing aborts the session (fatal, e.g. browser gone).
 */
export interface CuaToolExecutor {
  execute(
    member: string,
    input: Record<string, unknown>,
    context: { toolUseId: string; signal?: AbortSignal },
  ): Promise<CuaToolResult>;
}
