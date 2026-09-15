# frozen_string_literal: true

require_relative "errors"
require_relative "browserbase_client"
require_relative "extension_assets"
require_relative "sdk_identity"

module Stagehand
  # Creates and releases Browserbase sessions with the Stagehand extension
  # attached. Mirrors packages/sdk-python/src/stagehand/browserbase_session.py:
  # when the caller supplies no extension id, the embedded extension is zipped,
  # uploaded, and cleaned up alongside the session.
  module BrowserbaseSession
    DEFAULT_BROWSERBASE_URL = "https://api.browserbase.com"

    SessionConnection = Data.define(:session_id, :cdp_url, :region)

    class OwnedSession
      attr_reader :session_id, :cdp_url

      def initialize(session_id:, cdp_url:, client:, owned_extension_id:)
        @session_id = session_id
        @cdp_url = cdp_url
        @client = client
        @owned_extension_id = owned_extension_id
        @session_released = false
        @extension_deleted = false
        @close_mutex = Mutex.new
      end

      def close
        @close_mutex.synchronize do
          release_error = nil
          unless @session_released
            begin
              @client.release_session(@session_id)
              @session_released = true
            rescue StandardError => error
              release_error = error
            end
          end

          extension_error = nil
          if @owned_extension_id && !@extension_deleted
            begin
              @client.delete_extension(@owned_extension_id)
              @extension_deleted = true
            rescue StandardError => error
              extension_error = error
            end
          end

          raise release_error if release_error
          raise extension_error if extension_error
        end
        nil
      end
    end

    module_function

    def create(api_key:, base_url:, extension_id:, keep_alive:, proxies:, region:, timeout:, user_metadata:, browser_settings:, client: nil)
      client ||= BrowserbaseClient.new(api_key: api_key, base_url: base_url)

      owned_extension_id = nil
      if extension_id.nil?
        archive = ExtensionAssets.build_extension_archive
        begin
          owned_extension_id = client.upload_extension(archive)
        rescue StandardError => error
          raise BrowserbaseSessionError, "Failed to upload the Stagehand extension to Browserbase: #{error.message}"
        end
      end

      # The Browserbase REST API uses camelCase keys. browser_settings is
      # passed through verbatim and must already be camelCase (spike shortcut;
      # the sibling SDKs map their snake_case models field by field).
      payload = {}
      payload["browserSettings"] = browser_settings unless browser_settings.nil?
      payload["extensionId"] = owned_extension_id || extension_id
      payload["keepAlive"] = keep_alive unless keep_alive.nil?
      payload["proxies"] = proxies unless proxies.nil?
      payload["region"] = region unless region.nil?
      payload["timeout"] = timeout unless timeout.nil?
      payload["userMetadata"] = (user_metadata || {}).merge(STAGEHAND_SESSION_METADATA)

      begin
        session_id, cdp_url = client.create_session(payload)
      rescue StandardError => error
        delete_extension_best_effort(client, owned_extension_id)
        raise BrowserbaseSessionError, "Failed to create a Browserbase session: #{error.message}"
      end

      session_id = session_id.strip
      cdp_url = cdp_url.strip
      if session_id.empty? || cdp_url.empty?
        cleanup_invalid_session(client, session_id, owned_extension_id)
        raise BrowserbaseSessionError, "Browserbase session creation returned an empty session ID" if session_id.empty?
        raise BrowserbaseSessionError, "Browserbase session creation returned an empty connection URL"
      end

      OwnedSession.new(session_id: session_id, cdp_url: cdp_url, client: client, owned_extension_id: owned_extension_id)
    end

    def connect(api_key:, base_url:, session_id:)
      normalized = session_id.to_s.strip
      raise BrowserbaseSessionError, "A Browserbase session ID is required" if normalized.empty?

      client = BrowserbaseClient.new(api_key: api_key, base_url: base_url)
      begin
        retrieved_id, connect_url, region = client.retrieve_session(normalized)
      rescue StandardError => error
        raise BrowserbaseSessionError, "Failed to retrieve the Browserbase session: #{error.message}"
      end
      cdp_url = connect_url.to_s.strip
      raise BrowserbaseSessionError, "Browserbase session is not available for connection" if cdp_url.empty?

      SessionConnection.new(
        session_id: retrieved_id.strip.empty? ? normalized : retrieved_id.strip,
        cdp_url: cdp_url,
        region: region,
      )
    end

    def delete_extension_best_effort(client, extension_id)
      return if extension_id.nil?
      begin
        client.delete_extension(extension_id)
      rescue StandardError
        nil
      end
    end

    def cleanup_invalid_session(client, session_id, extension_id)
      unless session_id.empty?
        begin
          client.release_session(session_id)
        rescue StandardError
          nil
        end
      end
      delete_extension_best_effort(client, extension_id)
    end
  end
end
