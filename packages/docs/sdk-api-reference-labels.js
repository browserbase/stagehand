// Re-label generated OpenAPI schema fields on SDK-flavored API reference pages.
//
// Mintlify renders these pages from the OpenAPI wire schema, so body fields use
// camelCase even when the selected SDK accepts snake_case parameters. Stainless
// already emits language-correct code samples; this small client-side patch keeps
// the visible parameter labels aligned with the Python and Ruby SDK snippets.
(function () {
  const SNAKE_CASE_PARAM_LABELS = {
    acceptDownloads: "accept_downloads",
    actTimeoutMs: "act_timeout_ms",
    actionDescription: "action_description",
    actionId: "action_id",
    advancedStealth: "advanced_stealth",
    agentConfig: "agent_config",
    apiKey: "api_key",
    backendNodeId: "backend_node_id",
    baseURL: "base_url",
    blockAds: "block_ads",
    browserSettings: "browser_settings",
    browserbaseAPIKey: "browserbase_api_key",
    browserbaseProjectID: "browserbase_project_id",
    browserbaseSessionCreateParams: "browserbase_session_create_params",
    browserbaseSessionID: "browserbase_session_id",
    cacheEntry: "cache_entry",
    cacheKey: "cache_key",
    captchaImageSelector: "captcha_image_selector",
    captchaInputSelector: "captcha_input_selector",
    cdpHeaders: "cdp_headers",
    cdpUrl: "cdp_url",
    cdpURL: "cdp_url",
    chromiumSandbox: "chromium_sandbox",
    clientLanguage: "client_language",
    connectTimeoutMs: "connect_timeout_ms",
    deviceScaleFactor: "device_scale_factor",
    domSettleTimeoutMs: "dom_settle_timeout_ms",
    domainPattern: "domain_pattern",
    downloadsPath: "downloads_path",
    endTime: "end_time",
    executablePath: "executable_path",
    executeOptions: "execute_options",
    executionModel: "execution_model",
    extensionId: "extension_id",
    extensionID: "extension_id",
    frameId: "frame_id",
    frameID: "frame_id",
    googleAuthOptions: "google_auth_options",
    hasTouch: "has_touch",
    highlightCursor: "highlight_cursor",
    httpVersion: "http_version",
    ignoreDefaultArgs: "ignore_default_args",
    ignoreHTTPSErrors: "ignore_https_errors",
    ignoreSelectors: "ignore_selectors",
    inputTokens: "input_tokens",
    keepAlive: "keep_alive",
    launchOptions: "launch_options",
    logSession: "log_session",
    maxHeight: "max_height",
    maxSteps: "max_steps",
    maxWidth: "max_width",
    minHeight: "min_height",
    minWidth: "min_width",
    modelAPIKey: "model_api_key",
    modelName: "model_name",
    operatingSystems: "operating_systems",
    outputTokens: "output_tokens",
    pageText: "page_text",
    pageUrl: "page_url",
    preserveUserDataDir: "preserve_user_data_dir",
    projectId: "project_id",
    projectID: "project_id",
    recordSession: "record_session",
    rememberMe: "remember_me",
    selfHeal: "self_heal",
    sessionId: "session_id",
    shouldCache: "should_cache",
    solveCaptchas: "solve_captchas",
    streamResponse: "stream_response",
    systemPrompt: "system_prompt",
    taskCompleted: "task_completed",
    timeMs: "time_ms",
    tokenUsage: "token_usage",
    toolTimeout: "tool_timeout",
    universeDomain: "universe_domain",
    useSearch: "use_search",
    userDataDir: "user_data_dir",
    userMetadata: "user_metadata",
    waitForCaptchaSolves: "wait_for_captcha_solves",
    waitUntil: "wait_until",
    xStreamResponse: "x_stream_response",
  };

  const SDK_PARAM_LABELS = {
    python: SNAKE_CASE_PARAM_LABELS,
    ruby: SNAKE_CASE_PARAM_LABELS,
  };

  const CONTENT_SCOPE_SELECTOR = [
    "#content-area",
    "#api-playground-input",
    "api-section",
    "field",
  ].join(",");

  const SKIP_SELECTOR = [
    "code",
    "input",
    "pre",
    "script",
    "style",
    "textarea",
    '[contenteditable="true"]',
  ].join(",");

  let rewriteTimer = null;
  let lastPath = window.location.pathname;

  function currentSdkLanguage() {
    const match = window.location.pathname.match(
      /^\/v3\/api-reference\/([^/]+)(?:\/|$)/,
    );
    return match ? match[1] : null;
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }

  function buildPattern(labels) {
    return new RegExp(
      `\\b(${Object.keys(labels).map(escapeRegExp).join("|")})\\b`,
      "g",
    );
  }

  function shouldRewriteTextNode(node, pattern) {
    if (!node.nodeValue) return false;

    const parent = node.parentElement;
    if (!parent) return false;
    if (parent.closest(SKIP_SELECTOR)) return false;
    if (!parent.closest(CONTENT_SCOPE_SELECTOR)) return false;

    pattern.lastIndex = 0;
    return pattern.test(node.nodeValue);
  }

  function rewriteLabels(root) {
    const labels = SDK_PARAM_LABELS[currentSdkLanguage()];
    if (!labels) return;

    const pattern = buildPattern(labels);
    const walker = document.createTreeWalker(
      root || document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          return shouldRewriteTextNode(node, pattern)
            ? NodeFilter.FILTER_ACCEPT
            : NodeFilter.FILTER_REJECT;
        },
      },
    );

    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);

    for (const node of nodes) {
      pattern.lastIndex = 0;
      node.nodeValue = node.nodeValue.replace(pattern, (name) => labels[name]);
    }
  }

  function scheduleRewrite(root) {
    if (rewriteTimer) window.clearTimeout(rewriteTimer);
    rewriteTimer = window.setTimeout(() => {
      rewriteTimer = null;
      window.requestAnimationFrame(() => rewriteLabels(root || document.body));
    }, 50);
  }

  scheduleRewrite();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          scheduleRewrite(node);
          return;
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  window.setInterval(() => {
    if (window.location.pathname !== lastPath) {
      lastPath = window.location.pathname;
      scheduleRewrite();
    }
  }, 250);
})();
