# frozen_string_literal: true

require_relative "test_helper"

# LocalBrowser option -> Chrome flag mapping (launch_flags is pure; no Chrome
# is spawned). Semantics mirror packages/sdk-python/src/stagehand/browser.py.
class TestLocalBrowserFlags < Minitest::Test
  LocalBrowser = Stagehand::LocalBrowser

  def flags(**options)
    LocalBrowser.launch_flags(debug_port: 9222, profile_dir: "/tmp/profile", ci: false, **options)
  end

  def test_default_flag_set
    result = flags
    assert_includes result, "--window-size=1280,800"
    assert_includes result, LocalBrowser::WEBMCP_CHROME_FLAG
    assert_includes result, "--remote-debugging-port=9222"
    assert_includes result, "--user-data-dir=/tmp/profile"
    assert_equal "about:blank", result.last
    refute_includes result, "--headless"
    refute_includes result, "--no-sandbox"
    LocalBrowser::DEFAULT_CHROME_FLAGS.each { |flag| assert_includes result, flag }
  end

  def test_proxy_locale_viewport_scale_touch_and_https_flags
    result = flags(
      proxy: { server: "http://127.0.0.1:8080", bypass: "*.internal" },
      locale: "de-DE",
      viewport: { width: 800, height: 600 },
      device_scale_factor: 2.0,
      has_touch: true,
      ignore_https_errors: true,
    )
    assert_includes result, "--proxy-server=http://127.0.0.1:8080"
    assert_includes result, "--proxy-bypass-list=*.internal"
    assert_includes result, "--lang=de-DE"
    assert_includes result, "--window-size=800,600"
    assert_includes result, "--force-device-scale-factor=2"
    assert_includes result, "--touch-events=enabled"
    assert_includes result, "--ignore-certificate-errors"
    refute_includes result, "--window-size=1280,800"
  end

  def test_fractional_scale_keeps_its_fraction
    assert_includes flags(device_scale_factor: 1.5), "--force-device-scale-factor=1.5"
  end

  def test_ignore_default_args_true_drops_all_default_groups
    result = flags(ignore_default_args: true)
    LocalBrowser::DEFAULT_CHROME_FLAGS.each { |flag| refute_includes result, flag }
    LocalBrowser::STAGEHAND_DEFAULT_FLAGS.each { |flag| refute_includes result, flag }
    refute_includes result, LocalBrowser::WEBMCP_CHROME_FLAG
    refute_includes result, "--window-size=1280,800"
    # Non-default machinery survives.
    assert_includes result, "--remote-debugging-port=9222"
    assert_includes result, "--user-data-dir=/tmp/profile"
    assert_equal "about:blank", result.last
  end

  def test_ignore_default_args_list_is_exact_string_subtraction
    result = flags(ignore_default_args: ["--mute-audio", "--window-size=1280,800"])
    refute_includes result, "--mute-audio"
    refute_includes result, "--window-size=1280,800"
    assert_includes result, "--no-first-run"
  end

  def test_explicit_viewport_readds_window_size_even_when_ignored
    result = flags(ignore_default_args: true, viewport: { width: 1024, height: 768 })
    assert_includes result, "--window-size=1024,768"
    listed = flags(ignore_default_args: ["--window-size=1024,768"], viewport: { width: 1024, height: 768 })
    assert_includes listed, "--window-size=1024,768"
  end

  def test_sandbox_condition
    assert_includes flags(chromium_sandbox: false), "--no-sandbox"
    refute_includes flags(chromium_sandbox: true), "--no-sandbox"
    assert_includes LocalBrowser.launch_flags(debug_port: 1, profile_dir: "/p", ci: true), "--no-sandbox"
  end

  def test_user_args_come_after_options_and_before_starting_url
    result = flags(args: ["--custom-flag"])
    assert_equal "about:blank", result.last
    assert_equal "--custom-flag", result[-2]
  end

  def test_proxy_validation
    error = assert_raises(NotImplementedError) do
      LocalBrowser.normalize_proxy({ server: "http://p:1", username: "u", password: "s" })
    end
    assert_equal "Authenticated local browser proxies are not implemented yet", error.message
    assert_raises(ArgumentError) { LocalBrowser.normalize_proxy({ bypass: "*.x" }) }
    assert_raises(ArgumentError) { LocalBrowser.normalize_proxy("http://p:1") }
    assert_equal({ server: "http://p:1" }, LocalBrowser.normalize_proxy({ "server" => "http://p:1" }))
  end

  def test_viewport_validation
    assert_raises(ArgumentError) { LocalBrowser.normalize_viewport({ width: 100 }) }
    assert_raises(ArgumentError) { LocalBrowser.normalize_viewport({ width: -1, height: 5 }) }
    assert_equal({ width: 1, height: 2 }, LocalBrowser.normalize_viewport({ "width" => 1, "height" => 2 }))
  end

  def test_download_behavior_hook
    assert_nil LocalBrowser.download_behavior_hook(nil, nil)

    sent = []
    cdp = Object.new
    cdp.define_singleton_method(:send_command) { |method, params| sent << [method, params] }

    LocalBrowser.download_behavior_hook("/tmp/dl", nil).call(cdp)
    assert_equal ["Browser.setDownloadBehavior", { "behavior" => "allow", "downloadPath" => "/tmp/dl" }], sent.last

    LocalBrowser.download_behavior_hook(nil, false).call(cdp)
    assert_equal ["Browser.setDownloadBehavior", { "behavior" => "deny" }], sent.last
  end
end
