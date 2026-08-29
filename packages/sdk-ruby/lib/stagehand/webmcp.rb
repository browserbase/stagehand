# frozen_string_literal: true

require_relative "generated/models"
require_relative "rpc_client"

module Stagehand
  # A WebMCP tool advertised by the page, discovered via Page#tools. Port of
  # packages/sdk-python/src/stagehand/webmcp.py.
  class WebMCPTool
    attr_reader :name, :description, :input_schema, :annotations, :frame_id, :backend_node_id

    def initialize(rpc_client, page_id, descriptor)
      @rpc_client = rpc_client
      @page_id = page_id
      @name = descriptor.name
      @description = descriptor.description
      @input_schema = descriptor.input_schema
      @annotations = descriptor.annotations
      @frame_id = descriptor.frame_id
      @backend_node_id = descriptor.backend_node_id
    end

    # Starts the tool with the given input Hash and returns the running
    # WebMCPInvocation (await it with #result).
    def invoke(input: nil)
      descriptor = @rpc_client.send(
        "page.webmcp_invoke_tool",
        Models::PageWebMCPInvokeToolParams.new(
          page_id: @page_id,
          frame_id: @frame_id,
          tool_name: @name,
          input: input.nil? ? {} : input,
        ),
        "WebMCPInvocationDescriptor",
      )
      WebMCPInvocation.new(@rpc_client, @page_id, descriptor)
    end
  end

  # A running (or finished) WebMCP tool invocation.
  class WebMCPInvocation
    attr_reader :invocation_id, :tool_name, :frame_id, :input

    def initialize(rpc_client, page_id, descriptor)
      @rpc_client = rpc_client
      @page_id = page_id
      @invocation_id = descriptor.invocation_id
      @tool_name = descriptor.tool_name
      @frame_id = descriptor.frame_id
      @input = descriptor.input
      @terminal_result = nil
    end

    # Blocks until the invocation reaches a terminal state and returns the
    # Models::WebMCPToolResponse (status Completed/Canceled/Error). The
    # terminal result is memoized; later calls do not re-issue the RPC.
    def result(timeout: nil)
      return @terminal_result unless @terminal_result.nil?

      values = { page_id: @page_id, invocation_id: @invocation_id }
      values[:options] = Models::WebMCPResultOptions.new(timeout: timeout) unless timeout.nil?
      @terminal_result = @rpc_client.send(
        "page.webmcp_invocation_result",
        Models::PageWebMCPInvocationResultParams.new(**values),
        "WebMCPToolResponse",
      )
    end

    def cancel
      @rpc_client.send(
        "page.webmcp_cancel_invocation",
        Models::PageWebMCPCancelInvocationParams.new(page_id: @page_id, invocation_id: @invocation_id),
        "PageVoidResult",
      )
      nil
    end
  end
end
