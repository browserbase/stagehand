# frozen_string_literal: true

require "socket"
require "tmpdir"
require "fileutils"

require_relative "errors"
require_relative "timeouts"
require_relative "cdp_client"
require_relative "extension_assets"
require_relative "browserbase_session"
require_relative "validation"
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
      args: nil,
      executable_path: nil,
      port: nil,
      user_data_dir: nil,
      preserve_user_data_dir: nil,
      headless: nil,
      devtools: nil,
      chromium_sandbox: nil,
      ignore_default_args: nil,
      proxy: nil,
      locale: nil,
      viewport: nil,
      device_scale_factor: nil,
      has_touch: nil,
      ignore_https_errors: nil,
      downloads_path: nil,
      accept_downloads: nil,
      keep_alive: nil
    )
      proxy = normalize_proxy(proxy)
      viewport = normalize_viewport(viewport)
      Validation.positive_integer!(port, "port", max: 65_535) unless port.nil?
      unless ignore_default_args.nil? || ignore_default_args == true || ignore_default_args.is_a?(Array)
        raise ArgumentError, "ignore_default_args must be true or an Array of flag strings"
      end
      if accept_downloads == true && downloads_path.nil?
        raise ArgumentError, "downloads_path is required when accept_downloads is true"
      end

      deadline = Deadline.stagehand_init
      chrome_path = executable_path || find_chrome_path
      debug_port = port || available_port
      temporary_profile = user_data_dir.nil?
      profile_dir = user_data_dir || Dir.mktmpdir("stagehand-chrome-")

      flags = launch_flags(
        debug_port: debug_port,
        profile_dir: profile_dir,
        headless: headless,
        devtools: devtools,
        chromium_sandbox: chromium_sandbox,
        args: args,
        ignore_default_args: ignore_default_args,
        proxy: proxy,
        locale: locale,
        viewport: viewport,
        device_scale_factor: device_scale_factor,
        has_touch: has_touch,
        ignore_https_errors: ignore_https_errors,
      )

      remove_profile = lambda do
        FileUtils.remove_entry(profile_dir, true) if temporary_profile && preserve_user_data_dir != true
      end

      # POSIX gets a process group so the whole Chrome tree can be signalled;
      # Windows has no process groups — new_pgroup detaches from Ctrl-C.
      spawn_options = { in: File::NULL, out: File::NULL, err: File::NULL }
      spawn_options[Gem.win_platform? ? :new_pgroup : :pgroup] = true
      begin
        pid = Process.spawn(chrome_path, *flags, **spawn_options)
      rescue StandardError
        remove_profile.call
        raise
      end
      waiter = Process.detach(pid)
      close_chrome = lambda do
        stop_process(pid, waiter)
      ensure
        remove_profile.call
      end

      # keep_alive relinquishes ownership: close tears down only the CDP
      # client, leaving Chrome running and the profile in place.
      close_source = keep_alive ? nil : close_chrome
      set_download_behavior = download_behavior_hook(downloads_path, accept_downloads)

      begin
        connect_browser(
          provider: "local",
          origin: "launched",
          cdp_url: "http://127.0.0.1:#{debug_port}",
          extension_dir: ExtensionAssets.extension_directory,
          deadline: deadline,
          worker_init_metadata: WorkerInitMetadata.new(api_key: nil, browser: nil),
          close_source: close_source,
          after_connect: set_download_behavior,
        )
      rescue Exception
        close_chrome.call unless keep_alive
        raise
      end
    end

    # Pure options -> Chrome flag list mapping (unit-testable without Chrome).
    # `ignore_default_args` filters exactly the default groups: the shared
    # Chrome defaults, the Stagehand pair, the default --window-size, and the
    # WebMCP flag. An explicit viewport always re-adds --window-size.
    def launch_flags(
      debug_port:, profile_dir:, headless: nil, devtools: nil, chromium_sandbox: nil,
      args: nil, ignore_default_args: nil, proxy: nil, locale: nil, viewport: nil,
      device_scale_factor: nil, has_touch: nil, ignore_https_errors: nil, ci: !ENV["CI"].nil?
    )
      drop_all = ignore_default_args == true
      ignored = ignore_default_args.is_a?(Array) ? ignore_default_args : []
      keep = ->(flag) { !drop_all && !ignored.include?(flag) }

      flags = (DEFAULT_CHROME_FLAGS + STAGEHAND_DEFAULT_FLAGS).select(&keep)
      size = viewport ? "--window-size=#{viewport[:width]},#{viewport[:height]}" : "--window-size=1280,800"
      flags << size if viewport || keep.call(size)
      flags << WEBMCP_CHROME_FLAG if keep.call(WEBMCP_CHROME_FLAG)
      flags << "--remote-debugging-port=#{debug_port}"
      flags << "--user-data-dir=#{profile_dir}"
      flags << "--headless" if headless == true
      flags << "--auto-open-devtools-for-tabs" if devtools == true
      flags << "--no-sandbox" if ci || chromium_sandbox == false
      unless proxy.nil?
        flags << "--proxy-server=#{proxy[:server]}"
        bypass = proxy[:bypass]
        flags << "--proxy-bypass-list=#{bypass}" if bypass && !bypass.to_s.empty?
      end
      flags << "--lang=#{locale}" unless locale.nil?
      unless device_scale_factor.nil?
        # Shortest-form number: 2 rather than 2.0 (matches the Go launcher).
        scale = (device_scale_factor % 1).zero? ? device_scale_factor.to_i : device_scale_factor
        flags << "--force-device-scale-factor=#{scale}"
      end
      flags << "--touch-events=enabled" if has_touch == true
      flags << "--ignore-certificate-errors" if ignore_https_errors == true
      flags.concat(args) unless args.nil?
      flags << "about:blank"
      flags
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

    # Normalizes a proxy option Hash; authenticated local proxies are
    # rejected before launch, like the sibling SDKs.
    def normalize_proxy(proxy)
      return nil if proxy.nil?
      raise ArgumentError, "proxy must be a Hash with a :server key" unless proxy.is_a?(Hash)
      proxy = proxy.transform_keys(&:to_sym)
      server = proxy[:server]
      if (server.nil? || server.to_s.empty?) && (proxy[:bypass] || proxy[:username] || proxy[:password])
        raise ArgumentError, "proxy server is required when configuring a local proxy"
      end
      raise ArgumentError, "proxy must be a Hash with a :server key" if server.nil? || server.to_s.empty?
      if proxy[:username] || proxy[:password]
        raise NotImplementedError, "Authenticated local browser proxies are not implemented yet"
      end
      proxy
    end

    def normalize_viewport(viewport)
      return nil if viewport.nil?
      raise ArgumentError, "viewport must be a Hash with :width and :height" unless viewport.is_a?(Hash)
      viewport = viewport.transform_keys(&:to_sym)
      Validation.positive_integer!(viewport[:width], "viewport width")
      Validation.positive_integer!(viewport[:height], "viewport height")
      viewport
    end

    # Downloads configure through CDP after connect (no Chrome flags), only
    # when either option is provided — mirroring the sibling SDKs.
    def download_behavior_hook(downloads_path, accept_downloads)
      return nil if downloads_path.nil? && accept_downloads.nil?
      lambda do |cdp_client|
        params = { "behavior" => accept_downloads == false ? "deny" : "allow" }
        params["downloadPath"] = downloads_path.to_s unless downloads_path.nil?
        cdp_client.send_command("Browser.setDownloadBehavior", params)
      end
    end

    def connect_browser(provider:, origin:, cdp_url:, deadline:, worker_init_metadata:, close_source:,
                        extension_dir: nil, extension_id: nil, preloaded_extension: false, session_id: nil,
                        after_connect: nil)
      cdp_client = CDPClient.connect(
        cdp_url: cdp_url,
        extension_dir: extension_dir&.to_s,
        extension_id: extension_id,
        preloaded_extension: preloaded_extension,
        deadline: deadline,
      )
      begin
        after_connect&.call(cdp_client)
      rescue Exception
        cdp_client.close
        raise
      end
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
