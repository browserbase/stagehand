# frozen_string_literal: true

require "socket"
require "tmpdir"
require "fileutils"

require_relative "errors"
require_relative "timeouts"
require_relative "cdp_client"
require_relative "extension_assets"
require_relative "browserbase_session"
require_relative "generated/models"

module Stagehand
  WorkerInitMetadata = Data.define(:api_key, :browser)

  # A connected browser holding the CDP attachment. Created only by the
  # LocalBrowser / Browserbase factories; claimed by one Stagehand client.
  class StagehandBrowser
    attr_reader :provider, :origin, :session_id

    def initialize(provider:, origin:, cdp_client:, worker_init_metadata:, close_callback:, session_id: nil)
      @provider = provider
      @origin = origin
      @cdp_client = cdp_client
      @worker_init_metadata = worker_init_metadata
      @close_callback = close_callback
      @session_id = session_id
      @claimed = false
      @context = nil
      @close_mutex = Mutex.new
      @closed = false
    end

    def closed?
      @closed
    end

    def context
      if @context.nil?
        raise StagehandError, "Browser context is unavailable. Attach the browser with Stagehand.create(browser: browser)."
      end
      @context
    end

    def close
      @close_mutex.synchronize do
        return if @closed
        @closed = true
      end
      @close_callback.call
      nil
    end

    # Internal wiring used by Stagehand.create and the factories.
    def __claim
      raise StagehandError, "Cannot attach Stagehand to a closed browser" if @closed
      raise StagehandError, "This browser is already attached to a Stagehand instance" if @claimed
      @claimed = true
      [@cdp_client, @worker_init_metadata]
    end

    def __release
      @claimed = false
      @context = nil
    end

    def __attach_context(context)
      raise StagehandError, "This browser already has a Stagehand context" unless @context.nil?
      @context = context
    end
  end

  module LocalBrowser
    WEBMCP_CHROME_FLAG = "--enable-features=WebMCPTesting,DevToolsWebMCPSupport"

    DEFAULT_CHROME_FLAGS = [
      "--disable-features=Translate,OptimizationHints,MediaRouter,DialMediaRouteProvider," \
      "CalculateNativeWinOcclusion,InterestFeedContentSuggestions," \
      "CertificateTransparencyComponentUpdater,AutofillServerCommunication," \
      "PrivacySandboxSettings4,RenderDocument",
      "--disable-component-extensions-with-background-pages",
      "--disable-background-networking",
      "--disable-component-update",
      "--disable-client-side-phishing-detection",
      "--disable-sync",
      "--metrics-recording-only",
      "--disable-default-apps",
      "--mute-audio",
      "--no-default-browser-check",
      "--no-first-run",
      "--disable-backgrounding-occluded-windows",
      "--disable-renderer-backgrounding",
      "--disable-background-timer-throttling",
      "--disable-ipc-flooding-protection",
      "--password-store=basic",
      "--use-mock-keychain",
      "--force-fieldtrials=*BackgroundTracing/default/",
      "--disable-hang-monitor",
      "--disable-prompt-on-repost",
      "--disable-domain-reliability",
      "--propagate-iph-for-testing",
    ].freeze

    STAGEHAND_DEFAULT_FLAGS = [
      "--enable-unsafe-extension-debugging",
      "--remote-allow-origins=*",
    ].freeze

    module_function

    def launch(
      headless: nil,
      devtools: nil,
      chromium_sandbox: nil,
      args: nil,
      executable_path: nil,
      port: nil,
      user_data_dir: nil,
      viewport_width: 1280,
      viewport_height: 800
    )
      deadline = Deadline.stagehand_init
      chrome_path = executable_path || find_chrome_path
      debug_port = port || available_port
      temporary_profile = user_data_dir.nil?
      profile_dir = user_data_dir || Dir.mktmpdir("stagehand-chrome-")

      flags = [
        *DEFAULT_CHROME_FLAGS,
        *STAGEHAND_DEFAULT_FLAGS,
        "--window-size=#{viewport_width},#{viewport_height}",
        WEBMCP_CHROME_FLAG,
        "--remote-debugging-port=#{debug_port}",
        "--user-data-dir=#{profile_dir}",
        *(headless ? ["--headless"] : []),
        *(devtools ? ["--auto-open-devtools-for-tabs"] : []),
        *(ENV["CI"] || chromium_sandbox == false ? ["--no-sandbox"] : []),
        *(args || []),
        "about:blank",
      ]

      # POSIX gets a process group so the whole Chrome tree can be signalled;
      # Windows has no process groups — new_pgroup detaches from Ctrl-C.
      spawn_options = { in: File::NULL, out: File::NULL, err: File::NULL }
      spawn_options[Gem.win_platform? ? :new_pgroup : :pgroup] = true
      pid = Process.spawn(chrome_path, *flags, **spawn_options)
      waiter = Process.detach(pid)
      close_chrome = lambda do
        stop_process(pid, waiter)
      ensure
        FileUtils.remove_entry(profile_dir, true) if temporary_profile
      end

      begin
        connect_browser(
          provider: "local",
          origin: "launched",
          cdp_url: "http://127.0.0.1:#{debug_port}",
          extension_dir: ExtensionAssets.extension_directory,
          deadline: deadline,
          worker_init_metadata: WorkerInitMetadata.new(api_key: nil, browser: nil),
          close_source: close_chrome,
        )
      rescue Exception
        close_chrome.call
        raise
      end
    end

    def connect(cdp_url:, extension_id: nil)
      connect_browser(
        provider: "local",
        origin: "connected",
        cdp_url: cdp_url,
        extension_dir: extension_id.nil? ? ExtensionAssets.extension_directory : nil,
        extension_id: extension_id,
        deadline: Deadline.stagehand_init,
        worker_init_metadata: WorkerInitMetadata.new(api_key: nil, browser: nil),
        close_source: nil,
      )
    end

    def connect_browser(provider:, origin:, cdp_url:, deadline:, worker_init_metadata:, close_source:,
                        extension_dir: nil, extension_id: nil, preloaded_extension: false, session_id: nil)
      cdp_client = CDPClient.connect(
        cdp_url: cdp_url,
        extension_dir: extension_dir&.to_s,
        extension_id: extension_id,
        preloaded_extension: preloaded_extension,
        deadline: deadline,
      )
      close_callback = lambda do
        cdp_client.close
      ensure
        close_source&.call
      end
      StagehandBrowser.new(
        provider: provider,
        origin: origin,
        cdp_client: cdp_client,
        worker_init_metadata: worker_init_metadata,
        close_callback: close_callback,
        session_id: session_id,
      )
    end

    def find_chrome_path
      configured = ENV["CHROME_PATH"]
      return configured if configured && File.file?(configured)

      candidates =
        if Gem.win_platform?
          [ENV.fetch("LOCALAPPDATA", nil), ENV.fetch("PROGRAMFILES", nil), ENV.fetch("PROGRAMFILES(X86)", nil)]
            .compact
            .map { |root| File.join(root, "Google", "Chrome", "Application", "chrome.exe") }
        elsif RUBY_PLATFORM.match?(/darwin/)
          [
            "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
          ]
        else
          %w[google-chrome-stable google-chrome chromium-browser chromium].filter_map do |name|
            ENV.fetch("PATH", "").split(File::PATH_SEPARATOR).map { |dir| File.join(dir, name) }.find { |path| File.file?(path) }
          end
        end
      found = candidates.find { |candidate| File.file?(candidate) }
      raise StagehandError, "Chrome installation not found; set CHROME_PATH" if found.nil?
      found
    end

    def available_port
      server = TCPServer.new("127.0.0.1", 0)
      port = server.addr[1]
      server.close
      port
    end

    def stop_process(pid, waiter)
      return unless waiter.alive?
      if Gem.win_platform?
        # No process groups or graceful SIGTERM on Windows: KILL maps to
        # TerminateProcess, mirroring the Python SDK's terminate()/kill().
        begin
          Process.kill("KILL", pid)
        rescue Errno::ESRCH, Errno::EPERM
          nil
        end
        waiter.join(3)
        return nil
      end
      begin
        Process.kill("TERM", -pid)
      rescue Errno::ESRCH, Errno::EPERM
        nil
      end
      return if waiter.join(3)
      begin
        Process.kill("KILL", -pid)
      rescue Errno::ESRCH, Errno::EPERM
        nil
      end
      waiter.join(3)
      nil
    end
  end

  module Browserbase
    module_function

    def launch(
      api_key:,
      base_url: BrowserbaseSession::DEFAULT_BROWSERBASE_URL,
      extension_id: nil,
      keep_alive: nil,
      proxies: nil,
      region: nil,
      timeout: nil,
      user_metadata: nil,
      browser_settings: nil
    )
      raise ArgumentError, "api_key must not be empty" if api_key.to_s.empty?

      deadline = Deadline.stagehand_init
      session = BrowserbaseSession.create(
        api_key: api_key,
        base_url: base_url,
        extension_id: extension_id,
        keep_alive: keep_alive,
        proxies: proxies,
        region: region,
        timeout: timeout,
        user_metadata: user_metadata,
        browser_settings: browser_settings,
      )

      close_source = keep_alive ? nil : -> { session.close }
      begin
        LocalBrowser.connect_browser(
          provider: "browserbase",
          origin: "launched",
          cdp_url: session.cdp_url,
          preloaded_extension: true,
          deadline: deadline,
          worker_init_metadata: WorkerInitMetadata.new(
            api_key: api_key,
            browser: browser_session_metadata(session.session_id, region),
          ),
          close_source: close_source,
          session_id: session.session_id,
        )
      rescue Exception
        session.close unless keep_alive
        raise
      end
    end

    # Fetches the raw CDP event log for a session, e.g. to verify what actually
    # happened in the browser. Log ingestion is asynchronous: immediately after
    # a session closes this can return [] for a short while (poll if needed).
    def session_logs(api_key:, session_id:, base_url: BrowserbaseSession::DEFAULT_BROWSERBASE_URL)
      raise ArgumentError, "api_key must not be empty" if api_key.to_s.empty?
      BrowserbaseClient.new(api_key: api_key, base_url: base_url).session_logs(session_id)
    end

    def connect(api_key:, session_id:, base_url: BrowserbaseSession::DEFAULT_BROWSERBASE_URL, extension_id: nil)
      connection = BrowserbaseSession.connect(api_key: api_key, base_url: base_url, session_id: session_id)
      LocalBrowser.connect_browser(
        provider: "browserbase",
        origin: "connected",
        cdp_url: connection.cdp_url,
        extension_id: extension_id,
        preloaded_extension: extension_id.nil?,
        deadline: Deadline.stagehand_init,
        worker_init_metadata: WorkerInitMetadata.new(
          api_key: api_key,
          browser: browser_session_metadata(connection.session_id, connection.region),
        ),
        close_source: nil,
        session_id: connection.session_id,
      )
    end

    # Leave region unset (not nil) so the wire payload omits it entirely; the
    # worker schema rejects "region": null.
    def browser_session_metadata(session_id, region)
      values = { session_id: session_id }
      values[:region] = region unless region.nil?
      Models::BrowserSessionMetadata.new(**values)
    end
  end
end
