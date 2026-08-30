# frozen_string_literal: true

require_relative "test_helper"

# Round-trips the protocol test fixtures through the generated models to prove
# the wire codec neither renames nor drops keys (including keys inside opaque
# containers).
class TestWireFixtures < Minitest::Test
  def test_callback_batch_fixture_params_round_trip
    fixture = JSON.parse(File.read(File.join(PROTOCOL_DIR, "tests", "fixtures", "callback-batch-wire.json")))
    fixture.each do |case_name, request|
      wire_params = request.fetch("params")
      model = Stagehand::Models::CallbackBatchParams.from_wire(wire_params)
      assert_equal wire_params, model.to_wire, "params round trip drifted for #{case_name}"
    end
  end

  def test_every_registry_descriptor_resolves
    walk = lambda do |descriptor|
      case descriptor
      when nil then nil
      when :string, :integer, :number, :boolean, :null then nil
      when String
        assert Stagehand::Models::DEFS.key?(descriptor), "dangling wire reference: #{descriptor}"
      when Array
        kind, inner = descriptor
        if kind == :union
          inner.each { |variant| walk.call(variant) }
        elsif kind == :enum
          assert Stagehand::Models.const_defined?(inner), "dangling enum reference: #{inner}"
          assert_kind_of Array, Stagehand::Models.const_get(inner)::VALUES
        else
          walk.call(inner)
        end
      else
        flunk "invalid descriptor #{descriptor.inspect}"
      end
    end

    Stagehand::Models::DEFS.each_value { |value| walk.call(value) unless value.is_a?(Class) }
    Stagehand::Models::DEFS.each_value do |value|
      next unless value.is_a?(Class)
      value::FIELDS.each_value { |descriptor| walk.call(descriptor) }
    end
    Stagehand::Models::METHODS.each_value do |entry|
      walk.call(entry[:params])
      walk.call(entry[:result])
    end
    Stagehand::Models::NOTIFICATIONS.each_value { |entry| walk.call(entry[:params]) }
  end
end
