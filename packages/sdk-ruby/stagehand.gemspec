# frozen_string_literal: true

require_relative "lib/stagehand/version"

Gem::Specification.new do |spec|
  spec.name = "stagehand"
  spec.version = Stagehand::VERSION
  spec.authors = ["Browserbase"]
  spec.email = ["support@browserbase.com"]
  spec.summary = "Stagehand v4 Ruby SDK"
  spec.description =
    "AI-powered browser automation. Ruby client for the Stagehand v4 runtime: " \
    "JSON-RPC over the Chrome DevTools Protocol to the embedded Stagehand extension."
  spec.homepage = "https://github.com/browserbase/stagehand"
  spec.license = "MIT"
  spec.required_ruby_version = ">= 3.2"
  spec.metadata = {
    "homepage_uri" => "https://docs.stagehand.dev",
    "source_code_uri" => "https://github.com/browserbase/stagehand/tree/main/packages/sdk-ruby",
    "changelog_uri" => "https://github.com/browserbase/stagehand/blob/main/packages/sdk-ruby/CHANGELOG.md",
    "bug_tracker_uri" => "https://github.com/browserbase/stagehand/issues",
    "rubygems_mfa_required" => "true",
  }

  spec.files = Dir["lib/**/*", "sig/**/*", "README.md"]
  spec.require_paths = ["lib"]

  spec.add_dependency "websocket-driver", "~> 0.8"
end
