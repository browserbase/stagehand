# frozen_string_literal: true

require_relative "file_upload"
require_relative "generated/models"
require_relative "rpc_client"

module Stagehand
  # An element locator bound to a page, created via Page#locator. Port of the
  # core-interactions subset of packages/sdk-python/src/stagehand/locator.py;
  # the remaining methods (hover, scroll_to, centroid, highlight,
  # send_click_event, select_option, inner_html) follow the same pattern.
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
