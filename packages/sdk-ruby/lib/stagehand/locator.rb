# frozen_string_literal: true

require_relative "file_upload"
require_relative "generated/models"
require_relative "rpc_client"

module Stagehand
  # An element locator bound to a page, created via Page#locator. Port of
  # packages/sdk-python/src/stagehand/locator.py.
  class Locator
    attr_reader :page_id, :selector, :nth_index

    def initialize(rpc_client, page_id:, selector:, nth: nil)
      @rpc_client = rpc_client
      @page_id = page_id
      @selector = selector
      @nth_index = nth
    end

    def first
      nth(0)
    end

    def nth(index)
      self.class.new(@rpc_client, page_id: @page_id, selector: @selector, nth: index)
    end

    def click(button: nil, click_count: nil)
      values = descriptor_values
      options = { button: button, click_count: click_count }.compact
      values[:options] = Models::LocatorClickOptions.new(**options) unless options.empty?
      @rpc_client.send("locator.click", Models::LocatorClickParams.new(**values), "LocatorClickResult")
      nil
    end

    def fill(value)
      @rpc_client.send("locator.fill", Models::LocatorFillParams.new(**descriptor_values, value: value), "LocatorFillResult")
      nil
    end

    def hover
      @rpc_client.send("locator.hover", descriptor, "LocatorHoverResult")
      nil
    end

    # percent: 0-100 Numeric or a "50%" style String.
    def scroll_to(percent)
      @rpc_client.send("locator.scroll_to", Models::LocatorScrollToParams.new(**descriptor_values, percent: percent), "LocatorScrollToResult")
      nil
    end

    # The element's viewport centroid as Models::LocatorCentroidResult (x/y).
    def centroid
      @rpc_client.send("locator.centroid", descriptor, "LocatorCentroidResult")
    end

    # Colors are {r:, g:, b:, a:} Hashes or Models::RgbaColor.
    def highlight(duration_ms: nil, border_color: nil, content_color: nil)
      values = descriptor_values
      options = {
        duration_ms: duration_ms,
        border_color: rgba(border_color),
        content_color: rgba(content_color),
      }.compact
      values[:options] = Models::LocatorHighlightOptions.new(**options) unless options.empty?
      @rpc_client.send("locator.highlight", Models::LocatorHighlightParams.new(**values), "LocatorHighlightResult")
      nil
    end

    # Dispatches a synthetic MouseEvent("click") instead of trusted input.
    def send_click_event(bubbles: nil, cancelable: nil, composed: nil, detail: nil)
      values = descriptor_values
      options = { bubbles: bubbles, cancelable: cancelable, composed: composed, detail: detail }.compact
      values[:options] = Models::LocatorSendClickEventOptions.new(**options) unless options.empty?
      @rpc_client.send("locator.send_click_event", Models::LocatorSendClickEventParams.new(**values), "LocatorSendClickEventResult")
      nil
    end

    # values: a String or array of Strings; returns the selected values.
    def select_option(values)
      @rpc_client.send(
        "locator.select_option",
        Models::LocatorSelectOptionParams.new(**descriptor_values, values: values.is_a?(String) ? values : values.to_a),
        "LocatorSelectOptionResult",
      )
    end

    def type(text, delay: nil)
      values = descriptor_values
      values[:text] = text
      values[:options] = Models::LocatorTypeOptions.new(delay: delay) unless delay.nil?
      @rpc_client.send("locator.type", Models::LocatorTypeParams.new(**values), "LocatorTypeResult")
      nil
    end

    def count
      @rpc_client.send("locator.count", descriptor, nil)
    end

    def text_content
      @rpc_client.send("locator.text_content", descriptor, nil)
    end

    def inner_text
      @rpc_client.send("locator.inner_text", descriptor, nil)
    end

    def inner_html
      @rpc_client.send("locator.inner_html", descriptor, nil)
    end

    def input_value
      @rpc_client.send("locator.input_value", descriptor, nil)
    end

    def visible?
      @rpc_client.send("locator.is_visible", descriptor, nil)
    end
    alias is_visible visible?

    def checked?
      @rpc_client.send("locator.is_checked", descriptor, nil)
    end
    alias is_checked checked?

    def set_input_files(files)
      values = descriptor_values
      values[:files] = FileUpload.normalize_file_input(files)
      @rpc_client.send("locator.set_input_files", Models::LocatorSetInputFilesParams.new(**values), "LocatorSetInputFilesResult")
      nil
    end

    private

    def rgba(color)
      case color
      when nil, Models::RgbaColor then color
      when Hash then Models::RgbaColor.new(**color.transform_keys(&:to_sym))
      else raise ArgumentError, "colors must be a Models::RgbaColor or a Hash with r/g/b (and optional a)"
      end
    end

    def descriptor
      Models::LocatorDescriptor.new(**descriptor_values)
    end

    def descriptor_values
      values = { page_id: @page_id, selector: @selector }
      values[:nth] = @nth_index unless @nth_index.nil?
      values
    end
  end
end
