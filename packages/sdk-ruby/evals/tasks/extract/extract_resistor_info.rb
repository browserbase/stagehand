# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_resistor_info.ts

Evals.define_task("extract_resistor_info") do |t|
  # Port of the evals framework's normalizeString helper.
  normalize = lambda do |str|
    str.downcase
       .gsub(/\s+/, " ")
       .gsub(/[;\/#!$%^&*:{}=\-_`~()]/, "")
       .gsub(/\s*,\s*/, ", ")
       .strip
  end

  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/resistor/")

  result = t.stagehand.extract(
    "Extract the manufacturer standard lead time, tolerance percentage, resistance, and operating temperature range of the resistor.",
    schema: {
      "type" => "object",
      "properties" => {
        "manufacturer_standard_lead_time" => { "type" => "string" },
        "tolerance_percentage" => { "type" => "string" },
        "resistance" => { "type" => "string" },
        "operating_temperature_range" => { "type" => "string" },
      },
      "required" => %w[
        manufacturer_standard_lead_time
        tolerance_percentage
        resistance
        operating_temperature_range
      ],
      "additionalProperties" => false,
    },
  )

  manufacturer_standard_lead_time = result.data["manufacturer_standard_lead_time"]
  tolerance_percentage = result.data["tolerance_percentage"]
  resistance = result.data["resistance"]
  operating_temperature_range = result.data["operating_temperature_range"]

  expected = {
    "manufacturer_standard_lead_time" => "11 Weeks",
    "tolerance_percentage" => "±5",
    "resistance" => "330 ohms",
    "operating_temperature_range" => "-55°C ~ 155°C",
  }

  if normalize.call(manufacturer_standard_lead_time) != normalize.call(expected["manufacturer_standard_lead_time"])
    t.logger.error("manufacturer standard lead time extracted does not match expected",
                   { expected: normalize.call(expected["manufacturer_standard_lead_time"]),
                     actual: normalize.call(manufacturer_standard_lead_time) })
    next { _success: false, error: "manufacturer standard lead time extracted does not match expected" }
  end

  if normalize.call(tolerance_percentage) != normalize.call(expected["tolerance_percentage"])
    t.logger.error("Tolerance percentage extracted does not match expected",
                   { expected: normalize.call(expected["tolerance_percentage"]),
                     actual: normalize.call(tolerance_percentage) })
    next { _success: false, error: "Tolerance percentage extracted does not match expected" }
  end

  if normalize.call(resistance) != normalize.call(expected["resistance"])
    t.logger.error("resistance extracted does not match expected",
                   { expected: normalize.call(expected["resistance"]),
                     actual: normalize.call(resistance) })
    next { _success: false, error: "resistance extracted does not match expected" }
  end

  if normalize.call(operating_temperature_range) != normalize.call(expected["operating_temperature_range"])
    t.logger.error("Operating temperature range extracted does not match expected",
                   { expected: normalize.call(expected["operating_temperature_range"]),
                     actual: normalize.call(operating_temperature_range) })
    next { _success: false, error: "Operating temperature range extracted does not match expected" }
  end

  { _success: true }
end
