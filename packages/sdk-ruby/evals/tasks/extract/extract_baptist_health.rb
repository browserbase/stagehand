# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_baptist_health.ts

Evals.define_task("extract_baptist_health") do |t|
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

  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/baptist-health/")

  result = t.stagehand.extract(
    "Extract the address, phone number, and fax number of the healthcare location.",
    schema: {
      "type" => "object",
      "properties" => {
        "address" => { "type" => "string" },
        "phone" => { "type" => "string" },
        "fax" => { "type" => "string" },
      },
      "required" => %w[address phone fax],
      "additionalProperties" => false,
    },
  )

  address = result.data["address"]
  phone = result.data["phone"]
  fax = result.data["fax"]
  expected = {
    "address" => "2055 East South Blvd; Suite 908 Montgomery, AL 36116",
    "phone" => "334-747-2273",
    "fax" => "334-747-7501",
  }

  similarity_threshold = 0.85
  failed_fields = []

  compare_field = lambda do |actual_val, expected_val, field_name|
    comparison = compare_strings.call(actual_val, expected_val, similarity_threshold)

    unless comparison[:meets_threshold]
      failed_fields << {
        field: field_name,
        similarity: comparison[:similarity],
        expected: expected_val,
        actual: actual_val,
      }
      t.logger.error("#{field_name} extracted does not meet similarity threshold",
                     {
                       field: field_name,
                       similarity: format("%.2f", comparison[:similarity]),
                       expected: expected_val,
                       actual: actual_val,
                     })
    end

    comparison[:meets_threshold]
  end

  address_ok = compare_field.call(address, expected["address"], "Address")
  phone_ok = compare_field.call(phone, expected["phone"], "Phone number")
  fax_ok = compare_field.call(fax, expected["fax"], "Fax number")

  if !address_ok || !phone_ok || !fax_ok
    next {
      _success: false,
      error: "Some fields did not meet similarity threshold",
      failedFields: failed_fields,
    }
  end

  { _success: true }
end
