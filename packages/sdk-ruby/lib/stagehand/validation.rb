# frozen_string_literal: true

require "uri"

require_relative "generated/models"

module Stagehand
  # Client-side input validation. Port of
  # packages/sdk-python/src/stagehand/_validation.py plus the create-config
  # scalar constraints pydantic enforces there.
  module Validation
    MAX_SAFE_INTEGER = 9_007_199_254_740_991

    module_function

    def boolean!(value, name)
      return if value == true || value == false
      raise ArgumentError, "#{name} must be true or false"
    end

    def nonempty_string!(value, name)
      return if value.is_a?(String) && !value.empty?
      raise ArgumentError, "#{name} must be a non-empty String"
    end

    def positive_integer!(value, name, max: MAX_SAFE_INTEGER)
      return if value.is_a?(Integer) && value.positive? && value <= max
      raise ArgumentError, "#{name} must be a positive Integer (<= #{max})"
    end

    def string_map!(value, name)
      valid = value.is_a?(Hash) && value.all? do |key, entry|
        (key.is_a?(String) || key.is_a?(Symbol)) && entry.is_a?(String)
      end
      raise ArgumentError, "#{name} must be a Hash of String values" unless valid
    end

    # Cross-field constraints for page.screenshot (options already .compact-ed).
    def screenshot_options!(options)
      if options[:full_page] && !options[:clip].nil?
        raise ArgumentError, "fullPage and clip cannot be used together"
      end
      return unless options.key?(:quality) && options[:type] != "jpeg"
      raise ArgumentError, 'quality is only valid when type is "jpeg"'
    end

    # Accepts Models::TelemetryConfig or a {traces: {endpoint:, headers:}}
    # Hash; validates the OTLP endpoint and returns a TelemetryConfig.
    def telemetry_config(telemetry)
      config =
        case telemetry
        when Models::TelemetryConfig then telemetry
        when Hash
          traces = telemetry[:traces] || telemetry["traces"]
          traces = Models::TelemetryTraces.new(**traces.transform_keys(&:to_sym)) if traces.is_a?(Hash)
          raise ArgumentError, "telemetry must include traces" unless traces.is_a?(Models::TelemetryTraces)
          Models::TelemetryConfig.new(traces: traces)
        else
          raise ArgumentError, "telemetry must be a Models::TelemetryConfig or a Hash"
        end
      endpoint = config.traces&.endpoint
      unless endpoint.nil?
        nonempty_string!(endpoint, "telemetry traces endpoint")
        path =
          begin
            URI.parse(endpoint).path.to_s
          rescue URI::InvalidURIError
            raise ArgumentError, "telemetry traces endpoint must be a valid URL"
          end
        raise ArgumentError, "OTLP trace endpoint must end with /v1/traces" unless path.end_with?("/v1/traces")
      end
      config
    end

    # Cache is true/false or {threshold: positive Integer}; returns the wire
    # value (the protocol `Caching` field is an opaque passthrough).
    def cache_config(cache)
      return cache if cache == true || cache == false
      if cache.is_a?(Hash)
        unknown = cache.keys.reject { |key| key.to_s == "threshold" }
        raise ArgumentError, "unknown cache option(s): #{unknown.join(", ")}" unless unknown.empty?
        threshold = cache[:threshold] || cache["threshold"]
        return {} if threshold.nil?
        positive_integer!(threshold, "cache threshold")
        return { "threshold" => threshold }
      end
      raise ArgumentError, "cache must be true, false, or a Hash with :threshold"
    end
  end
end
