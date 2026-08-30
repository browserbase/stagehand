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
  #   :string/:integer/:number/:boolean/:null
  #                     scalar type check (nil always passes: nullable fields)
  #   String            reference to a definition in Models::DEFS
  #   [:enum, name]     value must be in Models::<name>::VALUES
  #   [:array, desc]    array of desc
  #   [:map, desc]      string-keyed object whose values are desc
  #   [:union, [desc]]  first structurally-matching variant wins. A nil in
  #                     the variant list marks an "open" union (the protocol
  #                     union also had scalar/null variants): unmatched
  #                     values stay raw. Closed unions raise WireError when
  #                     nothing matches. JSON null passes through everywhere
  #                     (nullable fields).
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
      when Symbol
        check_scalar(value, descriptor) { |message| raise WireError, message }
        value
      when String
        decode(value, Models::DEFS.fetch(descriptor) { raise WireError, "unknown wire definition: #{descriptor}" })
      when Class
        return descriptor.from_wire(value) if value.is_a?(Hash)
        return value if value.nil?
        raise WireError, "#{descriptor.name} expects a wire object, got #{value.class}"
      when Array
        decode_compound(value, descriptor)
      else
        raise WireError, "invalid wire descriptor: #{descriptor.inspect}"
      end
    end

    def decode_compound(value, descriptor)
      kind, inner = descriptor
      case kind
      when :enum
        check_scalar(value, descriptor) { |message| raise WireError, message }
        return value
      end
      case kind
      when :array
        return value.map { |entry| decode(entry, inner) } if value.is_a?(Array)
        return value if value.nil?
        raise WireError, "expected a wire array, got #{value.class}"
      when :map
        return value.transform_values { |entry| decode(entry, inner) } if value.is_a?(Hash)
        return value if value.nil?
        raise WireError, "expected a wire object, got #{value.class}"
      when :union
        decode_union(value, inner)
      else
        raise WireError, "invalid wire descriptor: #{descriptor.inspect}"
      end
    end

    def decode_union(value, variants, depth = 0)
      return value if depth > 16
      open = variants.any?(&:nil?)
      if value.is_a?(Hash)
        variants.each do |variant|
          model = resolve_model(variant)
          next if model.nil?
          return model.from_wire(value) if model::REQUIRED.all? { |key| value.key?(key) }
        end
      end
      variants.each do |variant|
        next if variant.nil?
        descriptor = variant.is_a?(String) ? Models::DEFS[variant] : variant
        # A reference that resolves to an opaque definition accepts any
        # value: the union stays open.
        open = true if variant.is_a?(String) && descriptor.nil? && Models::DEFS.key?(variant)
        return value if descriptor.is_a?(Symbol) && scalar_matches?(value, descriptor)
        next unless descriptor.is_a?(Array)
        kind = descriptor.first
        case kind
        when :enum
          return value if scalar_matches?(value, descriptor)
        when :array
          return decode(value, descriptor) if value.is_a?(Array)
        when :map
          return decode(value, descriptor) if value.is_a?(Hash)
        when :union
          # A reference to another union (e.g. LLMMessageContentBlock): decode
          # through it and keep the result when a nested variant matched.
          begin
            decoded = decode_union(value, descriptor.last, depth + 1)
            return decoded unless decoded.equal?(value)
            open = true # the nested union was open and passed the value raw
          rescue WireError
            nil # closed nested union with no match: try the remaining variants
          end
        end
      end
      return value if open || value.nil?
      raise WireError, "value matches no union variant"
    end

    # True when the value satisfies a scalar or enum descriptor (nil always
    # passes: nullable fields).
    def scalar_matches?(value, descriptor)
      return true if value.nil?
      case descriptor
      when :string then value.is_a?(String)
      when :integer then value.is_a?(Integer)
      when :number then value.is_a?(Numeric) && !value.is_a?(Complex)
      when :boolean then value == true || value == false
      when :null then false # non-nil value never matches null
      when Array then descriptor.first == :enum && enum_values(descriptor.last).include?(value)
      else false
      end
    end

    def check_scalar(value, descriptor)
      return if scalar_matches?(value, descriptor)
      expected = descriptor.is_a?(Array) ? "one of #{descriptor.last}::VALUES" : descriptor.to_s
      yield "expected #{expected}, got #{value.inspect}"
    end

    def enum_values(name)
      Models.const_get(name)::VALUES
    end

    # Resolves a descriptor to its scalar/enum form (following reference
    # chains), or nil when it is not scalar-checkable.
    def scalar_descriptor(descriptor, depth = 0)
      return nil if depth > 16
      case descriptor
      when Symbol then descriptor
      when String then scalar_descriptor(Models::DEFS[descriptor], depth + 1)
      when Array then descriptor.first == :enum ? descriptor : nil
      else nil
      end
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
          # Scalar and enum fields validate at construction (the analogue of
          # pydantic's validate-on-construct); structured fields stay shallow
          # here and validate at the decode boundary.
          scalar = Wire.scalar_descriptor(fields[name])
          if scalar
            Wire.check_scalar(value, scalar) do |message|
              raise ArgumentError, "#{self.class.name}.#{name}: #{message}"
            end
          end
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
