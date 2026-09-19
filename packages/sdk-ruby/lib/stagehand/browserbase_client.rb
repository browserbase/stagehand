# frozen_string_literal: true

require "json"
require "net/http"
require "securerandom"
require "uri"

require_relative "errors"
require_relative "sdk_identity"

module Stagehand
  # Minimal Browserbase REST client. There is no official Browserbase Ruby
  # SDK, so this hand-rolls the four endpoints Stagehand needs, mirroring
  # packages/sdk-go/browserbase_client.go. The Browserbase REST API itself is
  # camelCase, unlike the Stagehand wire protocol.
  class BrowserbaseClient
    SESSION_RELEASE_STATUS = "REQUEST_RELEASE"

    def initialize(api_key:, base_url:)
      @api_key = api_key
      @base_url = base_url.sub(%r{/+\z}, "")
    end

    # Returns the uploaded extension id.
    def upload_extension(archive, file_name: "stagehand-extension.zip")
      boundary = "stagehand#{SecureRandom.hex(16)}"
      body = +"--#{boundary}\r\n"
      body << "Content-Disposition: form-data; name=\"file\"; filename=\"#{file_name}\"\r\n"
      body << "Content-Type: application/zip\r\n\r\n"
      body << archive.b
      body << "\r\n--#{boundary}--\r\n"
      response = request(
        Net::HTTP::Post,
        "/v1/extensions",
        body: body,
        content_type: "multipart/form-data; boundary=#{boundary}",
      )
      extension_id = response["id"].to_s.strip
      raise BrowserbaseSessionError, "Browserbase extension upload returned an empty extension ID" if extension_id.empty?
      extension_id
    end

    def delete_extension(extension_id)
      request(Net::HTTP::Delete, "/v1/extensions/#{encode_path(extension_id)}", parse: false)
      nil
    end

    # Returns [session_id, connect_url].
    def create_session(payload)
      response = request(Net::HTTP::Post, "/v1/sessions", body: JSON.generate(payload), content_type: "application/json")
      [response["id"].to_s, response["connectUrl"].to_s]
    end

    # Returns [session_id, connect_url_or_nil, region_or_nil].
    def retrieve_session(session_id)
      response = request(Net::HTTP::Get, "/v1/sessions/#{encode_path(session_id)}")
      [response["id"].to_s, response["connectUrl"], response["region"]]
    end

    # Returns the session's raw CDP event log as a parsed JSON array
    # (available during and after the session's lifetime).
    def session_logs(session_id)
      request(Net::HTTP::Get, "/v1/sessions/#{encode_path(session_id)}/logs")
    end

    def release_session(session_id)
      request(
        Net::HTTP::Post,
        "/v1/sessions/#{encode_path(session_id)}",
        body: JSON.generate({ "status" => SESSION_RELEASE_STATUS }),
        content_type: "application/json",
      )
      nil
    end

    private

    def encode_path(value)
      URI.encode_uri_component(value)
    end

    def request(method_class, path, body: nil, content_type: nil, parse: true)
      uri = URI("#{@base_url}#{path}")
      http_request = method_class.new(uri)
      http_request["X-BB-API-Key"] = @api_key
      http_request["Accept"] = "application/json"
      http_request["User-Agent"] = "#{STAGEHAND_SDK_CLIENT_INFO["name"]}/#{STAGEHAND_SDK_CLIENT_INFO["version"]}"
      if body
        http_request["Content-Type"] = content_type
        http_request.body = body
      end

      response = Net::HTTP.start(
        uri.host,
        uri.port,
        use_ssl: uri.scheme == "https",
        open_timeout: 10,
        read_timeout: 60,
      ) { |http| http.request(http_request) }

      unless response.is_a?(Net::HTTPSuccess)
        raise BrowserbaseSessionError,
              "Browserbase request failed: #{method_class::METHOD} #{path} -> #{response.code} #{truncate(response.body)}"
      end
      return nil unless parse
      response.body.nil? || response.body.empty? ? {} : JSON.parse(response.body)
    rescue JSON::ParserError
      raise BrowserbaseSessionError, "Browserbase returned invalid JSON for #{path}"
    rescue SystemCallError, IOError, Net::OpenTimeout, Net::ReadTimeout, OpenSSL::SSL::SSLError => error
      raise BrowserbaseSessionError, "Browserbase request failed: #{method_class::METHOD} #{path}: #{error.message}"
    end

    def truncate(text)
      text.to_s[0, 300]
    end
  end
end
