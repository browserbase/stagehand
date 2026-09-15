# frozen_string_literal: true

require_relative "generated/models"
require_relative "page"
require_relative "rpc_client"

module Stagehand
  # Walking-skeleton context surface: page enumeration and creation only.
  class BrowserContext
    def initialize(rpc_client)
      @rpc_client = rpc_client
    end

    def pages
      result = @rpc_client.send("context.pages", Models::EmptyParams.new, "ContextPagesResult")
      result.map { |page_ref| Page.new(@rpc_client, page_ref) }
    end

    def new_page(url = nil)
      params = url.nil? ? Models::ContextNewPageParams.new : Models::ContextNewPageParams.new(url: url)
      page_ref = @rpc_client.send("context.new_page", params, "PageRef")
      Page.new(@rpc_client, page_ref)
    end

    def active_page
      result = @rpc_client.send("context.active_page", Models::EmptyParams.new, "ContextActivePageResult")
      result.nil? ? nil : Page.new(@rpc_client, result)
    end

    def set_active_page(page)
      @rpc_client.send(
        "context.set_active_page",
        Models::ContextSetActivePageParams.new(page_id: page.page_id),
        "ContextVoidResult",
      )
      nil
    end
  end
end
