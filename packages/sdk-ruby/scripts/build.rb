# frozen_string_literal: true

# Builds the distributable gem with the Stagehand extension embedded, the
# analogue of packages/sdk-python/scripts/build.py. The extension build
# output (packages/extension/dist) is staged into lib/stagehand/_extension —
# the location ExtensionAssets checks first — so the installed gem is
# self-contained; the staging directory is removed afterwards so the
# development tree keeps resolving the monorepo build. Stdlib-only: runs with
# plain `ruby scripts/build.rb`, no Bundler required.

require "fileutils"
require "rubygems"
require "rubygems/package"

package_root = File.expand_path("..", __dir__)
extension_dist = File.expand_path("../extension/dist", package_root)
staged_extension = File.join(package_root, "lib/stagehand/_extension")
output_directory = File.join(package_root, "dist")

unless File.file?(File.join(extension_dist, "manifest.json"))
  abort "The Stagehand extension is not built. Run: pnpm --filter ./packages/extension build"
end

FileUtils.rm_rf(staged_extension)
FileUtils.rm_rf(output_directory)
FileUtils.mkdir_p(output_directory)

begin
  FileUtils.cp_r(extension_dist, staged_extension)

  # The gemspec globs files relative to the working directory, so both the
  # load and the build must run from the package root (CI invokes this
  # script from the repository root).
  gem_path = Dir.chdir(package_root) do
    specification = Gem::Specification.load("stagehand.gemspec")
    abort "Could not load stagehand.gemspec" if specification.nil?
    Gem::Package.build(specification)
  end
  built = File.join(package_root, gem_path)
  target = File.join(output_directory, File.basename(gem_path))
  FileUtils.mv(built, target)

  # The gem must carry the extension and the signatures.
  contents = []
  Gem::Package.new(target).contents.each { |entry| contents << entry }
  %w[lib/stagehand/_extension/manifest.json sig/stagehand.rbs].each do |required|
    abort "Built gem is missing #{required}" unless contents.include?(required)
  end

  puts "Built #{target} (#{contents.size} files, extension embedded)"
ensure
  FileUtils.rm_rf(staged_extension)
end
