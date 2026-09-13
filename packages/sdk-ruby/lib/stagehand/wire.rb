# frozen_string_literal: true

require_relative "errors"

module Stagehand
  # Runtime support for the generated wire models.
  #
  # The protocol schema (packages/protocol/stagehand.v4.json) already uses
  # snake_case wire names, so Ruby attribute names equal wire names and no
  # casing conversion happens here. Opaque containers (headers, variables,
  # body, data, user_metadata, ...) compile to a `nil` descriptor and pass
  # through both directions untouched.
  #
  # Field descriptors:
  #   nil               raw JSON value, passed through verbatim
  #   String            reference to a definition in Models::DEFS
  #   [:array, desc]    array of desc
  #   [:map, desc]      string-keyed object whose values are desc
  #   [:union, [desc]]  first structurally-matching variant wins, else raw
  module Wire
    module_function

    def encode(value)
      case value
      when Model then value.to_wire
      when Array then value.map { |entry| encode(entry) }
      when Hash then value.transform_values { |entry| encode(entry) }
      else value
      end
    end

    def decode(value, descriptor)
      case descriptor
      when nil
        value
      when String
        decode(value, Models::DEFS.fetch(descriptor) { raise WireError, "unknown wire definition: #{descriptor}" })
      when Class
        value.is_a?(Hash) ? descriptor.from_wire(value) : value
      when Array
        decode_compound(value, descriptor)
      else
        raise WireError, "invalid wire descriptor: #{descriptor.inspect}"
      end
    end

    def decode_compound(value, descriptor)
      kind, inner = descriptor
      case kind
      when :array
        value.is_a?(Array) ? value.map { |entry| decode(entry, inner) } : value
      when :map
        value.is_a?(Hash) ? value.transform_values { |entry| decode(entry, inner) } : value
      when :union
        decode_union(value, inner)
      else
        raise WireError, "invalid wire descriptor: #{descriptor.inspect}"
      end
    end

    def decode_union(value, variants)
      if value.is_a?(Hash)
        variants.each do |variant|
          model = resolve_model(variant)
          next if model.nil?
          return model.from_wire(value) if model::REQUIRED.all? { |key| value.key?(key) }
        end
      end
      variants.each do |variant|
        next unless variant.is_a?(Array)
        kind = variant.first
        return decode(value, variant) if kind == :array && value.is_a?(Array)
        return decode(value, variant) if kind == :map && value.is_a?(Hash)
      end
      value
    end

    # Follows reference chains until a Model class or nil.
    def resolve_model(descriptor, depth = 0)
      return nil if depth > 16
      case descriptor
      when Class then descriptor
      when String then resolve_model(Models::DEFS[descriptor], depth + 1)
      else nil
      end
    end

    # Base class for generated protocol models. Tracks which fields were
    # explicitly provided so #to_wire never emits unset fields (the analogue
    # of Pydantic's exclude_unset). Unknown wire keys survive a decode/encode
    # round trip via @__extra.
    class Model
      class << self
        def from_wire(hash)
          raise WireError, "#{name} expects a wire object, got #{hash.class}" unless hash.is_a?(Hash)
          missing = self::REQUIRED.reject { |key| hash.key?(key) }
          raise WireError, "#{name} is missing required wire fields: #{missing.join(", ")}" unless missing.empty?
          instance = allocate
          instance.__init_from_wire(hash)
          instance
        end
      end

      def initialize(**values)
        @__set_keys = []
        @__extra = {}
        fields = self.class::FIELDS
        values.each do |key, value|
          name = key.to_s
          raise ArgumentError, "unknown field #{name} for #{self.class.name}" unless fields.key?(name)
          instance_variable_set(:"@#{name}", value)
          @__set_keys << name
        end
      end

      def __init_from_wire(hash)
        @__set_keys = []
        @__extra = {}
        fields = self.class::FIELDS
        hash.each do |key, value|
          if fields.key?(key)
            instance_variable_set(:"@#{key}", Wire.decode(value, fields[key]))
            @__set_keys << key
          else
            @__extra[key] = value
          end
        end
      end

      def to_wire
        wire = {}
        @__set_keys.each { |key| wire[key] = Wire.encode(instance_variable_get(:"@#{key}")) }
        wire.merge!(@__extra)
        wire
      end

      def [](key)
        name = key.to_s
        return @__extra[name] unless self.class::FIELDS.key?(name)
        instance_variable_get(:"@#{name}")
      end

      def field_set?(key)
        @__set_keys.include?(key.to_s)
      end

      def ==(other)
        other.class == self.class && other.to_wire == to_wire
      end
      alias eql? ==

      def hash
        [self.class, to_wire].hash
      end

      def inspect
        pairs = @__set_keys.map { |key| "#{key}=#{instance_variable_get(:"@#{key}").inspect}" }
        "#<#{self.class.name} #{pairs.join(" ")}>"
      end
    end
  end
end
