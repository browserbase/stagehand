# frozen_string_literal: true

require_relative "version"

module Stagehand
  STAGEHAND_SDK_CLIENT_INFO = { "name" => "stagehand-sdk-ruby", "version" => VERSION }.freeze

  STAGEHAND_SESSION_METADATA = {
    "stagehand" => "true",
    "stagehand_sdk_language" => "ruby",
    "stagehand_sdk_version" => VERSION,
  }.freeze
end
