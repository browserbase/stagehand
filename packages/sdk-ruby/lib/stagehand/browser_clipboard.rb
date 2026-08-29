# frozen_string_literal: true

require_relative "generated/models"
require_relative "rpc_client"

module Stagehand
  # Clipboard surface reached via BrowserContext#clipboard. Port of
  # packages/sdk-python/src/stagehand/browser_clipboard.py. Every method
  # optionally targets a specific page; the active page is used otherwise.
  class BrowserClipboard
    def initialize(rpc_client)
      @rpc_client = rpc_client
    end

    def read_text(page: nil)
      @rpc_client.send("context.clipboard_read_text", target(page), "ContextClipboardReadTextResult")
    end

    def write_text(text, page: nil)
      values = { text: text }
      values[:page_id] = page.page_id unless page.nil?
      void("context.clipboard_write_text", Models::ContextClipboardWriteTextParams.new(**values))
    end

    def clear(page: nil)
      void("context.clipboard_clear", target(page))
    end

    # shortcut: "ControlOrMeta+V" (default), "Meta+V", or "Control+V".
    def paste(page: nil, shortcut: nil)
      values = {}
      values[:page_id] = page.page_id unless page.nil?
      values[:shortcut] = shortcut unless shortcut.nil?
      void("context.clipboard_paste", Models::ContextClipboardPasteParams.new(**values))
    end

    def copy(page: nil)
      void("context.clipboard_copy", target(page))
    end

    def cut(page: nil)
      void("context.clipboard_cut", target(page))
    end

    private

    def target(page)
      page.nil? ? Models::ContextClipboardTarget.new : Models::ContextClipboardTarget.new(page_id: page.page_id)
    end

    def void(method, params)
      @rpc_client.send(method, params, "ContextVoidResult")
      nil
    end
  end
end
