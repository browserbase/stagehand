# frozen_string_literal: true

# Shared plumbing for the walking-skeleton examples, mirroring the canonical
# example set in packages/sdk-{ts,python,go}/examples. The production example
# set will be self-contained per file (example-parity, priced in ESTIMATE.md);
# this helper keeps the spike examples runnable with whichever keys exist:
#
#   ruby examples/act.rb                # local Chrome, needs a provider key
#   ruby examples/act.rb --browserbase  # Browserbase, works with only BROWSERBASE_API_KEY
#   HEADED=1 ruby examples/act.rb       # watch the local browser

require "json"

require_relative "../../lib/stagehand"

module ExampleHelpers
  module_function

  def env(name)
    value = ENV.fetch(name, nil)
    value unless value.nil? || value.empty?
  end

  def resolve_model
    return [env("MODEL_NAME"), env("MODEL_API_KEY")] if env("MODEL_NAME")
    return ["openai/gpt-5-mini", env("OPENAI_API_KEY")] if env("OPENAI_API_KEY")
    return ["anthropic/claude-haiku-4-5", env("ANTHROPIC_API_KEY")] if env("ANTHROPIC_API_KEY")
    return ["google/gemini-2.5-flash", env("GOOGLE_API_KEY")] if env("GOOGLE_API_KEY")
    [nil, nil]
  end

  # Launches a browser, creates a Stagehand client, and yields
  # (stagehand, page, browser); everything is closed on the way out.
  def with_stagehand(force_browserbase: false, **create_extras)
    use_browserbase = force_browserbase || ARGV.include?("--browserbase")
    model, model_api_key = resolve_model
    browserbase_api_key = env("BROWSERBASE_API_KEY")

    if model.nil? && browserbase_api_key.nil?
      abort "Set a provider key (OPENAI_API_KEY / ANTHROPIC_API_KEY / GOOGLE_API_KEY or " \
            "MODEL_NAME + MODEL_API_KEY), or BROWSERBASE_API_KEY for the Model Gateway."
    end
    if !use_browserbase && model.nil?
      abort "Local runs need a provider key (the Model Gateway is Browserbase-only). " \
            "Set OPENAI_API_KEY etc., or pass --browserbase."
    end

    browser =
      if use_browserbase
        abort "Set BROWSERBASE_API_KEY to run on Browserbase." if browserbase_api_key.nil?
        puts "Creating a Browserbase session..."
        Stagehand::Browserbase.launch(api_key: browserbase_api_key)
      else
        puts "Launching local Chrome..."
        Stagehand::LocalBrowser.launch(headless: ENV["HEADED"].nil?)
      end

    begin
      create_options = { browser: browser, log_level: ENV.fetch("STAGEHAND_LOG_LEVEL", "warn") }
      if model && model_api_key
        create_options[:model] = model
        create_options[:model_api_key] = model_api_key
      else
        # No provider key: authenticate the Browserbase Model Gateway instead.
        create_options[:api_key] = browserbase_api_key
      end
      stagehand = Stagehand.create(**create_options, **create_extras)
      begin
        puts "Session: #{browser.session_id}" if browser.session_id
        page = browser.context.active_page || browser.context.pages.first
        raise "Stagehand initialized without an active page" if page.nil?
        yield stagehand, page, browser
      ensure
        stagehand.close
      end
    ensure
      browser.close
    end
  end
end
