# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_hamilton_weather.ts

Evals.define_task("extract_hamilton_weather") do |t|
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

  meets_threshold = lambda do |actual, expected, threshold|
    jaro_winkler.call(normalize_string.call(actual), normalize_string.call(expected)) >= threshold
  end

  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/hamilton-weather/")
  # The locator engine prefix is required for XPath selectors.
  locator = t.page.locator(
    "xpath=/html/body[1]/div[5]/main[1]/article[1]/div[6]/div[2]/div[1]/table[1]",
  )

  result = t.stagehand.extract(
    "extract the weather data for Sun, Feb 23 at 11PM",
    schema: {
      "type" => "object",
      "properties" => {
        "temperature" => { "type" => "string" },
        "weather_description" => { "type" => "string" },
        "wind" => { "type" => "string" },
        "humidity" => { "type" => "string" },
        "barometer" => { "type" => "string" },
        "visibility" => { "type" => "string" },
      },
      "required" => %w[temperature weather_description wind humidity barometer visibility],
      "additionalProperties" => false,
    },
    locator: locator,
  )
  weather_data = result.data

  # Define the expected weather data
  expected_weather_data = {
    "temperature" => "27 °F",
    "weather_description" => "Light snow. Overcast.",
    "wind" => "6 mph",
    "humidity" => "93%",
    "barometer" => "30.07 \"Hg",
    "visibility" => "10 mi",
  }

  # Check that every field matches the expected value
  is_weather_correct =
    expected_weather_data.keys.all? do |field|
      meets_threshold.call(weather_data[field], expected_weather_data[field], 0.9)
    end

  { _success: is_weather_correct, weatherData: weather_data }
end
