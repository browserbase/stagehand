# frozen_string_literal: true

require "base64"
require "pathname"

require_relative "errors"
require_relative "generated/models"

module Stagehand
  # A file passed to Locator#set_input_files without touching disk. buffer is
  # a String (binary or text); mime_type/last_modified are optional.
  FilePayload = Data.define(:name, :buffer, :mime_type, :last_modified) do
    def initialize(name:, buffer:, mime_type: nil, last_modified: nil)
      super
    end
  end

  # Normalizes set_input_files inputs into wire payloads. Port of
  # packages/sdk-python/src/stagehand/file_upload.py.
  module FileUpload
    MAX_INPUT_FILE_BYTES = 50 * 1024 * 1024

    module_function

    def normalize_file_input(files)
      entries = files.is_a?(Array) ? files : [files]
      entries.map { |entry| normalize_file(entry) }
    end

    def normalize_file(file)
      case file
      when String, Pathname then normalize_path(file)
      when FilePayload then normalize_payload(file)
      else raise ArgumentError, "set_input_files(): expected a path or FilePayload for every file"
      end
    end

    def normalize_path(file)
      path = File.expand_path(file)
      begin
        file_stat = File.stat(path)
        raise ArgumentError, "set_input_files(): expected a readable file" unless file_stat.file?
        if file_stat.size > MAX_INPUT_FILE_BYTES
          raise ArgumentError, "set_input_files(): file is larger than the 50 MiB upload limit"
        end
        data = File.binread(path)
      rescue SystemCallError, IOError
        raise ArgumentError, "set_input_files(): expected a readable file"
      end
      values = { name: File.basename(path), data: Base64.strict_encode64(data) }
      last_modified = (file_stat.mtime.to_r * 1000).to_i
      values[:last_modified] = last_modified if last_modified >= 0
      Models::InputFilePayload.new(**values)
    end

    def normalize_payload(file)
      raise ArgumentError, "set_input_files(): file payload name cannot be empty" if file.name.to_s.empty?
      buffer = file.buffer.to_s.b
      if buffer.bytesize > MAX_INPUT_FILE_BYTES
        raise ArgumentError, "set_input_files(): file is larger than the 50 MiB upload limit"
      end
      values = { name: file.name, data: Base64.strict_encode64(buffer) }
      values[:mime_type] = file.mime_type unless file.mime_type.nil?
      values[:last_modified] = file.last_modified unless file.last_modified.nil?
      Models::InputFilePayload.new(**values)
    end
  end
end
