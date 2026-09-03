# frozen_string_literal: true

require "zlib"

require_relative "errors"

module Stagehand
  # Locates the embedded Stagehand extension and builds the deterministic zip
  # uploaded to Browserbase. The archive layout matches
  # packages/sdk-python/src/stagehand/extension_assets.py byte for byte:
  # os.walk order (per-directory, dirs and files sorted), entry timestamps
  # pinned to 1980-01-01, unix external attrs 0644, deflate compression.
  module ExtensionAssets
    DOS_EPOCH_DATE = ((1 << 5) | 1) # 1980-01-01
    DOS_EPOCH_TIME = 0
    UNIX_MADE_BY = (3 << 8) | 20
    VERSION_NEEDED = 20
    EXTERNAL_ATTRIBUTES = 0o644 << 16

    module_function

    def extension_directory
      bundled = File.expand_path("_extension", __dir__)
      return bundled if File.file?(File.join(bundled, "manifest.json"))
      # Development fallback: the monorepo extension build output.
      File.expand_path("../../../extension/dist", __dir__)
    end

    def build_extension_archive
      directory = extension_directory
      unless File.file?(File.join(directory, "manifest.json"))
        raise StagehandError, "Stagehand extension manifest.json was not found in #{directory}. " \
                              "Build it with: pnpm --filter ./packages/extension build"
      end

      archive = +""
      central_directory = +""
      entry_count = 0

      walk(directory, "") do |relative_path, absolute_path|
        data = File.binread(absolute_path)
        crc = Zlib.crc32(data)
        compressed = raw_deflate(data)
        name = relative_path.b
        offset = archive.bytesize

        archive << [0x04034b50, VERSION_NEEDED, 0, 8, DOS_EPOCH_TIME, DOS_EPOCH_DATE,
                    crc, compressed.bytesize, data.bytesize, name.bytesize, 0].pack("VvvvvvVVVvv")
        archive << name << compressed

        central_directory << [0x02014b50, UNIX_MADE_BY, VERSION_NEEDED, 0, 8, DOS_EPOCH_TIME, DOS_EPOCH_DATE,
                              crc, compressed.bytesize, data.bytesize, name.bytesize,
                              0, 0, 0, 0, EXTERNAL_ATTRIBUTES, offset].pack("VvvvvvvVVVvvvvvVV")
        central_directory << name
        entry_count += 1
      end

      central_offset = archive.bytesize
      archive << central_directory
      archive << [0x06054b50, 0, 0, entry_count, entry_count,
                  central_directory.bytesize, central_offset, 0].pack("VvvvvVVv")
      archive
    end

    # Depth-first, files before subdirectories, both sorted — os.walk order.
    def walk(root, prefix, &block)
      entries = Dir.children(File.join(root, prefix)).sort
      directories = []
      entries.each do |entry|
        relative = prefix.empty? ? entry : "#{prefix}/#{entry}"
        absolute = File.join(root, relative)
        if File.directory?(absolute)
          directories << relative
        else
          block.call(relative, absolute)
        end
      end
      directories.each { |directory| walk(root, directory, &block) }
    end

    def raw_deflate(data)
      deflater = Zlib::Deflate.new(Zlib::DEFAULT_COMPRESSION, -Zlib::MAX_WBITS)
      compressed = deflater.deflate(data, Zlib::FINISH)
      deflater.close
      compressed
    end
  end
end
