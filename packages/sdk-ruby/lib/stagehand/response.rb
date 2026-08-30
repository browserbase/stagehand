# frozen_string_literal: true

require "base64"
require "json"

require_relative "generated/models"
require_relative "rpc_client"

module Stagehand
  # A navigation response handle returned by Page#goto/#reload/#go_back/
  # #go_forward. Port of packages/sdk-python/src/stagehand/response.py:
  # descriptor fields are local reads; everything else is an RPC round trip.
  class Response
    def initialize(rpc_client, descriptor)
      @rpc_client = rpc_client
      @descriptor = descriptor
    end

    def url
      @descriptor.url
    end

    def status
      @descriptor.status
    end

    def status_text
      @descriptor.status_text
    end

    def ok?
      status.between?(200, 299)
    end
    alias ok ok?

    # The headers captured at navigation time; #all_headers fetches the
    # complete, current set from the browser.
    def headers
      (@descriptor.headers || {}).dup
    end

    def from_service_worker?
      @descriptor.from_service_worker
    end
    alias from_service_worker from_service_worker?

    def all_headers
      result = @rpc_client.send("response.all_headers", Models::ResponseIdParams.new(response_id: @descriptor.response_id), "ResponseAllHeadersResult")
      (result.headers || {}).dup
    end

    # First matching header joined with ", " (HTTP list semantics), or nil.
    def header_value(name)
      values = header_values(name)
      values.empty? ? nil : values.join(", ")
    end

    def header_values(name)
      normalized = name.downcase
      headers_array.select { |header| header["name"].downcase == normalized }.map { |header| header["value"] }
    end

    # All headers as [{ "name" => ..., "value" => ... }], duplicates preserved.
    def headers_array
      result = @rpc_client.send("response.headers_array", Models::ResponseIdParams.new(response_id: @descriptor.response_id), "ResponseHeadersArrayResult")
      result.headers.map { |header| { "name" => header.name, "value" => header.value } }
    end

    # Models::NavigationSecurityDetails or nil for non-TLS responses.
    def security_details
      @rpc_client.send("response.security_details", Models::ResponseIdParams.new(response_id: @descriptor.response_id), "ResponseSecurityDetailsResult").value
    end

    # Models::NavigationServerAddr or nil when unavailable.
    def server_addr
      @rpc_client.send("response.server_addr", Models::ResponseIdParams.new(response_id: @descriptor.response_id), "ResponseServerAddrResult").value
    end

    # The response body as a binary String.
    def body
      result = @rpc_client.send("response.body", Models::ResponseIdParams.new(response_id: @descriptor.response_id), "ResponseBodyResult")
      decoded =
        begin
          Base64.strict_decode64(result.body)
        rescue ArgumentError
          raise StagehandError, "response.body returned invalid base64"
        end
      raise StagehandError, "response.body returned invalid base64" unless Base64.strict_encode64(decoded) == result.body
      decoded
    end

    def text
      value = body.force_encoding(Encoding::UTF_8)
      raise StagehandError, "response body is not valid UTF-8" unless value.valid_encoding?
      value
    end

    def json
      JSON.parse(text)
    end

    # Waits for the response to finish; returns nil on success or an
    # (unraised) StagehandError describing the network failure.
    def finished
      result = @rpc_client.send("response.finished", Models::ResponseIdParams.new(response_id: @descriptor.response_id), "ResponseFinishedResult")
      result.error.nil? ? nil : StagehandError.new(result.error.message)
    end

  end
end
