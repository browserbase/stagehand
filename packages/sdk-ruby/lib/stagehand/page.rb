# frozen_string_literal: true

require_relative "generated/models"
require_relative "rpc_client"

module Stagehand
  # Walking-skeleton page surface: navigation and identity only. The other
  # ~26 page.* methods are mechanical additions on this pattern.
  class Page
    attr_reader :page_id

    def initialize(rpc_client, page_ref)
      @rpc_client = rpc_client
      @page_id = page_ref.page_id
      @initial_url = page_ref.url
      @initial_title = page_ref.respond_to?(:title) ? page_ref.title : nil
    end

    def goto(url, wait_until: nil, timeout: nil)
      params = { page_id: @page_id, url: url }
      options = {}
      options[:wait_until] = wait_until unless wait_until.nil?
      options[:timeout] = timeout unless timeout.nil?
      params[:options] = Models::PageNavigationOptions.new(**options) unless options.empty?
      @rpc_client.send("page.goto", Models::PageGotoParams.new(**params), "PageNavigationResult")
    end

    def url
      @rpc_client.send("page.url", Models::PageIdParams.new(page_id: @page_id), "PageUrlResult")
    end

    def title
      @rpc_client.send("page.title", Models::PageIdParams.new(page_id: @page_id), "PageTitleResult")
    end
  end
end
