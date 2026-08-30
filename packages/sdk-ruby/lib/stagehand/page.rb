# frozen_string_literal: true

require "base64"
require "pathname"
require "securerandom"

require_relative "generated/models"
require_relative "locator"
require_relative "response"
require_relative "rpc_client"
require_relative "validation"
require_relative "webmcp"

module Stagehand
  # Handle for one page.on subscription; #unsubscribe stops delivery on both
  # sides and is safe to call more than once.
  class CDPSubscription
    attr_reader :subscription_id

    def initialize(rpc_client, subscription_id, remove_local_listener, on_disposed)
      @rpc_client = rpc_client
      @subscription_id = subscription_id
      @remove_local_listener = remove_local_listener
      @on_disposed = on_disposed
      @mutex = Mutex.new
      @unsubscribed = false
    end

    def unsubscribe
      @mutex.synchronize do
        return if @unsubscribed
        @rpc_client.send("page.off", Models::PageOffParams.new(subscription_id: @subscription_id), "PageVoidResult")
        @remove_local_listener.call
        @on_disposed.call
        @unsubscribed = true
      end
      nil
    end
  end

  # Page surface: navigation, input, reading, waiting, events, and the
  # Locator/WebMCP factories. Port of the corresponding methods in
  # packages/sdk-python/src/stagehand/page.py.
  class Page
    attr_reader :page_id

    def initialize(rpc_client, page_ref)
      @rpc_client = rpc_client
      @page_id = page_ref.page_id
      @initial_url = page_ref.url
      @initial_title = page_ref.respond_to?(:title) ? page_ref.title : nil
      @subscriptions_mutex = Mutex.new
      @event_subscriptions = []
    end

    def locator(selector)
      Locator.new(@rpc_client, page_id: @page_id, selector: selector)
    end

    # -- navigation -------------------------------------------------------

    # Navigation methods return a Stagehand::Response for the main document
    # (or nil when the navigation produced none, e.g. same-document).

    def goto(url, wait_until: nil, timeout: nil)
      params = { page_id: @page_id, url: url }
      assign_navigation_options(params, wait_until: wait_until, timeout: timeout)
      result = @rpc_client.send("page.goto", Models::PageGotoParams.new(**params), "PageNavigationResult")
      @page_id = result.page.page_id
      result.response.nil? ? nil : Response.new(@rpc_client, result.response)
    end

    def reload(wait_until: nil, timeout: nil, ignore_cache: nil)
      params = { page_id: @page_id }
      options = { wait_until: wait_until, timeout: timeout, ignore_cache: ignore_cache }.compact
      params[:options] = Models::PageReloadOptions.new(**options) unless options.empty?
      result = @rpc_client.send("page.reload", Models::PageReloadParams.new(**params), "PageNavigationResult")
      @page_id = result.page.page_id
      result.response.nil? ? nil : Response.new(@rpc_client, result.response)
    end

    def go_back(wait_until: nil, timeout: nil)
      params = { page_id: @page_id }
      assign_navigation_options(params, wait_until: wait_until, timeout: timeout)
      result = @rpc_client.send("page.go_back", Models::PageGoBackParams.new(**params), "PageNavigationResult")
      @page_id = result.page.page_id
      result.response.nil? ? nil : Response.new(@rpc_client, result.response)
    end

    def go_forward(wait_until: nil, timeout: nil)
      params = { page_id: @page_id }
      assign_navigation_options(params, wait_until: wait_until, timeout: timeout)
      result = @rpc_client.send("page.go_forward", Models::PageGoForwardParams.new(**params), "PageNavigationResult")
      @page_id = result.page.page_id
      result.response.nil? ? nil : Response.new(@rpc_client, result.response)
    end

    def url
      @rpc_client.send("page.url", Models::PageIdParams.new(page_id: @page_id), "PageUrlResult")
    end

    def title
      @rpc_client.send("page.title", Models::PageIdParams.new(page_id: @page_id), "PageTitleResult")
    end

    # Unsubscribes any page.on listeners, then closes the page.
    def close
      subscriptions = @subscriptions_mutex.synchronize { @event_subscriptions.dup }
      subscriptions.each do |subscription|
        subscription.unsubscribe
      rescue StandardError
        nil
      end
      @rpc_client.send("page.close", Models::PageIdParams.new(page_id: @page_id), "PageCloseResult")
      nil
    end

    # -- input ------------------------------------------------------------

    def click(x, y, button: nil, click_count: nil)
      params = { page_id: @page_id, x: x, y: y }
      options = { button: button, click_count: click_count }.compact
      params[:options] = Models::PageClickOptions.new(**options) unless options.empty?
      @rpc_client.send("page.click", Models::PageClickParams.new(**params), "PageVoidResult")
      nil
    end

    def hover(x, y)
      @rpc_client.send("page.hover", Models::PageHoverParams.new(page_id: @page_id, x: x, y: y), "PageVoidResult")
      nil
    end

    def scroll(x, y, delta_x, delta_y)
      @rpc_client.send("page.scroll", Models::PageScrollParams.new(page_id: @page_id, x: x, y: y, delta_x: delta_x, delta_y: delta_y), "PageVoidResult")
      nil
    end

    # route: optional intermediate points, each {x:, y:} Hash or
    # Models::PageDragAndDropRoutePoint.
    def drag_and_drop(from_x, from_y, to_x, to_y, button: nil, steps: nil, delay: nil, route: nil)
      params = { page_id: @page_id, from_x: from_x, from_y: from_y, to_x: to_x, to_y: to_y }
      options = { button: button, steps: steps, delay: delay }.compact
      unless route.nil?
        options[:route] = route.map do |point|
          point.is_a?(Models::PageDragAndDropRoutePoint) ? point : Models::PageDragAndDropRoutePoint.new(**point.transform_keys(&:to_sym))
        end
      end
      params[:options] = Models::PageDragAndDropOptions.new(**options) unless options.empty?
      @rpc_client.send("page.drag_and_drop", Models::PageDragAndDropParams.new(**params), "PageVoidResult")
      nil
    end

    def type(text, delay: nil, with_mistakes: nil)
      params = { page_id: @page_id, text: text }
      options = { delay: delay, with_mistakes: with_mistakes }.compact
      params[:options] = Models::PageTypeOptions.new(**options) unless options.empty?
      @rpc_client.send("page.type", Models::PageTypeParams.new(**params), "PageVoidResult")
      nil
    end

    def key_press(key, delay: nil)
      params = { page_id: @page_id, key: key }
      params[:options] = Models::PageKeyPressOptions.new(delay: delay) unless delay.nil?
      @rpc_client.send("page.key_press", Models::PageKeyPressParams.new(**params), "PageVoidResult")
      nil
    end

    # -- configuration ----------------------------------------------------

    # source is JavaScript text, or a Pathname whose contents are read and
    # tagged with a sourceURL comment (matching the sibling SDKs).
    def add_init_script(source)
      script =
        if source.is_a?(Pathname)
          "#{source.read}\n//# sourceURL=#{source.to_s.delete("\n")}"
        else
          source
        end
      @rpc_client.send("page.add_init_script", Models::PageAddInitScriptParams.new(page_id: @page_id, source: script), "PageVoidResult")
      nil
    end

    def set_extra_http_headers(headers)
      @rpc_client.send("page.set_extra_http_headers", Models::PageSetExtraHTTPHeadersParams.new(page_id: @page_id, headers: headers.to_h), "PageVoidResult")
      nil
    end

    def set_viewport_size(width, height, device_scale_factor: nil)
      params = { page_id: @page_id, width: width, height: height }
      unless device_scale_factor.nil?
        params[:options] = Models::PageSetViewportSizeOptions.new(device_scale_factor: device_scale_factor)
      end
      @rpc_client.send("page.set_viewport_size", Models::PageSetViewportSizeParams.new(**params), "PageVoidResult")
      nil
    end

    # -- events -----------------------------------------------------------

    # Subscribes to a page event ("console", ...); the block receives each
    # Models::PageCDPEvent. Returns a CDPSubscription. Each delivery runs on
    # its own SDK thread — the block may issue RPC calls, and deliveries for
    # a busy page can run concurrently, so synchronize any shared state.
    def on(event, &listener)
      raise ArgumentError, "a listener block is required" if listener.nil?

      subscription_id = SecureRandom.hex(16)
      remove_notification_listener = @rpc_client.on_notification("page.cdp_event") do |notification|
        listener.call(notification.event) if notification.subscription_id == subscription_id
      end

      subscription = CDPSubscription.new(
        @rpc_client,
        subscription_id,
        remove_notification_listener,
        -> { @subscriptions_mutex.synchronize { @event_subscriptions.delete(subscription) } },
      )
      @subscriptions_mutex.synchronize { @event_subscriptions << subscription }
      begin
        @rpc_client.send(
          "page.on",
          Models::PageOnParams.new(page_id: @page_id, subscription_id: subscription_id, event: event),
          "PageVoidResult",
        )
      rescue Exception
        remove_notification_listener.call
        @subscriptions_mutex.synchronize { @event_subscriptions.delete(subscription) }
        raise
      end
      subscription
    end

    # -- reading ----------------------------------------------------------

    # Returns the evaluated expression's JSON value.
    def evaluate(expression)
      result = @rpc_client.send(
        "page.evaluate",
        Models::PageEvaluateParams.new(page_id: @page_id, expression: expression),
        "PageEvaluateResult",
      )
      result.value
    end

    # Returns the image bytes (binary String); also written to path if given.
    def screenshot(path: nil, animations: nil, caret: nil, clip: nil, full_page: nil, mask: nil,
                   mask_color: nil, omit_background: nil, quality: nil, scale: nil, style: nil,
                   timeout: nil, type: nil)
      params = { page_id: @page_id }
      options = {
        animations: animations,
        caret: caret,
        clip: clip.is_a?(Hash) ? Models::PageScreenshotClip.new(**clip) : clip,
        full_page: full_page,
        mask: mask&.map { |locator| Models::LocatorDescriptor.new(page_id: locator.page_id, selector: locator.selector, **(locator.nth_index.nil? ? {} : { nth: locator.nth_index })) },
        mask_color: mask_color,
        omit_background: omit_background,
        quality: quality,
        scale: scale,
        style: style,
        timeout: timeout,
        type: type,
      }.compact
      Validation.screenshot_options!(options)
      params[:options] = Models::PageScreenshotOptions.new(**options) unless options.empty?
      result = @rpc_client.send("page.screenshot", Models::PageScreenshotParams.new(**params), "PageScreenshotResult")
      data = Base64.strict_decode64(result.data)
      File.binwrite(path, data) unless path.nil?
      data
    end

    # Accessibility snapshot: Models::SnapshotResult with formatted_tree,
    # xpath_map, and url_map.
    def snapshot(include_iframes: nil)
      params = { page_id: @page_id }
      params[:options] = Models::PageSnapshotOptions.new(include_iframes: include_iframes) unless include_iframes.nil?
      @rpc_client.send("page.snapshot", Models::PageSnapshotParams.new(**params), "SnapshotResult")
    end

    # WebMCP tools advertised by the page, as an array of WebMCPTool.
    def tools(timeout: nil)
      params = { page_id: @page_id }
      params[:options] = Models::WebMCPToolsOptions.new(timeout: timeout) unless timeout.nil?
      result = @rpc_client.send("page.webmcp_tools", Models::PageWebMCPToolsParams.new(**params), "PageWebMCPToolsResult")
      result.tools.map { |descriptor| WebMCPTool.new(@rpc_client, @page_id, descriptor) }
    end

    # -- waiting ----------------------------------------------------------

    def wait_for_load_state(state, timeout: nil)
      params = { page_id: @page_id, state: state }
      params[:timeout] = timeout unless timeout.nil?
      @rpc_client.send("page.wait_for_load_state", Models::PageWaitForLoadStateParams.new(**params), "PageVoidResult")
      nil
    end

    def wait_for_timeout(ms)
      @rpc_client.send("page.wait_for_timeout", Models::PageWaitForTimeoutParams.new(page_id: @page_id, ms: ms), "PageVoidResult")
      nil
    end

    # Returns true when the selector reached the requested state.
    def wait_for_selector(selector, state: nil, timeout: nil, pierce_shadow: nil)
      params = { page_id: @page_id, selector: selector }
      options = { state: state, timeout: timeout, pierce_shadow: pierce_shadow }.compact
      params[:options] = Models::PageWaitForSelectorOptions.new(**options) unless options.empty?
      result = @rpc_client.send("page.wait_for_selector", Models::PageWaitForSelectorParams.new(**params), "PageWaitForSelectorResult")
      result.matched
    end

    private

    def assign_navigation_options(params, wait_until:, timeout:)
      options = { wait_until: wait_until, timeout: timeout }.compact
      params[:options] = Models::PageNavigationOptions.new(**options) unless options.empty?
      params
    end


  end
end
