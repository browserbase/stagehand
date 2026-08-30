# frozen_string_literal: true

require_relative "test_helper"

class TestModels < Minitest::Test
  Models = Stagehand::Models

  def test_act_params_round_trip_with_nested_options
    params = Models::StagehandActParams.new(
      page_id: "page-1",
      instruction: "click the login button",
      options: Models::ActOptions.new(timeout: 5_000),
    )
    assert_equal(
      {
        "page_id" => "page-1",
        "instruction" => "click the login button",
        "options" => { "timeout" => 5_000 },
      },
      params.to_wire,
    )
  end

  def test_unset_fields_are_never_emitted
    params = Models::StagehandInitParams.new(protocol_version: "1.0.0")
    assert_equal({ "protocol_version" => "1.0.0" }, params.to_wire)
    refute params.field_set?(:log_level)
  end

  def test_from_wire_decodes_nested_models
    result = Models::ActResult.from_wire(
      "data" => {
        "success" => true,
        "message" => "clicked",
        "action_description" => "click login",
        "actions" => [
          { "selector" => "#login", "description" => "login button", "method" => "click" },
        ],
      },
      "metadata" => {
        "cache" => { "status" => "DISABLED" },
        "usage" => { "input_tokens" => 0, "output_tokens" => 0, "inference_time_ms" => 0 },
      },
    )
    assert_instance_of Models::ActResultData, result.data
    assert_equal true, result.data.success
    assert_instance_of Models::Action, result.data.actions.first
    assert_equal "#login", result.data.actions.first.selector
    assert_instance_of Models::StagehandResultMetadata, result.metadata
  end

  def test_from_wire_requires_required_fields
    error = assert_raises(Stagehand::WireError) { Models::ActResult.from_wire("data" => {}) }
    assert_match(/metadata/, error.message)
  end

  def test_union_field_decodes_matching_class_variant
    params = Models::StagehandActParams.from_wire(
      "page_id" => "page-1",
      "instruction" => { "selector" => "#go", "description" => "go button" },
    )
    assert_instance_of Models::Action, params.instruction

    plain = Models::StagehandActParams.from_wire("page_id" => "page-1", "instruction" => "click go")
    assert_equal "click go", plain.instruction
  end

  def test_closed_unions_decode_strictly
    # LLMGenerateResult has only structured variants: garbage must raise.
    assert_raises(Stagehand::WireError) do
      Stagehand::Wire.decode({ "bogus" => true }, "LLMGenerateResult")
    end
    assert_raises(Stagehand::WireError) do
      Stagehand::Wire.decode("not an object", "LLMGenerateParams")
    end
    decoded = Stagehand::Wire.decode(
      { "role" => "assistant", "content" => { "type" => "text", "text" => "hi" }, "output_format" => "text" },
      "LLMGenerateResult",
    )
    assert_instance_of Models::LLMMessageGenerateResult, decoded
    assert_instance_of Models::LLMTextContent, decoded.content
  end

  def test_open_unions_pass_unmatched_values_through
    # ContextActivePageResult is PageRef | null in the protocol.
    assert_nil Stagehand::Wire.decode(nil, "ContextActivePageResult")
    # instruction is string | Action: strings stay raw even under strictness.
    assert_equal "click", Stagehand::Wire.decode("click", Models::StagehandActParams::FIELDS["instruction"])
    # CookieFilter is string | CookieRegex.
    assert_equal "session", Stagehand::Wire.decode("session", "CookieFilter")
    regex = Stagehand::Wire.decode({ "source" => "^a", "flags" => "i" }, "CookieFilter")
    assert_instance_of Models::CookieRegex, regex
  end

  def test_scalar_fields_validate_on_decode
    assert_raises(Stagehand::WireError) do
      Models::PageGotoParams.from_wire("page_id" => "p", "url" => 42)
    end
    error = assert_raises(Stagehand::WireError) do
      Stagehand::Wire.decode(true, :integer)
    end
    assert_match(/expected integer/, error.message)
    # :number accepts Integer and Float, never booleans; nil passes (nullable).
    assert_equal 1, Stagehand::Wire.decode(1, :number)
    assert_equal 1.5, Stagehand::Wire.decode(1.5, :number)
    assert_raises(Stagehand::WireError) { Stagehand::Wire.decode(true, :number) }
    assert_nil Stagehand::Wire.decode(nil, :string)
  end

  def test_scalar_fields_validate_on_construction
    error = assert_raises(ArgumentError) { Models::PageGotoParams.new(page_id: "p", url: 42) }
    assert_match(/url: expected string/, error.message)
    assert_raises(ArgumentError) { Models::PageClickParams.new(page_id: "p", x: "ten", y: 2) }
    # Valid construction still works, including nullable omissions.
    assert_equal "https://x.test", Models::PageGotoParams.new(page_id: "p", url: "https://x.test").url
  end

  def test_enum_fields_validate_membership
    message = Models::LLMMessage.from_wire("role" => "user", "content" => { "type" => "text", "text" => "hi" })
    assert_equal "user", message.role
    assert_raises(Stagehand::WireError) do
      Models::LLMMessage.from_wire("role" => "narrator", "content" => { "type" => "text", "text" => "hi" })
    end
    assert_raises(ArgumentError) { Models::LLMMessage.new(role: "narrator", content: []) }
  end

  def test_scalar_union_variants_are_strict
    # CookieFilter is string | CookieRegex: numbers no longer pass through.
    assert_equal "session", Stagehand::Wire.decode("session", "CookieFilter")
    assert_raises(Stagehand::WireError) { Stagehand::Wire.decode(42, "CookieFilter") }
  end

  def test_structural_mismatches_raise
    assert_raises(Stagehand::WireError) { Stagehand::Wire.decode("nope", Models::ActResult) }
    assert_raises(Stagehand::WireError) { Stagehand::Wire.decode({ "a" => 1 }, [:array, "PageRef"]) }
    assert_raises(Stagehand::WireError) { Stagehand::Wire.decode([1], [:map, "PageRef"]) }
    # JSON null stays nil for nullable fields at every level.
    assert_nil Stagehand::Wire.decode(nil, Models::ActResult)
    assert_nil Stagehand::Wire.decode(nil, [:array, "PageRef"])
  end

  def test_opaque_extract_data_passes_through_untouched
    payload = { "camelCaseKey" => [1, 2.5, nil, { "another_one" => true }] }
    result = Models::ExtractResult.from_wire(
      "data" => payload,
      "metadata" => {
        "cache" => { "status" => "DISABLED" },
        "usage" => { "input_tokens" => 1, "output_tokens" => 2, "inference_time_ms" => 3 },
      },
    )
    assert_equal payload, result.data
    assert_equal payload, result.to_wire.fetch("data")
  end

  def test_unknown_wire_keys_survive_round_trip
    wire = { "page_id" => "page-1", "some_future_field" => { "x" => 1 } }
    ref = Models::PageRef.from_wire(wire)
    assert_equal wire, ref.to_wire
    assert_equal({ "x" => 1 }, ref["some_future_field"])
  end

  def test_registries_cover_the_protocol
    assert_equal 77, Models::METHODS.size
    assert_equal 2, Models::NOTIFICATIONS.size
    assert_equal "StagehandActParams", Models::METHODS.fetch("stagehand.act").fetch(:params)
    assert_equal [:array, "PageRef"], Models::DEFS.fetch("ContextPagesResult")
  end

  def test_browserbase_session_create_params
    params = Models::BrowserbaseSessionCreateParams.new(keep_alive: true, region: "us-west-2")
    assert_equal({ "keep_alive" => true, "region" => "us-west-2" }, params.to_wire)
  end

  def test_unknown_constructor_field_raises
    assert_raises(ArgumentError) { Models::PageRef.new(nope: 1) }
  end
end
