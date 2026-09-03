# frozen_string_literal: true

require_relative "test_helper"

class FakeBrowserbaseClient
  attr_reader :calls, :created_payload

  def initialize(create_result: %w[session-1 wss://connect.example/session-1], fail_create: false)
    @calls = []
    @create_result = create_result
    @fail_create = fail_create
  end

  def upload_extension(archive)
    @calls << [:upload_extension, archive.bytesize]
    "ext-uploaded"
  end

  def delete_extension(extension_id)
    @calls << [:delete_extension, extension_id]
    nil
  end

  def create_session(payload)
    @calls << [:create_session]
    @created_payload = payload
    raise Stagehand::BrowserbaseSessionError, "boom" if @fail_create
    @create_result
  end

  def release_session(session_id)
    @calls << [:release_session, session_id]
    nil
  end
end

class TestBrowserbaseSession < Minitest::Test
  def setup
    directory = Stagehand::ExtensionAssets.extension_directory
    skip "extension not built (pnpm --filter ./packages/extension build)" unless File.file?(File.join(directory, "manifest.json"))
  end

  def create_session(client, **overrides)
    defaults = {
      api_key: "bb-key", base_url: "https://api.browserbase.com", extension_id: nil,
      keep_alive: nil, proxies: nil, region: nil, timeout: nil, user_metadata: nil,
      browser_settings: nil, client: client
    }
    Stagehand::BrowserbaseSession.create(**defaults.merge(overrides))
  end

  def test_create_uploads_extension_and_stamps_sdk_metadata
    client = FakeBrowserbaseClient.new
    session = create_session(client, user_metadata: { "team" => "qa" }, region: "us-west-2", keep_alive: true)

    assert_equal "session-1", session.session_id
    assert_equal "wss://connect.example/session-1", session.cdp_url
    assert_equal :upload_extension, client.calls.first.first

    payload = client.created_payload
    assert_equal "ext-uploaded", payload["extensionId"]
    assert_equal true, payload["keepAlive"]
    assert_equal "us-west-2", payload["region"]
    assert_equal "qa", payload.dig("userMetadata", "team")
    assert_equal "ruby", payload.dig("userMetadata", "stagehand_sdk_language")
    assert_equal "true", payload.dig("userMetadata", "stagehand")
  end

  def test_create_with_caller_extension_skips_upload
    client = FakeBrowserbaseClient.new
    create_session(client, extension_id: "ext-caller")
    refute client.calls.map(&:first).include?(:upload_extension)
    assert_equal "ext-caller", client.created_payload["extensionId"]
  end

  def test_failed_create_deletes_uploaded_extension
    client = FakeBrowserbaseClient.new(fail_create: true)
    assert_raises(Stagehand::BrowserbaseSessionError) { create_session(client) }
    assert_includes client.calls, [:delete_extension, "ext-uploaded"]
  end

  def test_close_releases_session_then_deletes_extension_once
    client = FakeBrowserbaseClient.new
    session = create_session(client)
    session.close
    session.close
    assert_equal 1, client.calls.count { |call| call == [:release_session, "session-1"] }
    assert_equal 1, client.calls.count { |call| call == [:delete_extension, "ext-uploaded"] }
  end

  def test_empty_connect_url_cleans_up
    client = FakeBrowserbaseClient.new(create_result: ["session-1", "  "])
    assert_raises(Stagehand::BrowserbaseSessionError) { create_session(client) }
    assert_includes client.calls, [:release_session, "session-1"]
    assert_includes client.calls, [:delete_extension, "ext-uploaded"]
  end
end
