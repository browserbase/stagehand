import {
  PROTOCOL_VERSION,
  client,
  methods,
  type AuthenticateRequest,
  type ClientContext,
  type InitializeRequest,
  type InitializeResponse,
  type RequestPermissionRequest,
  type RequestPermissionResponse,
  type ToolCallUpdate,
} from "@agentclientprotocol/sdk";
import { fileURLToPath } from "node:url";

import { FACADE_AGENT_INSTRUCTIONS } from "../facade/contract.js";
import { spawnAcpAgentProcess } from "./agent-process.js";
import { buildAcpFacadeMcpServer } from "./facade-mcp.js";

const CLIENT_INFO = {
  name: "stagehand-acp-facade",
  title: "Stagehand ACP facade",
  version: "1.0.0",
} as const;

export type AcpFacadeAgentProfile = {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly resolveAuthentication?: (input: {
    initialization: InitializeResponse;
    env: NodeJS.ProcessEnv;
  }) => AuthenticateRequest | undefined;
  readonly buildSessionMeta?: (
    instructions: string,
  ) => Readonly<Record<string, unknown>> | undefined;
  readonly buildPrompt?: (instruction: string, instructions: string) => string;
  readonly isFacadeToolCall: (toolCall: ToolCallUpdate) => boolean;
};

export type RunAcpFacadeAgentOptions = {
  readonly profile: AcpFacadeAgentProfile;
  readonly instruction: string;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly facadeServerPath?: string;
  readonly signal?: AbortSignal;
  readonly terminationGraceMs?: number;
  readonly stderr?: NodeJS.WritableStream;
};

export function resolveAcpFacadePermission(
  request: RequestPermissionRequest,
  activeSessionId: string | undefined,
  isFacadeToolCall: (toolCall: ToolCallUpdate) => boolean,
): RequestPermissionResponse {
  if (request.sessionId !== activeSessionId) return cancelledPermission();

  const kind = isFacadeToolCall(request.toolCall) ? "allow_once" : "reject_once";
  const option = request.options.find((candidate) => candidate.kind === kind);
  return option
    ? { outcome: { outcome: "selected", optionId: option.optionId } }
    : cancelledPermission();
}

export async function runAcpFacadeAgent(options: RunAcpFacadeAgentOptions): Promise<string> {
  const instruction = options.instruction.trim();
  if (!instruction) throw new Error("ACP facade instruction must not be empty.");
  const env = options.env ?? process.env;
  const facadeServerPath =
    options.facadeServerPath ??
    fileURLToPath(new URL("../facade/stdio-server.mjs", import.meta.url));
  const signal = options.signal;
  const agentProcess = spawnAcpAgentProcess({
    command: options.profile.command,
    args: options.profile.args,
    cwd: options.cwd,
    env,
    stderr: options.stderr ?? process.stderr,
  });
  let activeSessionId: string | undefined;
  let agentContext: ClientContext | undefined;
  let abortFallback: ReturnType<typeof setTimeout> | undefined;
  const terminationGraceMs = options.terminationGraceMs ?? 2_000;
  const requestOptions = signal ? { cancellationSignal: signal } : undefined;

  const onAbort = () => {
    if (agentContext && activeSessionId) {
      void agentContext
        .notify(methods.agent.session.cancel, { sessionId: activeSessionId })
        .catch(() => undefined)
        .finally(() => void agentProcess.signal("SIGTERM"));
      abortFallback = setTimeout(() => void agentProcess.signal("SIGKILL"), terminationGraceMs);
    } else {
      void agentProcess.signal("SIGTERM");
      abortFallback = setTimeout(() => void agentProcess.signal("SIGKILL"), terminationGraceMs);
    }
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const app = client({ name: CLIENT_INFO.name }).onRequest(
    methods.client.session.requestPermission,
    ({ params }) =>
      signal?.aborted
        ? cancelledPermission()
        : resolveAcpFacadePermission(params, activeSessionId, options.profile.isFacadeToolCall),
  );

  try {
    return await app.connectWith(agentProcess.transport, async (context) => {
      agentContext = context;
      const initialization = await context.request<InitializeResponse, InitializeRequest>(
        methods.agent.initialize,
        {
          protocolVersion: PROTOCOL_VERSION,
          clientCapabilities: {},
          clientInfo: CLIENT_INFO,
        },
        requestOptions,
      );
      if (initialization.protocolVersion !== PROTOCOL_VERSION) {
        throw new Error(
          `ACP agent ${options.profile.id} negotiated unsupported protocol version ${initialization.protocolVersion}.`,
        );
      }

      const authMethods = initialization.authMethods ?? [];
      if (authMethods.length > 0) {
        const authentication = options.profile.resolveAuthentication?.({ initialization, env });
        if (!authentication) {
          throw new Error(
            `ACP agent ${options.profile.id} requires authentication, but its profile selected no advertised method.`,
          );
        }
        if (!authMethods.some((method) => method.id === authentication.methodId)) {
          throw new Error(
            `ACP agent ${options.profile.id} did not advertise authentication method ${JSON.stringify(authentication.methodId)}.`,
          );
        }
        await context.request(methods.agent.authenticate, authentication, requestOptions);
      }

      const sessionMeta = options.profile.buildSessionMeta?.(FACADE_AGENT_INSTRUCTIONS);
      return context
        .buildSession({
          cwd: options.cwd,
          mcpServers: [buildAcpFacadeMcpServer(facadeServerPath, env)],
          ...(sessionMeta ? { _meta: { ...sessionMeta } } : {}),
        })
        .withSession(async (session) => {
          activeSessionId = session.sessionId;
          if (signal?.aborted) throw interruptedError(options.profile.id);
          const prompt =
            options.profile.buildPrompt?.(instruction, FACADE_AGENT_INSTRUCTIONS) ??
            `${FACADE_AGENT_INSTRUCTIONS}\n\nTask:\n${instruction}`;
          const responsePromise = session.prompt(prompt, requestOptions);
          const textPromise = session.readText();
          const [response, text] = await Promise.all([responsePromise, textPromise]);
          if (signal?.aborted || response.stopReason === "cancelled") {
            throw interruptedError(options.profile.id);
          }
          if (response.stopReason !== "end_turn") {
            throw new Error(`ACP agent ${options.profile.id} stopped with ${response.stopReason}.`);
          }
          const result = text.trim();
          if (!result)
            throw new Error(`ACP agent ${options.profile.id} returned no assistant text.`);
          return result;
        });
    });
  } finally {
    signal?.removeEventListener("abort", onAbort);
    if (abortFallback) clearTimeout(abortFallback);
    await agentProcess.terminate(terminationGraceMs);
  }
}

function cancelledPermission(): RequestPermissionResponse {
  return { outcome: { outcome: "cancelled" } };
}

function interruptedError(profileId: string): Error {
  return new Error(`ACP agent ${profileId} run interrupted.`);
}
