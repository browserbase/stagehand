import z, { ZodType, z as z$1, ZodError, ZodTypeAny } from 'zod/v3';
import { ClientOptions as ClientOptions$2 } from '@anthropic-ai/sdk';
import { LanguageModelV2 } from '@ai-sdk/provider';
import { ClientOptions as ClientOptions$1 } from 'openai';
import { generateObject, generateText, streamText, streamObject, experimental_generateImage, embed, embedMany, experimental_transcribe, experimental_generateSpeech, ToolSet } from 'ai';
import { Client, ClientOptions as ClientOptions$3 } from '@modelcontextprotocol/sdk/client/index.js';
import { Page as Page$1 } from 'playwright-core';
export { Page as PlaywrightPage } from 'playwright-core';
import { Page as Page$2 } from 'puppeteer-core';
export { Page as PuppeteerPage } from 'puppeteer-core';
import { Page as Page$3 } from 'patchright-core';
export { Page as PatchrightPage } from 'patchright-core';
import { Protocol } from 'devtools-protocol';
import { Buffer as Buffer$1 } from 'buffer';
import Browserbase from '@browserbasehq/sdk';
import { ChatCompletion } from 'openai/resources';
import { ToolSet as ToolSet$1 } from 'ai/dist';
import { Schema } from '@google/genai';

type AnthropicJsonSchemaObject = {
    definitions?: {
        MySchema?: {
            properties?: Record<string, unknown>;
            required?: string[];
        };
    };
    properties?: Record<string, unknown>;
    required?: string[];
} & Record<string, unknown>;
interface LLMTool {
    type: "function";
    name: string;
    description: string;
    parameters: Record<string, unknown>;
}
type AISDKProvider = (modelName: string) => LanguageModelV2;
type AISDKCustomProvider = (options: {
    apiKey: string;
}) => AISDKProvider;
type AvailableModel = "gpt-4.1" | "gpt-4.1-mini" | "gpt-4.1-nano" | "o4-mini" | "o3" | "o3-mini" | "o1" | "o1-mini" | "gpt-4o" | "gpt-4o-mini" | "gpt-4o-2024-08-06" | "gpt-4.5-preview" | "o1-preview" | "claude-3-5-sonnet-latest" | "claude-3-5-sonnet-20241022" | "claude-3-5-sonnet-20240620" | "claude-3-7-sonnet-latest" | "claude-3-7-sonnet-20250219" | "cerebras-llama-3.3-70b" | "cerebras-llama-3.1-8b" | "groq-llama-3.3-70b-versatile" | "groq-llama-3.3-70b-specdec" | "gemini-1.5-flash" | "gemini-1.5-pro" | "gemini-1.5-flash-8b" | "gemini-2.0-flash-lite" | "gemini-2.0-flash" | "gemini-2.5-flash-preview-04-17" | "gemini-2.5-pro-preview-03-25" | string;
type ModelProvider = "openai" | "anthropic" | "cerebras" | "groq" | "google" | "aisdk";
type ClientOptions = ClientOptions$1 | ClientOptions$2;
type ModelConfiguration = AvailableModel | (ClientOptions & {
    modelName: AvailableModel;
});

type LogLevel = 0 | 1 | 2;
/**
 * Mapping between numeric log levels and their names
 *
 * 0 - error/warn - Critical issues or important warnings
 * 1 - info - Standard information messages
 * 2 - debug - Detailed information for debugging
 */
declare const LOG_LEVEL_NAMES: Record<LogLevel, string>;
type LogLine = {
    id?: string;
    category?: string;
    message: string;
    level?: LogLevel;
    timestamp?: string;
    auxiliary?: {
        [key: string]: {
            value: string;
            type: "object" | "string" | "html" | "integer" | "float" | "boolean";
        };
    };
};
type Logger = (logLine: LogLine) => void;

interface ChatMessage {
    role: "system" | "user" | "assistant";
    content: ChatMessageContent;
}
type ChatMessageContent = string | (ChatMessageImageContent | ChatMessageTextContent)[];
interface ChatMessageImageContent {
    type: string;
    image_url?: {
        url: string;
    };
    text?: string;
    source?: {
        type: string;
        media_type: string;
        data: string;
    };
}
interface ChatMessageTextContent {
    type: string;
    text: string;
}
declare const AnnotatedScreenshotText = "This is a screenshot of the current page state with the elements annotated on it. Each element id is annotated with a number to the top left of it. Duplicate annotations at the same location are under each other vertically.";
interface ChatCompletionOptions {
    messages: ChatMessage[];
    temperature?: number;
    top_p?: number;
    frequency_penalty?: number;
    presence_penalty?: number;
    image?: {
        buffer: Buffer;
        description?: string;
    };
    response_model?: {
        name: string;
        schema: ZodType;
    };
    tools?: LLMTool[];
    tool_choice?: "auto" | "none" | "required";
    maxOutputTokens?: number;
    requestId?: string;
}
type LLMResponse = {
    id: string;
    object: string;
    created: number;
    model: string;
    choices: {
        index: number;
        message: {
            role: string;
            content: string | null;
            tool_calls: {
                id: string;
                type: string;
                function: {
                    name: string;
                    arguments: string;
                };
            }[];
        };
        finish_reason: string;
    }[];
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
    };
};
interface CreateChatCompletionOptions {
    options: ChatCompletionOptions;
    logger: (message: LogLine) => void;
    retries?: number;
}
declare abstract class LLMClient {
    type: "openai" | "anthropic" | "cerebras" | "groq" | (string & {});
    modelName: AvailableModel | (string & {});
    hasVision: boolean;
    clientOptions: ClientOptions;
    userProvidedInstructions?: string;
    constructor(modelName: AvailableModel, userProvidedInstructions?: string);
    abstract createChatCompletion<T = LLMResponse & {
        usage?: LLMResponse["usage"];
    }>(options: CreateChatCompletionOptions): Promise<T>;
    generateObject: typeof generateObject;
    generateText: typeof generateText;
    streamText: typeof streamText;
    streamObject: typeof streamObject;
    generateImage: typeof experimental_generateImage;
    embed: typeof embed;
    embedMany: typeof embedMany;
    transcribe: typeof experimental_transcribe;
    generateSpeech: typeof experimental_generateSpeech;
    getLanguageModel?(): LanguageModelV2;
}

/**
 * CDP transport & session multiplexer
 *
 * Owns the browser WebSocket and multiplexes flattened Target sessions.
 * Tracks inflight CDP calls, routes responses to the right session, and forwards events.
 *
 * This does not interpret Page/DOM/Runtime semantics — callers own that logic.
 */
interface CDPSessionLike {
    send<R = unknown>(method: string, params?: object): Promise<R>;
    on<P = unknown>(event: string, handler: (params: P) => void): void;
    off<P = unknown>(event: string, handler: (params: P) => void): void;
    close(): Promise<void>;
    readonly id: string | null;
}
type EventHandler = (params: unknown) => void;
declare class CdpConnection implements CDPSessionLike {
    private ws;
    private nextId;
    private inflight;
    private eventHandlers;
    private sessions;
    readonly id: string | null;
    private transportCloseHandlers;
    onTransportClosed(handler: (why: string) => void): void;
    offTransportClosed(handler: (why: string) => void): void;
    private emitTransportClosed;
    private constructor();
    static connect(wsUrl: string): Promise<CdpConnection>;
    enableAutoAttach(): Promise<void>;
    send<R = unknown>(method: string, params?: object): Promise<R>;
    on<P = unknown>(event: string, handler: (params: P) => void): void;
    off<P = unknown>(event: string, handler: (params: P) => void): void;
    close(): Promise<void>;
    getSession(sessionId: string): CdpSession | undefined;
    attachToTarget(targetId: string): Promise<CdpSession>;
    getTargets(): Promise<Protocol.Target.TargetInfo[]>;
    private onMessage;
    _sendViaSession<R = unknown>(sessionId: string, method: string, params?: object): Promise<R>;
    _onSessionEvent(sessionId: string, event: string, handler: EventHandler): void;
    _offSessionEvent(sessionId: string, event: string, handler: EventHandler): void;
    _dispatchToSession(sessionId: string, event: string, params: unknown): void;
}
declare class CdpSession implements CDPSessionLike {
    private readonly root;
    readonly id: string;
    constructor(root: CdpConnection, id: string);
    send<R = unknown>(method: string, params?: object): Promise<R>;
    on<P = unknown>(event: string, handler: (params: P) => void): void;
    off<P = unknown>(event: string, handler: (params: P) => void): void;
    close(): Promise<void>;
    dispatch(event: string, params: unknown): void;
}

interface FrameManager {
    session: CDPSessionLike;
    frameId: string;
    pageId: string;
}
/**
 * Frame
 *
 * A thin, session-bound handle to a specific DOM frame (by frameId).
 * All CDP calls in this class go through `this.session`, which MUST be the
 * owning session for `this.frameId`. Page is responsible for constructing
 * Frames with the correct session.
 */
declare class Frame implements FrameManager {
    session: CDPSessionLike;
    frameId: string;
    pageId: string;
    private readonly remoteBrowser;
    /** Owning CDP session id (useful for logs); null for root connection (should not happen for targets) */
    readonly sessionId: string | null;
    constructor(session: CDPSessionLike, frameId: string, pageId: string, remoteBrowser: boolean);
    /** True when the controlled browser runs on a different machine. */
    isBrowserRemote(): boolean;
    /** DOM.getNodeForLocation → DOM.describeNode */
    getNodeAtLocation(x: number, y: number): Promise<Protocol.DOM.Node>;
    /** CSS selector → DOM.querySelector → DOM.getBoxModel */
    getLocationForSelector(selector: string): Promise<{
        x: number;
        y: number;
        width: number;
        height: number;
    }>;
    /** Accessibility.getFullAXTree (+ recurse into child frames if requested) */
    getAccessibilityTree(withFrames?: boolean): Promise<Protocol.Accessibility.AXNode[]>;
    /**
     * Evaluate a function or expression in this frame's isolated world.
     * - If a string is provided, treated as a JS expression.
     * - If a function is provided, it is stringified and invoked with the optional argument.
     */
    evaluate<R = unknown, Arg = unknown>(pageFunctionOrExpression: string | ((arg: Arg) => R | Promise<R>), arg?: Arg): Promise<R>;
    /** Page.captureScreenshot (frame-scoped session) */
    screenshot(options?: {
        fullPage?: boolean;
        clip?: {
            x: number;
            y: number;
            width: number;
            height: number;
        };
        type?: "png" | "jpeg";
        quality?: number;
        scale?: number;
    }): Promise<Buffer>;
    /** Child frames via Page.getFrameTree */
    childFrames(): Promise<Frame[]>;
    /** Wait for a lifecycle state (load/domcontentloaded/networkidle) */
    waitForLoadState(state?: "load" | "domcontentloaded" | "networkidle"): Promise<void>;
    /** Simple placeholder for your own locator abstraction */
    locator(selector: string, options?: {
        deep?: boolean;
        depth?: number;
    }): Locator;
    /** Create/get an isolated world for this frame and return its executionContextId */
    private getExecutionContextId;
}

interface SetInputFilePayload {
    name: string;
    mimeType?: string;
    buffer: ArrayBuffer | Uint8Array | Buffer$1 | string;
    lastModified?: number;
}
type SetInputFilesArgument = string | string[] | SetInputFilePayload | SetInputFilePayload[];

type MouseButton = "left" | "right" | "middle";
/**
 * Locator
 *
 * Purpose:
 * A small, CDP-based element interaction helper scoped to a specific `Frame`.
 * It resolves a CSS/XPath selector inside the frame’s **isolated world**, and then
 * performs low-level actions (click, type, select) using DOM/Runtime/Input
 * protocol domains with minimal abstraction.
 *
 * Key change:
 * - Prefer **objectId**-based CDP calls (scroll, geometry) to avoid brittle
 *   frontend nodeId mappings. nodeId is resolved on a best-effort basis and
 *   returned for compatibility, but actions do not depend on it.
 *
 * Notes:
 * - Resolution is lazy: every action resolves the selector again.
 * - Uses `Page.createIsolatedWorld` so evaluation is isolated from page scripts.
 * - Releases remote objects (`Runtime.releaseObject`) where appropriate.
 */
declare class Locator {
    private readonly frame;
    private readonly selector;
    private readonly options?;
    private readonly selectorResolver;
    private readonly selectorQuery;
    private readonly nthIndex;
    constructor(frame: Frame, selector: string, options?: {
        deep?: boolean;
        depth?: number;
    }, nthIndex?: number);
    /** Return the owning Frame for this locator (typed accessor, no private access). */
    getFrame(): Frame;
    /**
     * Set files on an <input type="file"> element.
     *
     * Mirrors Playwright's Locator.setInputFiles basics:
     * - Accepts file path(s) or payload object(s) { name, mimeType, buffer }.
     * - Uses CDP DOM.setFileInputFiles under the hood.
     * - Best‑effort dispatches change/input via CDP (Chrome does by default).
     * - Passing an empty array clears the selection.
     */
    setInputFiles(files: SetInputFilesArgument): Promise<void>;
    /**
     * Remote browser fallback: build File objects inside the page and attach them via JS.
     *
     * When Stagehand is driving a browser that cannot see the local filesystem (Browserbase,
     * remote CDP, etc.), CDP's DOM.setFileInputFiles would fail because Chrome can't reach
     * our temp files. Instead we base64-encode the payloads, send them into the page, and
     * let a DOM helper create File objects + dispatch change/input events.
     */
    private assignFilesViaPayloadInjection;
    /**
     * Return the DOM backendNodeId for this locator's target element.
     * Useful for identity comparisons without needing element handles.
     */
    backendNodeId(): Promise<Protocol.DOM.BackendNodeId>;
    /** Return how many nodes the current selector resolves to. */
    count(): Promise<number>;
    /**
     * Return the center of the element's bounding box in the owning frame's viewport
     * (CSS pixels), rounded to integers. Scrolls into view best-effort.
     */
    centroid(): Promise<{
        x: number;
        y: number;
    }>;
    /**
     * Highlight the element's bounding box using the CDP Overlay domain.
     * - Scrolls element into view best-effort.
     * - Shows a semi-transparent overlay briefly, then hides it.
     */
    highlight(options?: {
        durationMs?: number;
        borderColor?: {
            r: number;
            g: number;
            b: number;
            a?: number;
        };
        contentColor?: {
            r: number;
            g: number;
            b: number;
            a?: number;
        };
    }): Promise<void>;
    /**
     * Move the mouse cursor to the element's visual center without clicking.
     * - Scrolls into view best-effort, resolves geometry, then dispatches a mouse move.
     */
    hover(): Promise<void>;
    /**
     * Click the element at its visual center.
     * Steps:
     *  1) Resolve selector to { objectId } in the frame world.
     *  2) Scroll into view via `DOM.scrollIntoViewIfNeeded({ objectId })`.
     *  3) Read geometry via `DOM.getBoxModel({ objectId })` → compute a center point.
     *  4) Synthesize mouse press + release via `Input.dispatchMouseEvent`.
     */
    click(options?: {
        button?: MouseButton;
        clickCount?: number;
    }): Promise<void>;
    /**
     * Dispatch a DOM 'click' MouseEvent on the element itself.
     * - Does not synthesize real pointer input; directly dispatches an event.
     * - Useful for elements that rely on click handlers without needing hit-testing.
     */
    sendClickEvent(options?: {
        bubbles?: boolean;
        cancelable?: boolean;
        composed?: boolean;
        detail?: number;
    }): Promise<void>;
    /**
     * Scroll the element vertically to a given percentage (0–100).
     * - If the element is <html> or <body>, scrolls the window/document.
     * - Otherwise, scrolls the element itself via element.scrollTo.
     */
    scrollTo(percent: number | string): Promise<void>;
    /**
     * Fill an input/textarea/contenteditable element.
     * Mirrors Playwright semantics: the DOM helper either applies the native
     * value setter (for special input types) or asks us to type text via the CDP
     * Input domain after focusing/selecting.
     */
    fill(value: string): Promise<void>;
    /**
     * Type text into the element (focuses first).
     * - Focus via element.focus() in page JS (no DOM.focus(nodeId)).
     * - If no delay, uses `Input.insertText` for efficiency.
     * - With delay, synthesizes `keyDown`/`keyUp` per character.
     */
    type(text: string, options?: {
        delay?: number;
    }): Promise<void>;
    /**
     * Select one or more options on a `<select>` element.
     * Returns the values actually selected after the operation.
     */
    selectOption(values: string | string[]): Promise<string[]>;
    /**
     * Return true if the element is attached and visible (rough heuristic).
     */
    isVisible(): Promise<boolean>;
    /**
     * Return true if the element is an input[type=checkbox|radio] and is checked.
     * Also considers aria-checked for ARIA widgets.
     */
    isChecked(): Promise<boolean>;
    /**
     * Return the element's input value (for input/textarea/select/contenteditable).
     */
    inputValue(): Promise<string>;
    /**
     * Return the element's textContent (raw, not innerText).
     */
    textContent(): Promise<string>;
    /**
     * Return the element's innerHTML string.
     */
    innerHtml(): Promise<string>;
    /**
     * Return the element's innerText (layout-aware, visible text).
     */
    innerText(): Promise<string>;
    /**
     * For API parity, returns the same locator (querySelector already returns the first match).
     */
    first(): Locator;
    /** Return a locator narrowed to the element at the given zero-based index. */
    nth(index: number): Locator;
    /**
     * Resolve `this.selector` within the frame to `{ objectId, nodeId? }`:
     * Delegates to a shared selector resolver so all selector logic stays in sync.
     */
    resolveNode(): Promise<{
        nodeId: Protocol.DOM.NodeId | null;
        objectId: Protocol.Runtime.RemoteObjectId;
    }>;
    /** Compute a center point from a BoxModel content quad */
    private centerFromBoxContent;
}

/**
 * DeepLocatorDelegate: a lightweight wrapper that looks like a Locator and
 * resolves to the correct frame/element on each call using hop/deep-XPath logic.
 *
 * Returned by `page.deepLocator()` for ergonomic, await-free chaining:
 *   page.deepLocator('iframe#ifrA >> #btn').click()
 */
declare class DeepLocatorDelegate {
    private readonly page;
    private readonly root;
    private readonly selector;
    private readonly nthIndex;
    constructor(page: Page, root: Frame, selector: string, nthIndex?: number);
    private real;
    click(options?: {
        button?: "left" | "right" | "middle";
        clickCount?: number;
    }): Promise<void>;
    count(): Promise<number>;
    hover(): Promise<void>;
    fill(value: string): Promise<void>;
    type(text: string, options?: {
        delay?: number;
    }): Promise<void>;
    selectOption(values: string | string[]): Promise<string[]>;
    scrollTo(percent: number | string): Promise<void>;
    isVisible(): Promise<boolean>;
    isChecked(): Promise<boolean>;
    inputValue(): Promise<string>;
    textContent(): Promise<string>;
    innerHtml(): Promise<string>;
    innerText(): Promise<string>;
    centroid(): Promise<{
        x: number;
        y: number;
    }>;
    backendNodeId(): Promise<number>;
    highlight(options?: {
        durationMs?: number;
        borderColor?: {
            r: number;
            g: number;
            b: number;
            a?: number;
        };
        contentColor?: {
            r: number;
            g: number;
            b: number;
            a?: number;
        };
    }): Promise<void>;
    sendClickEvent(options?: {
        bubbles?: boolean;
        cancelable?: boolean;
        composed?: boolean;
        detail?: number;
    }): Promise<void>;
    setInputFiles(files: string | string[] | {
        name: string;
        mimeType: string;
        buffer: ArrayBuffer | Uint8Array | Buffer | string;
    } | Array<{
        name: string;
        mimeType: string;
        buffer: ArrayBuffer | Uint8Array | Buffer | string;
    }>): Promise<void>;
    first(): DeepLocatorDelegate;
    nth(index: number): DeepLocatorDelegate;
}

/**
 * FrameLocator: resolves iframe elements to their child Frames and allows
 * creating locators scoped to that frame. Supports chaining.
 */
declare class FrameLocator {
    private readonly parent?;
    private readonly selector;
    private readonly page;
    private readonly root?;
    constructor(page: Page, selector: string, parent?: FrameLocator, root?: Frame);
    /** Create a nested FrameLocator under this one. */
    frameLocator(selector: string): FrameLocator;
    /** Resolve to the concrete Frame for this FrameLocator chain. */
    resolveFrame(): Promise<Frame>;
    /** Return a Locator scoped to this frame. Methods delegate to the frame lazily. */
    locator(selector: string): LocatorDelegate;
}
/** A small delegating wrapper that resolves the frame lazily per call. */
declare class LocatorDelegate {
    private readonly fl;
    private readonly sel;
    constructor(fl: FrameLocator, sel: string);
    private real;
    click(options?: {
        button?: "left" | "right" | "middle";
        clickCount?: number;
    }): Promise<void>;
    hover(): Promise<void>;
    fill(value: string): Promise<void>;
    type(text: string, options?: {
        delay?: number;
    }): Promise<void>;
    selectOption(values: string | string[]): Promise<string[]>;
    scrollTo(percent: number | string): Promise<void>;
    isVisible(): Promise<boolean>;
    isChecked(): Promise<boolean>;
    inputValue(): Promise<string>;
    textContent(): Promise<string>;
    innerHtml(): Promise<string>;
    innerText(): Promise<string>;
    count(): Promise<number>;
    first(): LocatorDelegate;
}

type RemoteObject = Protocol.Runtime.RemoteObject;
type ConsoleListener = (message: ConsoleMessage) => void;
declare class ConsoleMessage {
    private readonly event;
    private readonly pageRef?;
    constructor(event: Protocol.Runtime.ConsoleAPICalledEvent, pageRef?: Page);
    type(): Protocol.Runtime.ConsoleAPICalledEvent["type"];
    text(): string;
    args(): RemoteObject[];
    location(): {
        url?: string;
        lineNumber?: number;
        columnNumber?: number;
    };
    page(): Page | undefined;
    timestamp(): number | undefined;
    raw(): Protocol.Runtime.ConsoleAPICalledEvent;
    toString(): string;
}

/**
 * Response
 * -----------------
 *
 * This module implements a Playwright-inspired response wrapper that exposes
 * navigation metadata and helpers for retrieving HTTP response bodies. The
 * abstraction is consumed by navigation routines (e.g. `Page.goto`) so callers
 * can synchronously inspect status codes, lazily fetch body text, or await the
 * network layer finishing the request. The implementation is built directly on
 * Chrome DevTools Protocol primitives – it holds the originating `requestId`
 * so it can request payloads via `Network.getResponseBody`, and it listens for
 * `responseReceivedExtraInfo`, `loadingFinished`, and `loadingFailed` events to
 * hydrate the richer header view and resolve callers waiting on completion.
 */

type ServerAddr = {
    ipAddress: string;
    port: number;
};
/**
 * Thin wrapper around CDP response metadata that mirrors the ergonomics of
 * Playwright's `Response` class. The class intentionally keeps the same method
 * names so upstream integrations can transition with minimal code changes.
 */
declare class Response$1 {
    private readonly page;
    private readonly session;
    private readonly requestId;
    private readonly frameId?;
    private readonly loaderId?;
    private readonly response;
    private readonly fromServiceWorkerFlag;
    private readonly serverAddress?;
    private headersObject;
    private headersArrayCache;
    private allHeadersCache;
    private readonly headerValuesMap;
    private finishedDeferred;
    private finishedSettled;
    private extraInfoHeaders;
    private extraInfoHeadersText;
    /**
     * Build a response wrapper from the CDP notification associated with a
     * navigation. The constructor captures the owning page/session so follow-up
     * methods (body/text/json) can query CDP on-demand. The `response` payload is
     * the raw `Protocol.Network.Response` object emitted by Chrome.
     */
    constructor(params: {
        page: Page;
        session: CDPSessionLike;
        requestId: string;
        frameId?: string;
        loaderId?: string;
        response: Protocol.Network.Response;
        fromServiceWorker: boolean;
    });
    /** URL associated with the navigation request. */
    url(): string;
    /** HTTP status code reported by Chrome. */
    status(): number;
    /** Human-readable status text that accompanied the response. */
    statusText(): string;
    /** Convenience predicate that checks for 2xx statuses. */
    ok(): boolean;
    /** Returns the Stagehand frame object that initiated the navigation. */
    frame(): Frame | null;
    /** Indicates whether the response was serviced by a Service Worker. */
    fromServiceWorker(): boolean;
    /**
     * Returns TLS security metadata when provided by the browser. In practice
     * this includes certificate issuer, protocol, and validity interval.
     */
    securityDetails(): Promise<Protocol.Network.SecurityDetails | null>;
    /** Returns the resolved server address for the navigation when available. */
    serverAddr(): Promise<ServerAddr | null>;
    /**
     * Returns the response headers normalised to lowercase keys. Matches the
     * behaviour of Playwright's `headers()` by eliding duplicate header entries.
     */
    headers(): Record<string, string>;
    /**
     * Returns all headers including those only surfaced through
     * `responseReceivedExtraInfo` such as `set-cookie`. Values are reported as the
     * browser sends them (no further splitting or concatenation).
     */
    allHeaders(): Promise<Record<string, string>>;
    /** Returns a concatenated header string for the supplied header name. */
    headerValue(name: string): Promise<string | null>;
    /** Returns all values for a header (case-insensitive lookup). */
    headerValues(name: string): Promise<string[]>;
    /**
     * Returns header entries preserving their original wire casing and ordering.
     * Falls back to the CDP object when the raw header text is unavailable.
     */
    headersArray(): Promise<Array<{
        name: string;
        value: string;
    }>>;
    /**
     * Requests the raw response body from Chrome DevTools Protocol. The method is
     * intentionally lazy because not every caller needs the payload, and CDP only
     * allows retrieving it once the response completes.
     */
    body(): Promise<Buffer>;
    /** Decodes the response body as UTF-8 text. */
    text(): Promise<string>;
    /** Parses the response body as JSON and throws if parsing fails. */
    json<T = unknown>(): Promise<T>;
    /**
     * Resolves once the underlying network request completes or fails. Mirrors
     * Playwright's behaviour by resolving to `null` on success and to an `Error`
     * instance when Chrome reports `Network.loadingFailed`.
     */
    finished(): Promise<null | Error>;
    /**
     * Internal helper invoked by the navigation tracker when CDP reports extra
     * header information. This keeps the cached header views in sync with the
     * richer metadata.
     */
    applyExtraInfo(event: Protocol.Network.ResponseReceivedExtraInfoEvent): void;
    /**
     * Internal helper for creating a Response object from a Serializable
     * goto response from the Stagehand API
     */
    static fromSerializable(serialized: SerializableResponse, context: {
        page: Page;
        session: CDPSessionLike;
    }): Response$1;
    /** Marks the response as finished and resolves the `finished()` promise. */
    markFinished(error: Error | null): void;
}

type AnyPage = Page$1 | Page$2 | Page$3 | Page;

type LoadState = "load" | "domcontentloaded" | "networkidle";

declare class StagehandAPIClient {
    private apiKey;
    private projectId;
    private sessionId?;
    private modelApiKey;
    private logger;
    private fetchWithCookies;
    constructor({ apiKey, projectId, logger }: StagehandAPIConstructorParams);
    init({ modelName, modelApiKey, domSettleTimeoutMs, verbose, systemPrompt, selfHeal, browserbaseSessionCreateParams, browserbaseSessionID, }: StartSessionParams): Promise<StartSessionResult>;
    act({ input, options, frameId }: APIActParameters): Promise<ActResult>;
    extract<T extends z.AnyZodObject>({ instruction, schema: zodSchema, options, frameId, }: APIExtractParameters): Promise<ExtractResult<T>>;
    observe({ instruction, options, frameId, }: APIObserveParameters): Promise<Action[]>;
    goto(url: string, options?: {
        waitUntil?: "load" | "domcontentloaded" | "networkidle";
    }, frameId?: string): Promise<SerializableResponse | null>;
    agentExecute(agentConfig: AgentConfig, executeOptions: AgentExecuteOptions | string, frameId?: string): Promise<AgentResult>;
    end(): Promise<Response>;
    getReplayMetrics(): Promise<StagehandMetrics>;
    private execute;
    private request;
}

type ScreenshotAnimationsOption = "disabled" | "allow";
type ScreenshotCaretOption = "hide" | "initial";
type ScreenshotScaleOption = "css" | "device";
interface ScreenshotClip {
    x: number;
    y: number;
    width: number;
    height: number;
}
interface ScreenshotOptions {
    animations?: ScreenshotAnimationsOption;
    caret?: ScreenshotCaretOption;
    clip?: ScreenshotClip;
    fullPage?: boolean;
    mask?: Locator[];
    maskColor?: string;
    omitBackground?: boolean;
    path?: string;
    quality?: number;
    scale?: ScreenshotScaleOption;
    style?: string;
    timeout?: number;
    type?: "png" | "jpeg";
}

declare class Page {
    private readonly conn;
    private readonly mainSession;
    private readonly _targetId;
    /** Every CDP child session this page owns (top-level + adopted OOPIF sessions). */
    private readonly sessions;
    /** Unified truth for frame topology + ownership. */
    private readonly registry;
    /** A convenience wrapper bound to the current main frame id (top-level session). */
    private mainFrameWrapper;
    /** Compact ordinal per frameId (used by snapshot encoding). */
    private frameOrdinals;
    private nextOrdinal;
    /** cache Frames per frameId so everyone uses the same one */
    private readonly frameCache;
    private readonly browserIsRemote;
    /** Stable id for Frames created by this Page (use top-level TargetId). */
    private readonly pageId;
    /** Cached current URL for synchronous page.url() */
    private _currentUrl;
    private navigationCommandSeq;
    private latestNavigationCommandId;
    private readonly networkManager;
    /** Optional API client for routing page operations to the API */
    private readonly apiClient;
    private readonly consoleListeners;
    private readonly consoleHandlers;
    private constructor();
    private cursorEnabled;
    private ensureCursorScript;
    enableCursorOverlay(): Promise<void>;
    private updateCursor;
    /**
     * Factory: create Page and seed registry with the shallow tree from Page.getFrameTree.
     * Assumes Page domain is already enabled on the session passed in.
     */
    static create(conn: CdpConnection, session: CDPSessionLike, targetId: string, apiClient?: StagehandAPIClient | null, localBrowserLaunchOptions?: LocalBrowserLaunchOptions | null, browserIsRemote?: boolean): Promise<Page>;
    /**
     * Parent/child session emitted a `frameAttached`.
     * Topology update + ownership stamped to **emitting session**.
     */
    onFrameAttached(frameId: string, parentId: string | null, session: CDPSessionLike): void;
    /**
     * Parent/child session emitted a `frameDetached`.
     */
    onFrameDetached(frameId: string, reason?: "remove" | "swap" | string): void;
    /**
     * Parent/child session emitted a `frameNavigated`.
     * Topology + ownership update. Handles root swaps.
     */
    onFrameNavigated(frame: Protocol.Page.Frame, session: CDPSessionLike): void;
    onNavigatedWithinDocument(frameId: string, url: string, session: CDPSessionLike): void;
    /**
     * An OOPIF child session whose **main** frame id equals the parent iframe’s frameId
     * has been attached; adopt the session into this Page and seed ownership for its subtree.
     */
    adoptOopifSession(childSession: CDPSessionLike, childMainFrameId: string): void;
    /** Detach an adopted child session and prune its subtree */
    detachOopifSession(sessionId: string): void;
    /** Return the owning CDP session for a frameId (falls back to main session) */
    getSessionForFrame(frameId: string): CDPSessionLike;
    /** Always returns a Frame bound to the owning session */
    frameForId(frameId: string): Frame;
    /** Expose a session by id (used by snapshot to resolve session id -> session) */
    getSessionById(id: string): CDPSessionLike | undefined;
    registerSessionForNetwork(session: CDPSessionLike): void;
    unregisterSessionForNetwork(sessionId: string | undefined): void;
    on(event: "console", listener: ConsoleListener): Page;
    once(event: "console", listener: ConsoleListener): Page;
    off(event: "console", listener: ConsoleListener): Page;
    targetId(): string;
    /**
     * Send a CDP command through the main session.
     * Allows external consumers to execute arbitrary Chrome DevTools Protocol commands.
     *
     * @param method - The CDP method name (e.g., "Page.enable", "Runtime.evaluate")
     * @param params - Optional parameters for the CDP command
     * @returns Promise resolving to the typed CDP response
     *
     * @example
     * // Enable the Runtime domain
     * await page.sendCDP("Runtime.enable");
     *
     * @example
     * // Evaluate JavaScript with typed response
     * const result = await page.sendCDP<Protocol.Runtime.EvaluateResponse>(
     *   "Runtime.evaluate",
     *   { expression: "1 + 1" }
     * );
     */
    sendCDP<T = unknown>(method: string, params?: object): Promise<T>;
    /** Seed the cached URL before navigation events converge. */
    seedCurrentUrl(url: string | undefined | null): void;
    mainFrameId(): string;
    mainFrame(): Frame;
    /**
     * Close this top-level page (tab). Best-effort via Target.closeTarget.
     */
    close(): Promise<void>;
    getFullFrameTree(): Protocol.Page.FrameTree;
    asProtocolFrameTree(rootMainFrameId: string): Protocol.Page.FrameTree;
    private ensureOrdinal;
    /** Public getter for snapshot code / handlers. */
    getOrdinal(frameId: string): number;
    listAllFrameIds(): string[];
    private ensureConsoleTaps;
    private installConsoleTap;
    private sessionKey;
    private resolveSessionByKey;
    private teardownConsoleTap;
    private removeAllConsoleTaps;
    private emitConsole;
    /**
     * Navigate the page; optionally wait for a lifecycle state.
     * Waits on the **current** main frame and follows root swaps during navigation.
     */
    goto(url: string, options?: {
        waitUntil?: LoadState;
        timeoutMs?: number;
    }): Promise<Response$1 | null>;
    /**
     * Reload the page; optionally wait for a lifecycle state.
     */
    reload(options?: {
        waitUntil?: LoadState;
        timeoutMs?: number;
        ignoreCache?: boolean;
    }): Promise<Response$1 | null>;
    /**
     * Navigate back in history if possible; optionally wait for a lifecycle state.
     */
    goBack(options?: {
        waitUntil?: LoadState;
        timeoutMs?: number;
    }): Promise<Response$1 | null>;
    /**
     * Navigate forward in history if possible; optionally wait for a lifecycle state.
     */
    goForward(options?: {
        waitUntil?: LoadState;
        timeoutMs?: number;
    }): Promise<Response$1 | null>;
    /**
     * Return the current page URL (synchronous, cached from navigation events).
     */
    url(): string;
    private beginNavigationCommand;
    isCurrentNavigationCommand(id: number): boolean;
    /**
     * Return the current page title.
     * Prefers reading from the active document via Runtime.evaluate to reflect dynamic changes.
     * Falls back to navigation history title if evaluation is unavailable.
     */
    title(): Promise<string>;
    /**
     * Capture a screenshot with Playwright-style options.
     *
     * @param options Optional screenshot configuration.
     * @param options.animations Control CSS/Web animations during capture. Use
     * "disabled" to fast-forward finite animations and pause infinite ones.
     * @param options.caret Either hide the text caret (default) or leave it
     * visible via "initial".
     * @param options.clip Restrict capture to a specific rectangle (in CSS
     * pixels). Cannot be combined with `fullPage`.
     * @param options.fullPage Capture the full scrollable page instead of the
     * current viewport.
     * @param options.mask Array of locators that should be covered with an
     * overlay while the screenshot is taken.
     * @param options.maskColor CSS color used for the mask overlay (default
     * `#FF00FF`).
     * @param options.omitBackground Make the default page background transparent
     * (PNG only).
     * @param options.path File path to write the screenshot to. The file extension
     * determines the image type when `type` is not explicitly provided.
     * @param options.quality JPEG quality (0–100). Only applies when
     * `type === "jpeg"`.
     * @param options.scale Render scale: use "css" for one pixel per CSS pixel,
     * otherwise the default "device" leverages the current device pixel ratio.
     * @param options.style Additional CSS text injected into every frame before
     * capture (removed afterwards).
     * @param options.timeout Maximum capture duration in milliseconds before a
     * timeout error is thrown.
     * @param options.type Image format (`"png"` by default).
     */
    screenshot(options?: ScreenshotOptions): Promise<Buffer>;
    /**
     * Create a locator bound to the current main frame.
     */
    locator(selector: string): ReturnType<Frame["locator"]>;
    /**
     * Deep locator that supports cross-iframe traversal.
     * - Recognizes '>>' hop notation to enter iframe contexts.
     * - Supports deep XPath that includes iframe steps (e.g., '/html/body/iframe[2]//div').
     * Returns a Locator scoped to the appropriate frame.
     */
    deepLocator(selector: string): DeepLocatorDelegate;
    /**
     * Frame locator similar to Playwright: targets iframe elements and scopes
     * subsequent locators to that frame. Supports chaining.
     */
    frameLocator(selector: string): FrameLocator;
    /**
     * List all frames belonging to this page as Frame objects bound to their owning sessions.
     * The list is ordered by a stable ordinal assigned during the page lifetime.
     */
    frames(): Frame[];
    /**
     * Wait until the page reaches a lifecycle state on the current main frame.
     * Mirrors Playwright's API signatures.
     */
    waitForLoadState(state: LoadState, timeoutMs?: number): Promise<void>;
    /**
     * Evaluate a function or expression in the current main frame's isolated world.
     * - If a string is provided, it is treated as a JS expression.
     * - If a function is provided, it is stringified and invoked with the optional argument.
     * - The return value should be JSON-serializable. Non-serializable objects will
     *   best-effort serialize via JSON.stringify inside the page context.
     */
    evaluate<R = unknown, Arg = unknown>(pageFunctionOrExpression: string | ((arg: Arg) => R | Promise<R>), arg?: Arg): Promise<R>;
    /**
     * Force the page viewport to an exact CSS size and device scale factor.
     * Ensures screenshots match width x height pixels when deviceScaleFactor = 1.
     */
    setViewportSize(width: number, height: number, options?: {
        deviceScaleFactor?: number;
    }): Promise<void>;
    /**
     * Click at absolute page coordinates (CSS pixels).
     * Dispatches mouseMoved → mousePressed → mouseReleased via CDP Input domain
     * on the top-level page target's session. Coordinates are relative to the
     * viewport origin (top-left). Does not scroll.
     */
    click(x: number, y: number, options: {
        button?: "left" | "right" | "middle";
        clickCount?: number;
        returnXpath: true;
    }): Promise<string>;
    click(x: number, y: number, options?: {
        button?: "left" | "right" | "middle";
        clickCount?: number;
        returnXpath?: false;
    }): Promise<void>;
    click(x: number, y: number, options: {
        button?: "left" | "right" | "middle";
        clickCount?: number;
        returnXpath: boolean;
    }): Promise<void | string>;
    scroll(x: number, y: number, deltaX: number, deltaY: number, options: {
        returnXpath: true;
    }): Promise<string>;
    scroll(x: number, y: number, deltaX: number, deltaY: number, options?: {
        returnXpath?: false;
    }): Promise<void>;
    scroll(x: number, y: number, deltaX: number, deltaY: number, options: {
        returnXpath: boolean;
    }): Promise<void | string>;
    /**
     * Drag from (fromX, fromY) to (toX, toY) using mouse events.
     * Sends mouseMoved → mousePressed → mouseMoved (steps) → mouseReleased.
     */
    dragAndDrop(fromX: number, fromY: number, toX: number, toY: number, options: {
        button?: "left" | "right" | "middle";
        steps?: number;
        delay?: number;
        returnXpath: true;
    }): Promise<[string, string]>;
    dragAndDrop(fromX: number, fromY: number, toX: number, toY: number, options?: {
        button?: "left" | "right" | "middle";
        steps?: number;
        delay?: number;
        returnXpath?: false;
    }): Promise<void>;
    dragAndDrop(fromX: number, fromY: number, toX: number, toY: number, options: {
        button?: "left" | "right" | "middle";
        steps?: number;
        delay?: number;
        returnXpath: boolean;
    }): Promise<void | [string, string]>;
    /**
     * Type a string by dispatching keyDown/keyUp events per character.
     * Focus must already be on the desired element. Uses CDP Input.dispatchKeyEvent
     * and never falls back to Input.insertText. Optional delay applies between
     * successive characters.
     */
    type(text: string, options?: {
        delay?: number;
        withMistakes?: boolean;
    }): Promise<void>;
    /**
     * Press a single key or key combination (keyDown then keyUp).
     * For printable characters, uses the text path on keyDown; for named keys, sets key/code/VK.
     * Supports key combinations with modifiers like "Cmd+A", "Ctrl+C", "Shift+Tab", etc.
     */
    keyPress(key: string, options?: {
        delay?: number;
    }): Promise<void>;
    private _pressedModifiers;
    /** Press a key down without releasing it */
    private keyDown;
    /** Release a pressed key */
    private keyUp;
    /** Normalize modifier key names to match CDP expectations */
    private normalizeModifierKey;
    /**
     * Get the map of named keys with their properties
     */
    private getNamedKeys;
    /**
     * Minimal description for printable keys (letters/digits/space) to provide code and VK.
     * Used when non-Shift modifiers are pressed to avoid sending text while keeping accelerator info.
     */
    private describePrintableKey;
    private isMacOS;
    /**
     * Return Chromium mac editing commands (without trailing ':') for a given code like 'KeyA'
     * Only used on macOS to trigger system editing shortcuts (e.g., selectAll, copy, paste...).
     */
    private macCommandsFor;
    /**
     * Create an isolated world for the **current** main frame and return its context id.
     */
    private createIsolatedWorldForCurrentMain;
    /**
     * Wait until the **current** main frame reaches a lifecycle state.
     * - Fast path via `document.readyState`.
     * - Event path listens at the session level and compares incoming `frameId`
     *   to `mainFrameId()` **at event time** to follow root swaps.
     */
    waitForMainLoadState(state: LoadState, timeoutMs?: number): Promise<void>;
}

interface AgentAction {
    type: string;
    reasoning?: string;
    taskCompleted?: boolean;
    action?: string;
    timeMs?: number;
    pageText?: string;
    pageUrl?: string;
    instruction?: string;
    [key: string]: unknown;
}
interface AgentResult {
    success: boolean;
    message: string;
    actions: AgentAction[];
    completed: boolean;
    metadata?: Record<string, unknown>;
    usage?: {
        input_tokens: number;
        output_tokens: number;
        reasoning_tokens?: number;
        cached_input_tokens?: number;
        inference_time_ms: number;
    };
}
interface AgentExecuteOptions {
    instruction: string;
    maxSteps?: number;
    page?: Page$1 | Page$2 | Page$3 | Page;
    highlightCursor?: boolean;
}
type AgentType = "openai" | "anthropic" | "google";
declare const AVAILABLE_CUA_MODELS: readonly ["openai/computer-use-preview", "openai/computer-use-preview-2025-03-11", "anthropic/claude-3-7-sonnet-latest", "anthropic/claude-haiku-4-5-20251001", "anthropic/claude-sonnet-4-20250514", "anthropic/claude-sonnet-4-5-20250929", "google/gemini-2.5-computer-use-preview-10-2025"];
type AvailableCuaModel = (typeof AVAILABLE_CUA_MODELS)[number];
interface AgentExecutionOptions<TOptions extends AgentExecuteOptions = AgentExecuteOptions> {
    options: TOptions;
    logger: (message: LogLine) => void;
    retries?: number;
}
interface AgentHandlerOptions {
    modelName: string;
    clientOptions?: Record<string, unknown>;
    userProvidedInstructions?: string;
    experimental?: boolean;
}
interface ActionExecutionResult {
    success: boolean;
    error?: string;
    data?: unknown;
}
interface ToolUseItem extends ResponseItem {
    type: "tool_use";
    id: string;
    name: string;
    input: Record<string, unknown>;
}
interface AnthropicMessage {
    role: string;
    content: string | Array<AnthropicContentBlock>;
}
interface AnthropicContentBlock {
    type: string;
    [key: string]: unknown;
}
interface AnthropicTextBlock extends AnthropicContentBlock {
    type: "text";
    text: string;
}
interface AnthropicToolResult {
    type: "tool_result";
    tool_use_id: string;
    content: string | Array<AnthropicContentBlock>;
}
interface ResponseItem {
    type: string;
    id: string;
    [key: string]: unknown;
}
interface ComputerCallItem extends ResponseItem {
    type: "computer_call";
    call_id: string;
    action: {
        type: string;
        [key: string]: unknown;
    };
    pending_safety_checks?: Array<{
        id: string;
        code: string;
        message: string;
    }>;
}
interface FunctionCallItem extends ResponseItem {
    type: "function_call";
    call_id: string;
    name: string;
    arguments: string;
}
type ResponseInputItem = {
    role: string;
    content: string;
} | {
    type: "computer_call_output";
    call_id: string;
    output: {
        type: "input_image";
        image_url: string;
        current_url?: string;
        error?: string;
        [key: string]: unknown;
    } | string;
    acknowledged_safety_checks?: Array<{
        id: string;
        code: string;
        message: string;
    }>;
} | {
    type: "function_call_output";
    call_id: string;
    output: string;
};
interface AgentInstance {
    execute: (instructionOrOptions: string | AgentExecuteOptions) => Promise<AgentResult>;
}
type AgentProviderType = AgentType;
type AgentModelConfig<TModelName extends string = string> = {
    modelName: TModelName;
} & Record<string, unknown>;
type AgentConfig = {
    /**
     * Custom system prompt to provide to the agent. Overrides the default system prompt.
     */
    systemPrompt?: string;
    /**
     * MCP integrations - Array of Client objects
     */
    integrations?: (Client | string)[];
    /**
     * Tools passed to the agent client
     */
    tools?: ToolSet;
    /**
     * Indicates CUA is disabled for this configuration
     */
    cua?: boolean;
    /**
     * The model to use for agent functionality
     */
    model?: string | AgentModelConfig<string>;
    /**
     * The model to use for tool execution (observe/act calls within agent tools).
     * If not specified, inherits from the main model configuration.
     * Format: "provider/model" (e.g., "openai/gpt-4o-mini", "google/gemini-2.0-flash-exp")
     */
    executionModel?: string | AgentModelConfig<string>;
    /**
     * Custom LLM client for the agent (non-CUA). Overrides model resolution.
     */
    llmClient?: LLMClient;
};

declare class StagehandAPIError extends Error {
    constructor(message: string);
}
declare class StagehandAPIUnauthorizedError extends StagehandAPIError {
    constructor(message?: string);
}
declare class StagehandHttpError extends StagehandAPIError {
    constructor(message: string);
}
declare class StagehandServerError extends StagehandAPIError {
    constructor(message: string);
}
declare class StagehandResponseBodyError extends StagehandAPIError {
    constructor();
}
declare class StagehandResponseParseError extends StagehandAPIError {
    constructor(message: string);
}

interface ActOptions {
    model?: ModelConfiguration;
    variables?: Record<string, string>;
    timeout?: number;
    page?: Page$1 | Page$2 | Page$3 | Page;
}
interface ActResult {
    success: boolean;
    message: string;
    actionDescription: string;
    actions: Action[];
}
type ExtractResult<T extends z$1.AnyZodObject> = z$1.infer<T>;
interface Action {
    selector: string;
    description: string;
    method?: string;
    arguments?: string[];
}
interface HistoryEntry {
    method: "act" | "extract" | "observe" | "navigate" | "agent";
    parameters: unknown;
    result: unknown;
    timestamp: string;
}
interface ExtractOptions {
    model?: ModelConfiguration;
    timeout?: number;
    selector?: string;
    page?: Page$1 | Page$2 | Page$3 | Page;
}
declare const defaultExtractSchema: z$1.ZodObject<{
    extraction: z$1.ZodString;
}, "strip", z$1.ZodTypeAny, {
    extraction?: string;
}, {
    extraction?: string;
}>;
declare const pageTextSchema: z$1.ZodObject<{
    pageText: z$1.ZodString;
}, "strip", z$1.ZodTypeAny, {
    pageText?: string;
}, {
    pageText?: string;
}>;
interface ObserveOptions {
    model?: ModelConfiguration;
    timeout?: number;
    selector?: string;
    page?: Page$1 | Page$2 | Page$3 | Page;
}
declare enum V3FunctionName {
    ACT = "ACT",
    EXTRACT = "EXTRACT",
    OBSERVE = "OBSERVE",
    AGENT = "AGENT"
}

interface StagehandMetrics {
    actPromptTokens: number;
    actCompletionTokens: number;
    actReasoningTokens: number;
    actCachedInputTokens: number;
    actInferenceTimeMs: number;
    extractPromptTokens: number;
    extractCompletionTokens: number;
    extractReasoningTokens: number;
    extractCachedInputTokens: number;
    extractInferenceTimeMs: number;
    observePromptTokens: number;
    observeCompletionTokens: number;
    observeReasoningTokens: number;
    observeCachedInputTokens: number;
    observeInferenceTimeMs: number;
    agentPromptTokens: number;
    agentCompletionTokens: number;
    agentReasoningTokens: number;
    agentCachedInputTokens: number;
    agentInferenceTimeMs: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalReasoningTokens: number;
    totalCachedInputTokens: number;
    totalInferenceTimeMs: number;
}

type V3Env = "LOCAL" | "BROWSERBASE";
/** Local launch options for V3 (chrome-launcher + CDP).
 * Matches v2 shape where feasible; unsupported fields are accepted but ignored.
 */
interface LocalBrowserLaunchOptions {
    args?: string[];
    executablePath?: string;
    userDataDir?: string;
    preserveUserDataDir?: boolean;
    headless?: boolean;
    devtools?: boolean;
    chromiumSandbox?: boolean;
    ignoreDefaultArgs?: boolean | string[];
    proxy?: {
        server: string;
        bypass?: string;
        username?: string;
        password?: string;
    };
    locale?: string;
    viewport?: {
        width: number;
        height: number;
    };
    deviceScaleFactor?: number;
    hasTouch?: boolean;
    ignoreHTTPSErrors?: boolean;
    cdpUrl?: string;
    connectTimeoutMs?: number;
    downloadsPath?: string;
    acceptDownloads?: boolean;
}
/** Constructor options for V3 */
interface V3Options {
    env: V3Env;
    apiKey?: string;
    projectId?: string;
    /**
     * Optional: fine-tune Browserbase session creation or resume an existing session.
     */
    browserbaseSessionCreateParams?: Omit<Browserbase.Sessions.SessionCreateParams, "projectId"> & {
        projectId?: string;
    };
    browserbaseSessionID?: string;
    localBrowserLaunchOptions?: LocalBrowserLaunchOptions;
    model?: ModelConfiguration;
    llmClient?: LLMClient;
    systemPrompt?: string;
    logInferenceToFile?: boolean;
    experimental?: boolean;
    verbose?: 0 | 1 | 2;
    selfHeal?: boolean;
    /** Disable pino logging backend (useful for tests or minimal environments). */
    disablePino?: boolean;
    /** Optional external logger hook for integrating with host apps. */
    logger?: (line: LogLine) => void;
    /** Directory used to persist cached actions for act(). */
    cacheDir?: string;
    domSettleTimeout?: number;
    disableAPI?: boolean;
}

declare class StagehandError extends Error {
    constructor(message: string);
}
declare class StagehandDefaultError extends StagehandError {
    constructor(error?: unknown);
}
declare class StagehandEnvironmentError extends StagehandError {
    constructor(currentEnvironment: string, requiredEnvironment: string, feature: string);
}
declare class MissingEnvironmentVariableError extends StagehandError {
    constructor(missingEnvironmentVariable: string, feature: string);
}
declare class UnsupportedModelError extends StagehandError {
    constructor(supportedModels: string[], feature?: string);
}
declare class UnsupportedModelProviderError extends StagehandError {
    constructor(supportedProviders: string[], feature?: string);
}
declare class UnsupportedAISDKModelProviderError extends StagehandError {
    constructor(provider: string, supportedProviders: string[]);
}
declare class InvalidAISDKModelFormatError extends StagehandError {
    constructor(modelName: string);
}
declare class StagehandNotInitializedError extends StagehandError {
    constructor(prop: string);
}
declare class BrowserbaseSessionNotFoundError extends StagehandError {
    constructor();
}
declare class CaptchaTimeoutError extends StagehandError {
    constructor();
}
declare class MissingLLMConfigurationError extends StagehandError {
    constructor();
}
declare class HandlerNotInitializedError extends StagehandError {
    constructor(handlerType: string);
}
declare class StagehandInvalidArgumentError extends StagehandError {
    constructor(message: string);
}
declare class StagehandElementNotFoundError extends StagehandError {
    constructor(xpaths: string[]);
}
declare class AgentScreenshotProviderError extends StagehandError {
    constructor(message: string);
}
declare class StagehandMissingArgumentError extends StagehandError {
    constructor(message: string);
}
declare class CreateChatCompletionResponseError extends StagehandError {
    constructor(message: string);
}
declare class StagehandEvalError extends StagehandError {
    constructor(message: string);
}
declare class StagehandDomProcessError extends StagehandError {
    constructor(message: string);
}
declare class StagehandClickError extends StagehandError {
    constructor(message: string, selector: string);
}
declare class LLMResponseError extends StagehandError {
    constructor(primitive: string, message: string);
}
declare class StagehandIframeError extends StagehandError {
    constructor(frameUrl: string, message: string);
}
declare class ContentFrameNotFoundError extends StagehandError {
    constructor(selector: string);
}
declare class XPathResolutionError extends StagehandError {
    constructor(xpath: string);
}
declare class ExperimentalApiConflictError extends StagehandError {
    constructor();
}
declare class ExperimentalNotConfiguredError extends StagehandError {
    constructor(featureName: string);
}
declare class CuaModelRequiredError extends StagehandError {
    constructor(availableModels: readonly string[]);
}
declare class ZodSchemaValidationError extends Error {
    readonly received: unknown;
    readonly issues: ReturnType<ZodError["format"]>;
    constructor(received: unknown, issues: ReturnType<ZodError["format"]>);
}
declare class StagehandInitError extends StagehandError {
    constructor(message: string);
}
declare class MCPConnectionError extends StagehandError {
    readonly serverUrl: string;
    readonly originalError: unknown;
    constructor(serverUrl: string, originalError: unknown);
}
declare class StagehandShadowRootMissingError extends StagehandError {
    constructor(detail?: string);
}
declare class StagehandShadowSegmentEmptyError extends StagehandError {
    constructor();
}
declare class StagehandShadowSegmentNotFoundError extends StagehandError {
    constructor(segment: string, hint?: string);
}
declare class ElementNotVisibleError extends StagehandError {
    constructor(selector: string);
}
declare class ResponseBodyError extends StagehandError {
    constructor(message: string);
}
declare class ResponseParseError extends StagehandError {
    constructor(message: string);
}
declare class TimeoutError extends StagehandError {
    constructor(operation: string, timeoutMs: number);
}
declare class PageNotFoundError extends StagehandError {
    constructor(identifier: string);
}
declare class ConnectionTimeoutError extends StagehandError {
    constructor(message: string);
}

declare class AISdkClient extends LLMClient {
    type: "aisdk";
    private model;
    constructor({ model }: {
        model: LanguageModelV2;
    });
    getLanguageModel(): LanguageModelV2;
    createChatCompletion<T = ChatCompletion>({ options, }: CreateChatCompletionOptions): Promise<T>;
}

interface StagehandAPIConstructorParams {
    apiKey: string;
    projectId: string;
    logger: (message: LogLine) => void;
}
interface StartSessionParams {
    modelName: string;
    modelApiKey: string;
    domSettleTimeoutMs: number;
    verbose: number;
    systemPrompt?: string;
    browserbaseSessionCreateParams?: Omit<Browserbase.Sessions.SessionCreateParams, "projectId"> & {
        projectId?: string;
    };
    selfHeal?: boolean;
    browserbaseSessionID?: string;
}
interface StartSessionResult {
    sessionId: string;
    available?: boolean;
}
interface APIActParameters {
    input: string | Action;
    options?: ActOptions;
    frameId?: string;
}
interface APIExtractParameters {
    instruction?: string;
    schema?: ZodTypeAny;
    options?: ExtractOptions;
    frameId?: string;
}
interface APIObserveParameters {
    instruction?: string;
    options?: ObserveOptions;
    frameId?: string;
}
interface SerializableResponse {
    requestId: string;
    frameId?: string;
    loaderId?: string;
    response: Protocol.Network.Response;
    fromServiceWorkerFlag?: boolean;
    finishedSettled?: boolean;
    extraInfoHeaders?: Protocol.Network.Headers | null;
    extraInfoHeadersText?: string;
}

/**
 * Represents a path through a Zod schema from the root object down to a
 * particular field. The `segments` array describes the chain of keys/indices.
 *
 * - **String** segments indicate object property names.
 * - **Number** segments indicate array indices.
 *
 * For example, `["users", 0, "homepage"]` might describe reaching
 * the `homepage` field in `schema.users[0].homepage`.
 */
interface ZodPathSegments {
    /**
     * The ordered list of keys/indices leading from the schema root
     * to the targeted field.
     */
    segments: Array<string | number>;
}

type EvaluateOptions = {
    /** The question to ask about the task state */
    question: string;
    /** The answer to the question */
    answer?: string;
    /** Whether to take a screenshot of the task state, or array of screenshots to evaluate */
    screenshot?: boolean | Buffer[];
    /** Custom system prompt for the evaluator */
    systemPrompt?: string;
    /** Delay in milliseconds before taking the screenshot @default 250 */
    screenshotDelayMs?: number;
    /** The agent's reasoning/thought process for completing the task */
    agentReasoning?: string;
};
type BatchAskOptions = {
    /** Array of questions with optional answers */
    questions: Array<{
        question: string;
        answer?: string;
    }>;
    /** Whether to take a screenshot of the task state */
    screenshot?: boolean;
    /** Custom system prompt for the evaluator */
    systemPrompt?: string;
    /** Delay in milliseconds before taking the screenshot @default 1000 */
    screenshotDelayMs?: number;
};
/**
 * Result of an evaluation
 */
interface EvaluationResult {
    /**
     * The evaluation result ('YES', 'NO', or 'INVALID' if parsing failed or value was unexpected)
     */
    evaluation: "YES" | "NO" | "INVALID";
    /**
     * The reasoning behind the evaluation
     */
    reasoning: string;
}

/**
 * V3Context
 *
 * Owns the root CDP connection and wires Target/Page events into Page.
 * Maintains one Page per top-level target, adopts OOPIF child sessions into the owner Page,
 * and tracks target→page and (root) frame→target mappings for lookups.
 *
 * IMPORTANT: FrameId → session ownership is managed inside Page (via its FrameRegistry).
 * Context never “guesses” owners; it simply forwards events (with the emitting session)
 * so Page can record the correct owner at event time.
 */
declare class V3Context {
    readonly conn: CdpConnection;
    private readonly env;
    private readonly apiClient;
    private readonly localBrowserLaunchOptions;
    private constructor();
    private readonly _piercerInstalled;
    private _lastPopupSignalAt;
    private sessionKey;
    private readonly _sessionInit;
    private pagesByTarget;
    private mainFrameToTarget;
    private sessionOwnerPage;
    private frameOwnerPage;
    private pendingOopifByMainFrame;
    private createdAtByTarget;
    private typeByTarget;
    private _pageOrder;
    private pendingCreatedTargetUrl;
    /**
     * Create a Context for a given CDP websocket URL and bootstrap target wiring.
     */
    static create(wsUrl: string, opts?: {
        env?: "LOCAL" | "BROWSERBASE";
        apiClient?: StagehandAPIClient | null;
        localBrowserLaunchOptions?: LocalBrowserLaunchOptions | null;
    }): Promise<V3Context>;
    /**
     * Wait until at least one top-level Page has been created and registered.
     * We poll internal maps that bootstrap/onAttachedToTarget populate.
     */
    private waitForFirstTopLevelPage;
    private waitForInitialTopLevelTargets;
    private ensurePiercer;
    /** Mark a page target as the most-recent one (active). */
    private _pushActive;
    /** Remove a page target from the recency list (used on close). */
    private _removeFromOrder;
    /** Return the current active Page (most-recent page that still exists). */
    activePage(): Page | undefined;
    /** Explicitly mark a known Page as the most-recent active page (and focus it). */
    setActivePage(page: Page): void;
    /**
     * Return top-level `Page`s (oldest → newest). OOPIF targets are not included.
     */
    pages(): Page[];
    /**
     * Resolve an owning `Page` by the **top-level main frame id**.
     * Note: child (OOPIF) roots are intentionally not present in this mapping.
     */
    resolvePageByMainFrameId(frameId: string): Page | undefined;
    /**
     * Serialize the full frame tree for a given top-level main frame id.
     */
    getFullFrameTreeByMainFrameId(rootMainFrameId: string): Promise<Protocol.Page.FrameTree>;
    /**
     * Create a new top-level page (tab) with the given URL and return its Page object.
     * Waits until the target is attached and registered.
     */
    newPage(url?: string): Promise<Page>;
    /**
     * Close CDP and clear all mappings. Best-effort cleanup.
     */
    close(): Promise<void>;
    /**
     * Bootstrap target lifecycle:
     * - Attach to existing targets.
     * - Attach on `Target.targetCreated` (fallback for OOPIFs).
     * - Handle auto-attach events.
     * - Clean up on detach/destroy.
     */
    private bootstrap;
    /**
     * Handle a newly attached target (top-level or potential OOPIF):
     * - Enable Page domain and lifecycle events.
     * - If top-level → create Page, wire listeners, resume.
     * - Else → probe child root frame id via `Page.getFrameTree` and adopt immediately
     *   if the parent is known; otherwise stage until parent `frameAttached`.
     * - Resume the target only after listeners are wired.
     */
    private onAttachedToTarget;
    /**
     * Detach handler:
     * - Remove child session ownership and prune its subtree.
     * - If a top-level target, cleanup its `Page` and mappings.
     * - Drop any staged child for this session.
     */
    private onDetachedFromTarget;
    /**
     * Cleanup a top-level Page by target id, removing its root and staged children.
     */
    private cleanupByTarget;
    /**
     * Wire Page-domain frame events for a session into the owning Page & mappings.
     * We forward the *emitting session* with every event so Page can stamp ownership precisely.
     */
    private installFrameEventBridges;
    /**
     * Register that a session belongs to a Page (used by event routing).
     */
    private wireSessionToOwnerPage;
    /**
     * Utility: reverse-lookup the top-level target id that owns a given Page.
     */
    private findTargetIdByPage;
    private _notePopupSignal;
    /**
     * Await the current active page, waiting briefly if a popup/open was just triggered.
     * Normal path returns immediately; popup path waits up to timeoutMs for the new page.
     */
    awaitActivePage(timeoutMs?: number): Promise<Page>;
}

type AgentReplayStep = AgentReplayActStep | AgentReplayFillFormStep | AgentReplayGotoStep | AgentReplayScrollStep | AgentReplayWaitStep | AgentReplayNavBackStep | {
    type: string;
    [key: string]: unknown;
};
interface AgentReplayActStep {
    type: "act";
    instruction: string;
    actions?: Action[];
    actionDescription?: string;
    message?: string;
    timeout?: number;
}
interface AgentReplayFillFormStep {
    type: "fillForm";
    fields?: Array<{
        action: string;
        value: string;
    }>;
    observeResults?: Action[];
    actions?: Action[];
}
interface AgentReplayGotoStep {
    type: "goto";
    url: string;
    waitUntil?: LoadState;
}
interface AgentReplayScrollStep {
    type: "scroll";
    deltaX?: number;
    deltaY?: number;
    anchor?: {
        x: number;
        y: number;
    };
}
interface AgentReplayWaitStep {
    type: "wait";
    timeMs: number;
}
interface AgentReplayNavBackStep {
    type: "navback";
    waitUntil?: LoadState;
}

/**
 * V3
 *
 * Purpose:
 * A high-level orchestrator for Stagehand V3. Abstracts away whether the browser
 * runs **locally via Chrome** or remotely on **Browserbase**, and exposes simple
 * entrypoints (`act`, `extract`, `observe`) that delegate to the corresponding
 * handler classes.
 *
 * Responsibilities:
 * - Bootstraps Chrome or Browserbase, ensures a working CDP WebSocket, and builds a `V3Context`.
 * - Manages lifecycle: init, context access, cleanup.
 * - Bridges external page objects (Playwright/Puppeteer) into internal frameIds for handlers.
 * - Provides a stable API surface for downstream code regardless of runtime environment.
 */
declare class V3 {
    private readonly opts;
    private state;
    private actHandler;
    private extractHandler;
    private observeHandler;
    private ctx;
    llmClient: LLMClient;
    private modelName;
    private modelClientOptions;
    private llmProvider;
    private overrideLlmClients;
    private readonly domSettleTimeoutMs?;
    private _isClosing;
    browserbaseSessionId?: string;
    get browserbaseSessionID(): string | undefined;
    private _onCdpClosed;
    readonly experimental: boolean;
    readonly logInferenceToFile: boolean;
    readonly disableAPI: boolean;
    private externalLogger?;
    verbose: 0 | 1 | 2;
    private stagehandLogger;
    private _history;
    private readonly instanceId;
    private static _processGuardsInstalled;
    private static _instances;
    private cacheStorage;
    private actCache;
    private agentCache;
    private apiClient;
    stagehandMetrics: StagehandMetrics;
    constructor(opts: V3Options);
    /**
     * Async property for metrics so callers can `await v3.metrics`.
     * When using API mode, fetches metrics from the API. Otherwise returns local metrics.
     */
    get metrics(): Promise<StagehandMetrics>;
    private resolveLlmClient;
    private beginAgentReplayRecording;
    private endAgentReplayRecording;
    private discardAgentReplayRecording;
    private isAgentReplayRecording;
    isAgentReplayActive(): boolean;
    recordAgentReplayStep(step: AgentReplayStep): void;
    /**
     * Async property for history so callers can `await v3.history`.
     * Returns a frozen copy to avoid external mutation.
     */
    get history(): Promise<ReadonlyArray<HistoryEntry>>;
    addToHistory(method: HistoryEntry["method"], parameters: unknown, result?: unknown): void;
    updateMetrics(functionName: V3FunctionName, promptTokens: number, completionTokens: number, reasoningTokens: number, cachedInputTokens: number, inferenceTimeMs: number): void;
    private updateTotalMetrics;
    private _immediateShutdown;
    private static _installProcessGuards;
    /**
     * Entrypoint: initializes handlers, launches Chrome or Browserbase,
     * and sets up a CDP context.
     */
    init(): Promise<void>;
    /** Apply post-connect local browser options that require CDP. */
    private _applyPostConnectLocalOptions;
    private _ensureBrowserbaseDownloadsEnabled;
    /**
     * Run an "act" instruction through the ActHandler.
     *
     * New API:
     * - act(instruction: string, options?: ActOptions)
     * - act(action: Action, options?: ActOptions)
     */
    act(instruction: string, options?: ActOptions): Promise<ActResult>;
    act(action: Action, options?: ActOptions): Promise<ActResult>;
    /**
     * Run an "extract" instruction through the ExtractHandler.
     *
     * Accepted forms:
     * - extract() → pageText
     * - extract(options) → pageText
     * - extract(instruction) → defaultExtractSchema
     * - extract(instruction, schema) → schema-inferred
     * - extract(instruction, schema, options)
     */
    extract(): Promise<z$1.infer<typeof pageTextSchema>>;
    extract(options: ExtractOptions): Promise<z$1.infer<typeof pageTextSchema>>;
    extract(instruction: string, options?: ExtractOptions): Promise<z$1.infer<typeof defaultExtractSchema>>;
    extract<T extends ZodTypeAny>(instruction: string, schema: T, options?: ExtractOptions): Promise<z$1.infer<T>>;
    /**
     * Run an "observe" instruction through the ObserveHandler.
     */
    observe(): Promise<Action[]>;
    observe(options: ObserveOptions): Promise<Action[]>;
    observe(instruction: string, options?: ObserveOptions): Promise<Action[]>;
    /** Return the browser-level CDP WebSocket endpoint. */
    connectURL(): string;
    /** Expose the current CDP-backed context. */
    get context(): V3Context;
    /** Best-effort cleanup of context and launched resources. */
    close(opts?: {
        force?: boolean;
    }): Promise<void>;
    /** Guard: ensure Browserbase credentials exist in options. */
    private requireBrowserbaseCreds;
    get logger(): (logLine: LogLine) => void;
    /**
     * Normalize a Playwright/Puppeteer page object into its top frame id,
     * so handlers can resolve it to a `Page` within our V3Context.
     */
    private resolveTopFrameId;
    private isPlaywrightPage;
    private isPatchrightPage;
    private isPuppeteerPage;
    /** Resolve an external page reference or fall back to the active V3 page. */
    private resolvePage;
    private normalizeToV3Page;
    /**
     * Create a v3 agent instance (AISDK tool-based) with execute().
     * Mirrors the v2 Stagehand.agent() tool mode (no CUA provider here).
     */
    agent(options?: AgentConfig): {
        execute: (instructionOrOptions: string | AgentExecuteOptions) => Promise<AgentResult>;
    };
}

/**
 * Abstract base class for agent clients
 * This provides a common interface for all agent implementations
 */
declare abstract class AgentClient {
    type: AgentType;
    modelName: string;
    clientOptions: Record<string, unknown>;
    userProvidedInstructions?: string;
    constructor(type: AgentType, modelName: string, userProvidedInstructions?: string);
    abstract execute(options: AgentExecutionOptions): Promise<AgentResult>;
    abstract captureScreenshot(options?: Record<string, unknown>): Promise<unknown>;
    abstract setViewport(width: number, height: number): void;
    abstract setCurrentUrl(url: string): void;
    abstract setScreenshotProvider(provider: () => Promise<string>): void;
    abstract setActionHandler(handler: (action: AgentAction) => Promise<void>): void;
}

declare const modelToAgentProviderMap: Record<string, AgentProviderType>;
/**
 * Provider for agent clients
 * This class is responsible for creating the appropriate agent client
 * based on the provider type
 */
declare class AgentProvider {
    private logger;
    /**
     * Create a new agent provider
     */
    constructor(logger: (message: LogLine) => void);
    getClient(modelName: string, clientOptions?: Record<string, unknown>, userProvidedInstructions?: string, tools?: ToolSet$1): AgentClient;
    static getAgentProvider(modelName: string): AgentProviderType;
}

declare function validateZodSchema(schema: z$1.ZodTypeAny, data: unknown): boolean;
/**
 * Detects if the code is running in the Bun runtime environment.
 * @returns {boolean} True if running in Bun, false otherwise.
 */
declare function isRunningInBun(): boolean;
declare function toGeminiSchema(zodSchema: z$1.ZodTypeAny): Schema;
declare function getZodType(schema: z$1.ZodTypeAny): string;
/**
 * Recursively traverses a given Zod schema, scanning for any fields of type `z.string().url()`.
 * For each such field, it replaces the `z.string().url()` with `z.number()`.
 *
 * This function is used internally by higher-level utilities (e.g., transforming entire object schemas)
 * and handles nested objects, arrays, unions, intersections, optionals.
 *
 * @param schema - The Zod schema to transform.
 * @param currentPath - An array of string/number keys representing the current schema path (used internally for recursion).
 * @returns A two-element tuple:
 *   1. The updated Zod schema, with any `.url()` fields replaced by `z.number()`.
 *   2. An array of {@link ZodPathSegments} objects representing each replaced field, including the path segments.
 */
declare function transformSchema(schema: z$1.ZodTypeAny, currentPath: Array<string | number>): [z$1.ZodTypeAny, ZodPathSegments[]];
/**
 * Once we get the final extracted object that has numeric IDs in place of URLs,
 * use `injectUrls` to walk the object and replace numeric IDs
 * with the real URL strings from idToUrlMapping. The `path` may include `*`
 * for array indices (indicating "all items in the array").
 */
declare function injectUrls(obj: unknown, path: Array<string | number>, idToUrlMapping: Record<string, string>): void;
/**
 * Mapping from LLM provider names to their corresponding environment variable names for API keys.
 */
declare const providerEnvVarMap: Partial<Record<ModelProvider | string, string | Array<string>>>;
/**
 * Loads an API key for a provider, checking environment variables.
 * @param provider The name of the provider (e.g., 'openai', 'anthropic')
 * @param logger Optional logger for info/error messages
 * @returns The API key if found, undefined otherwise
 */
declare function loadApiKeyFromEnv(provider: string | undefined, logger: (logLine: LogLine) => void): string | undefined;
declare function trimTrailingTextNode(path: string | undefined): string | undefined;
interface JsonSchemaProperty {
    type: string;
    enum?: unknown[];
    items?: JsonSchemaProperty;
    properties?: Record<string, JsonSchemaProperty>;
    required?: string[];
    minimum?: number;
    maximum?: number;
    description?: string;
}
interface JsonSchema extends JsonSchemaProperty {
    type: string;
}
/**
 * Converts a JSON Schema object to a Zod schema
 * @param schema The JSON Schema object to convert
 * @returns A Zod schema equivalent to the input JSON Schema
 */
declare function jsonSchemaToZod(schema: JsonSchema): ZodTypeAny;

interface ConnectToMCPServerOptions {
    serverUrl: string | URL;
    clientOptions?: ClientOptions$3;
}
interface StdioServerConfig {
    command: string;
    args?: string[];
    env?: Record<string, string>;
}
declare const connectToMCPServer: (serverConfig: string | URL | StdioServerConfig | ConnectToMCPServerOptions) => Promise<Client>;

/**
 * V3Evaluator mirrors Evaluator but operates on a V3 instance instead of Stagehand.
 * It uses the V3 page/screenshot APIs and constructs an LLM client to run
 * structured evaluations (YES/NO with reasoning) on screenshots and/or text.
 */

declare class V3Evaluator {
    private v3;
    private modelName;
    private modelClientOptions;
    private silentLogger;
    constructor(v3: V3, modelName?: AvailableModel, modelClientOptions?: ClientOptions);
    private getClient;
    ask(options: EvaluateOptions): Promise<EvaluationResult>;
    batchAsk(options: BatchAskOptions): Promise<EvaluationResult[]>;
    private _evaluateWithMultipleScreenshots;
}

export { type AISDKCustomProvider, type AISDKProvider, AISdkClient, AVAILABLE_CUA_MODELS, type ActOptions, type ActResult, type Action, type ActionExecutionResult, type AgentAction, type AgentConfig, type AgentExecuteOptions, type AgentExecutionOptions, type AgentHandlerOptions, type AgentInstance, type AgentModelConfig, AgentProvider, type AgentProviderType, type AgentResult, AgentScreenshotProviderError, type AgentType, AnnotatedScreenshotText, type AnthropicContentBlock, type AnthropicJsonSchemaObject, type AnthropicMessage, type AnthropicTextBlock, type AnthropicToolResult, type AnyPage, type AvailableCuaModel, type AvailableModel, BrowserbaseSessionNotFoundError, CaptchaTimeoutError, type ChatCompletionOptions, type ChatMessage, type ChatMessageContent, type ChatMessageImageContent, type ChatMessageTextContent, type ClientOptions, type ComputerCallItem, ConnectionTimeoutError, type ConsoleListener, ConsoleMessage, ContentFrameNotFoundError, type CreateChatCompletionOptions, CreateChatCompletionResponseError, CuaModelRequiredError, ElementNotVisibleError, ExperimentalApiConflictError, ExperimentalNotConfiguredError, type ExtractOptions, type ExtractResult, type FunctionCallItem, HandlerNotInitializedError, type HistoryEntry, InvalidAISDKModelFormatError, type JsonSchema, type JsonSchemaProperty, LLMClient, type LLMResponse, LLMResponseError, type LLMTool, LOG_LEVEL_NAMES, type LoadState, type LocalBrowserLaunchOptions, type LogLevel, type LogLine, type Logger, MCPConnectionError, MissingEnvironmentVariableError, MissingLLMConfigurationError, type ModelConfiguration, type ModelProvider, type ObserveOptions, Page, PageNotFoundError, Response$1 as Response, ResponseBodyError, type ResponseInputItem, type ResponseItem, ResponseParseError, V3 as Stagehand, StagehandAPIError, StagehandAPIUnauthorizedError, StagehandClickError, StagehandDefaultError, StagehandDomProcessError, StagehandElementNotFoundError, StagehandEnvironmentError, StagehandError, StagehandEvalError, StagehandHttpError, StagehandIframeError, StagehandInitError, StagehandInvalidArgumentError, type StagehandMetrics, StagehandMissingArgumentError, StagehandNotInitializedError, StagehandResponseBodyError, StagehandResponseParseError, StagehandServerError, StagehandShadowRootMissingError, StagehandShadowSegmentEmptyError, StagehandShadowSegmentNotFoundError, TimeoutError, type ToolUseItem, UnsupportedAISDKModelProviderError, UnsupportedModelError, UnsupportedModelProviderError, V3, type V3Env, V3Evaluator, V3FunctionName, type V3Options, XPathResolutionError, ZodSchemaValidationError, connectToMCPServer, defaultExtractSchema, getZodType, injectUrls, isRunningInBun, jsonSchemaToZod, loadApiKeyFromEnv, modelToAgentProviderMap, pageTextSchema, providerEnvVarMap, toGeminiSchema, transformSchema, trimTrailingTextNode, validateZodSchema };
