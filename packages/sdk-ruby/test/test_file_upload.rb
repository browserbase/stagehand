# frozen_string_literal: true

require_relative "test_helper"

require "tempfile"

class TestFileUpload < Minitest::Test
  def test_normalizes_a_path_into_a_wire_payload
    Tempfile.create(["report", ".csv"]) do |file|
      file.write("a,b\n1,2\n")
      file.flush
      payloads = Stagehand::FileUpload.normalize_file_input(file.path)
      assert_equal 1, payloads.length
      payload = payloads.first
      assert_instance_of Stagehand::Models::InputFilePayload, payload
      assert_equal File.basename(file.path), payload.name
      assert_equal "a,b\n1,2\n", Base64.strict_decode64(payload.data)
      assert_in_delta File.stat(file.path).mtime.to_f * 1000, payload.last_modified, 1000
      refute payload.field_set?("mime_type")
    end
  end

  def test_accepts_a_mixed_array_of_paths_and_payloads
    Tempfile.create("upload") do |file|
      file.write("x")
      file.flush
      payloads = Stagehand::FileUpload.normalize_file_input([
        file.path,
        Stagehand::FilePayload.new(name: "inline.txt", buffer: "hi", mime_type: "text/plain"),
      ])
      assert_equal 2, payloads.length
      assert_equal "inline.txt", payloads.last.name
      assert_equal "hi", Base64.strict_decode64(payloads.last.data)
      assert_equal "text/plain", payloads.last.mime_type
    end
  end

  def test_payload_last_modified_passthrough
    payload = Stagehand::FileUpload.normalize_file_input(
      Stagehand::FilePayload.new(name: "a.bin", buffer: "\x00\xFF".b, last_modified: 1_234),
    ).first
    assert_equal 1_234, payload.last_modified
    assert_equal "\x00\xFF".b, Base64.strict_decode64(payload.data)
  end

  def test_missing_file_raises
    error = assert_raises(ArgumentError) do
      Stagehand::FileUpload.normalize_file_input("/nonexistent/nope.txt")
    end
    assert_equal "set_input_files(): expected a readable file", error.message
  end

  def test_directory_raises
    error = assert_raises(ArgumentError) { Stagehand::FileUpload.normalize_file_input(Dir.tmpdir) }
    assert_equal "set_input_files(): expected a readable file", error.message
  end

  def test_empty_payload_name_raises
    error = assert_raises(ArgumentError) do
      Stagehand::FileUpload.normalize_file_input(Stagehand::FilePayload.new(name: "", buffer: "x"))
    end
    assert_equal "set_input_files(): file payload name cannot be empty", error.message
  end

  def test_oversized_payload_raises
    big = "x" * (Stagehand::FileUpload::MAX_INPUT_FILE_BYTES + 1)
    error = assert_raises(ArgumentError) do
      Stagehand::FileUpload.normalize_file_input(Stagehand::FilePayload.new(name: "big.bin", buffer: big))
    end
    assert_equal "set_input_files(): file is larger than the 50 MiB upload limit", error.message
  end

  def test_unsupported_input_raises
    error = assert_raises(ArgumentError) { Stagehand::FileUpload.normalize_file_input(42) }
    assert_equal "set_input_files(): expected a path or FilePayload for every file", error.message
  end
end
