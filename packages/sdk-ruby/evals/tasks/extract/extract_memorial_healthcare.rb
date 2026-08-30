# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_memorial_healthcare.ts

Evals.define_task("extract_memorial_healthcare") do |t|
  # Inline port of packages/evals/utils.ts normalizeString + compareStrings
  # (Jaro-Winkler similarity); the Ruby harness has no shared string-scoring helper.
  normalize_string = lambda do |str|
    str.downcase
       .gsub(/\s+/, " ")
       .gsub(/[;\/#!$%^&*:{}=\-_`~()]/, "")
       .gsub(/\s*,\s*/, ", ")
       .strip
  end

  jaro_winkler = lambda do |s1, s2|
    next 1.0 if s1 == s2
    len1 = s1.length
    len2 = s2.length
    next 0.0 if len1.zero? || len2.zero?

    match_distance = [([len1, len2].max / 2) - 1, 0].max
    s1_matches = Array.new(len1, false)
    s2_matches = Array.new(len2, false)
    matches = 0
    len1.times do |i|
      low = [0, i - match_distance].max
      high = [i + match_distance, len2 - 1].min
      (low..high).each do |j|
        next if s2_matches[j] || s1[i] != s2[j]
        s1_matches[i] = true
        s2_matches[j] = true
        matches += 1
        break
      end
    end
    next 0.0 if matches.zero?

    transpositions = 0
    k = 0
    len1.times do |i|
      next unless s1_matches[i]
      k += 1 until s2_matches[k]
      transpositions += 1 if s1[i] != s2[k]
      k += 1
    end

    jaro = ((matches.to_f / len1) + (matches.to_f / len2) +
            ((matches - (transpositions / 2.0)) / matches)) / 3.0
    prefix = 0
    [len1, len2, 4].min.times do |i|
      break if s1[i] != s2[i]
      prefix += 1
    end
    jaro + (prefix * 0.1 * (1 - jaro))
  end

  compare_strings = lambda do |actual, expected, threshold|
    similarity = jaro_winkler.call(normalize_string.call(actual), normalize_string.call(expected))
    { similarity: similarity, meets_threshold: similarity >= threshold }
  end

  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/mycmh/")

  result = t.stagehand.extract(
    "extract a list of the first three healthcare centers on this page, " \
    "with their name, full address, and phone number",
    schema: {
      "type" => "object",
      "properties" => {
        "health_centers" => {
          "type" => "array",
          "items" => {
            "type" => "object",
            "properties" => {
              "name" => { "type" => "string" },
              "phone_number" => { "type" => "string" },
              "address" => { "type" => "string" },
            },
            "required" => %w[name phone_number address],
            "additionalProperties" => false,
          },
        },
      },
      "required" => ["health_centers"],
      "additionalProperties" => false,
    },
  )

  health_centers = result.data["health_centers"]

  expected_length = 3
  similarity_threshold = 0.85

  expected_first_item = {
    "name" => "Community Memorial Breast Center",
    "phone_number" => "805-948-5093",
    "address" => "168 North Brent Street, Suite 401, Ventura, CA 93003",
  }

  expected_last_item = {
    "name" => "Community Memorial Dermatology and Mohs Surgery",
    "phone_number" => "805-948-6920",
    "address" => "168 North Brent Street, Suite 403, Ventura, CA 93003",
  }

  if health_centers.length != expected_length
    t.logger.error("Incorrect number of health centers extracted",
                   { expected: expected_length, actual: health_centers.length })
    next { _success: false, error: "Incorrect number of health centers extracted" }
  end

  validate_health_center = lambda do |center|
    fields_present =
      !center["name"].to_s.empty? && !center["phone_number"].to_s.empty? && !center["address"].to_s.empty?
    next center if fields_present

    t.logger.error("Invalid health center data", { center: center })
    nil
  end

  valid_health_centers = health_centers.map { |center| validate_health_center.call(center) }.compact

  if valid_health_centers.length < expected_length
    next { _success: false, error: "One or more health centers have missing fields" }
  end

  compare_field = lambda do |actual, expected, field_name|
    comparison = compare_strings.call(actual, expected, similarity_threshold)

    unless comparison[:meets_threshold]
      t.logger.error("Field \"#{field_name}\" does not meet similarity threshold",
                     {
                       field: field_name,
                       similarity: format("%.2f", comparison[:similarity]),
                       expected: expected,
                       actual: actual,
                     })
    end

    comparison[:meets_threshold]
  end

  compare_item = lambda do |actual, expected, position|
    %w[name phone_number address].all? do |field|
      compare_field.call(actual[field], expected[field], "#{position} #{field}")
    end
  end

  first_item_matches = compare_item.call(valid_health_centers.first, expected_first_item, "First")
  last_item_matches = compare_item.call(valid_health_centers.last, expected_last_item, "Last")

  if !first_item_matches || !last_item_matches
    next { _success: false, error: "One or more fields do not match expected values" }
  end

  { _success: true }
end
