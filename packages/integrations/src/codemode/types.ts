import type {
  BrowserbaseLaunchOptions,
  BrowserContext,
  LocalBrowserLaunchOptions,
  Page,
  Stagehand,
  StagehandClientCreateConfig,
} from "@browserbasehq/stagehand";

export type CodeExecuteInput = {
  code: string;
};

export type CodePageState = {
  url: string;
  title: string;
};

export type CodeLogEntry = {
  level: "log" | "warn" | "error";
  text: string;
};

export type CodeExecuteErrorKind = "validation" | "runtime" | "aborted" | "closed";

export type CodeExecuteSuccess = {
  ok: true;
  page: CodePageState;
  value?: unknown;
  logs?: CodeLogEntry[];
};

export type CodeExecuteFailure = {
  ok: false;
  page?: CodePageState;
  logs?: CodeLogEntry[];
  error: {
    kind: CodeExecuteErrorKind;
    name: string;
    message: string;
  };
};

export type CodeExecuteResult = CodeExecuteSuccess | CodeExecuteFailure;

export type StagehandSnippetConsole = Pick<Console, "log" | "warn" | "error">;

export type StagehandSnippetBindings = Record<string, unknown>;

export type ExecuteStagehandSnippetInput = {
  code: string;
  page: Page;
  context: BrowserContext;
  stagehand?: Stagehand;
  bindings?: StagehandSnippetBindings;
  console?: StagehandSnippetConsole;
};

export type StagehandCodeBrowserConfig =
  | {
      type: "local";
      launchOptions?: LocalBrowserLaunchOptions;
    }
  | {
      type: "browserbase";
      launchOptions: BrowserbaseLaunchOptions;
    };

export type StagehandCodeConfig = {
  browser: StagehandCodeBrowserConfig;
  stagehand?: StagehandClientCreateConfig;
};
