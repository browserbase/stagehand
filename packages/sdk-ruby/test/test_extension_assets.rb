# frozen_string_literal: true

require_relative "test_helper"
require "digest"

class TestExtensionAssets < Minitest::Test
  def setup
    directory = Stagehand::ExtensionAssets.extension_directory
    skip "extension not built (pnpm --filter ./packages/extension build)" unless File.file?(File.join(directory, "manifest.json"))
  end

  def test_archive_is_deterministic_across_runs
    first = Stagehand::ExtensionAssets.build_extension_archive
    second = Stagehand::ExtensionAssets.build_extension_archive
    assert_equal Digest::SHA256.hexdigest(first), Digest::SHA256.hexdigest(second)
  end

  def test_archive_is_a_valid_zip_with_pinned_metadata
    archive = Stagehand::ExtensionAssets.build_extension_archive
    assert archive.start_with?("PK\x03\x04".b), "missing local file header signature"

    eocd_offset = archive.rindex("PK\x05\x06".b)
    refute_nil eocd_offset, "missing end-of-central-directory record"
    _sig, _disk, _cd_disk, entries, total, _cd_size, cd_offset, _comment =
      archive.byteslice(eocd_offset, 22).unpack("VvvvvVVv")
    assert_equal entries, total
    assert_operator entries, :>, 0

    # First central-directory entry: unix made-by, deflate, 1980-01-01, 0644.
    header = archive.byteslice(cd_offset, 46).unpack("VvvvvvvVVVvvvvvVV")
    assert_equal 0x02014b50, header[0]
    assert_equal((3 << 8) | 20, header[1])
    assert_equal 8, header[4], "expected deflate"
    assert_equal 0, header[5], "expected DOS time 00:00:00"
    assert_equal((1 << 5) | 1, header[6], "expected DOS date 1980-01-01")
    assert_equal 0o644 << 16, header[15]

    names = []
    offset = cd_offset
    entries.times do
      fields = archive.byteslice(offset, 46).unpack("VvvvvvvVVVvvvvvVV")
      name_length = fields[10]
      names << archive.byteslice(offset + 46, name_length)
      offset += 46 + name_length + fields[11] + fields[12]
    end
    assert_includes names, "manifest.json"
  end
end
