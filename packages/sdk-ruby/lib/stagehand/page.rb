# frozen_string_literal: true

require "base64"

require_relative "generated/models"
require_relative "locator"
require_relative "rpc_client"

module Stagehand
  # Page surface: navigation, core input/waiting/reading interactions, and
  # the Locator factory. Port of the corresponding methods in
  # packages/sdk-python/src/stagehand/page.py; the remaining page.* methods
  # (drag_and_drop, snapshot, init scripts, headers, viewport, events, close,
  # webmcp) are follow-on work on this pattern.
  class Page
    attr_reader :page_id

    def initialize(rpc_client, page_ref)
      @rpc_client = rpc_client
      @page_id = page_ref.page_id
      @initial_url = page_ref.url
      @initial_title = page_ref.respond_to?(:title) ? page_ref.title : nil
    end

    def locator(selector)
      Locator.new(@rpc_client, page_id: @page_id, selector: selector)
    end

    # -- navigation -------------------------------------------------------

    def goto(url, wait_until: nil, timeout: nil)
      params = { page_id: @page_id, url: url }
      assign_navigation_options(params, wait_until: wait_until, timeout: timeout)
      @rpc_client.send("page.goto", Models::PageGotoParams.new(**params), "PageNavigationResult")
    end

    def reload(wait_until: nil, timeout: nil, ignore_cache: nil)
      params = { page_id: @page_id }
      options = { wait_until: wait_until, timeout: timeout, ignore_cache: ignore_cache }.compact
      params[:options] = Models::PageReloadOptions.new(**options) unless options.empty?
      @rpc_client.send("page.reload", Models::PageReloadParams.new(**params), "PageNavigationResult")
    end

    def go_back(wait_until: nil, timeout: nil)
      params = { page_id: @page_id }
      assign_navigation_options(params, wait_until: wait_until, timeout: timeout)
      @rpc_client.send("page.go_back", Models::PageGoBackParams.new(**params), "PageNavigationResult")
    end

    def go_forward(wait_until: nil, timeout: nil)
      params = { page_id: @page_id }
      assign_navigation_options(params, wait_until: wait_until, timeout: timeout)
      @rpc_client.send("page.go_forward", Models::PageGoForwardParams.new(**params), "PageNavigationResult")
    end

    def url
      @rpc_client.send("page.url", Models::PageIdParams.new(page_id: @page_id), "PageUrlResult")
    end

    def title
      @rpc_client.send("page.title", Models::PageIdParams.new(page_id: @page_id), "PageTitleResult")
    end

    # -- input ------------------------------------------------------------

    def click(x, y, button: nil, click_count: nil)
      params = { page_id: @page_id, x: x, y: y }
      options = { button: button, click_count: click_count }.compact
      params[:options] = Models::PageClickOptions.new(**options) unless options.empty?
      void("page.click", Models::PageClickParams.new(**params))
    end

    def hover(x, y)
      void("page.hover", Models::PageHoverParams.new(page_id: @page_id, x: x, y: y))
    end

    def scroll(x, y, delta_x, delta_y)
      void("page.scroll", Models::PageScrollParams.new(page_id: @page_id, x: x, y: y, delta_x: delta_x, delta_y: delta_y))
    end

    def type(text, delay: nil, with_mistakes: nil)
      params = { page_id: @page_id, text: text }
      options = { delay: delay, with_mistakes: with_mistakes }.compact
      params[:options] = Models::PageTypeOptions.new(**options) unless options.empty?
      void("page.type", Models::PageTypeParams.new(**params))
    end

    def key_press(key, delay: nil)
      params = { page_id: @page_id, key: key }
      params[:options] = Models::PageKeyPressOptions.new(delay: delay) unless delay.nil?
      void("page.key_press", Models::PageKeyPressParams.new(**params))
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
      params[:options] = Models::PageScreenshotOptions.new(**options) unless options.empty?
      result = @rpc_client.send("page.screenshot", Models::PageScreenshotParams.new(**params), "PageScreenshotResult")
      data = Base64.strict_decode64(result.data)
      File.binwrite(path, data) unless path.nil?
      data
    end

    # -- waiting ----------------------------------------------------------

    def wait_for_load_state(state, timeout: nil)
      params = { page_id: @page_id, state: state }
      params[:timeout] = timeout unless timeout.nil?
      void("page.wait_for_load_state", Models::PageWaitForLoadStateParams.new(**params))
    end

    def wait_for_timeout(ms)
      void("page.wait_for_timeout", Models::PageWaitForTimeoutParams.new(page_id: @page_id, ms: ms))
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

    def void(method, params)
      @rpc_client.send(method, params, "PageVoidResult")
      nil
    end
  end
end
