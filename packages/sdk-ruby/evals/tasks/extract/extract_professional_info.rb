# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_professional_info.ts

Evals.define_task("extract_professional_info") do |t|
  # Port of the evals framework's normalizeString helper.
  normalize = lambda do |str|
    str.downcase
       .gsub(/\s+/, " ")
       .gsub(/[;\/#!$%^&*:{}=\-_`~()]/, "")
       .gsub(/\s*,\s*/, ", ")
       .strip
  end

  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/professional-info/")

  result = t.stagehand.extract(
    "Extract the list of Practices, phone number, and fax number of the professional.",
    schema: {
      "type" => "object",
      "properties" => {
        "practices" => { "type" => "array", "items" => { "type" => "string" } },
        "phone" => { "type" => "string" },
        "fax" => { "type" => "string" },
      },
      "required" => %w[practices phone fax],
      "additionalProperties" => false,
    },
  )

  practices = result.data["practices"]
  phone = result.data["phone"]
  fax = result.data["fax"]

  expected = {
    "practices" => [
      "Restructuring",
      "Finance",
      "Hybrid Capital & Special Situations",
      "Private Credit",
    ],
    "phone" => "+1-212-373-3262",
    "fax" => "+1-212-492-0262",
  }

  if practices.map { |p| normalize.call(p) } != expected["practices"].map { |p| normalize.call(p) }
    t.logger.error("Practices extracted do not match expected",
                   { expected: expected["practices"], actual: practices })
    next { _success: false, error: "Practices extracted do not match expected" }
  end

  if normalize.call(phone) != normalize.call(expected["phone"])
    t.logger.error("Phone number extracted does not match expected",
                   { expected: normalize.call(expected["phone"]), actual: normalize.call(phone) })
    next { _success: false, error: "Phone number extracted does not match expected" }
  end

  if normalize.call(fax) != normalize.call(expected["fax"])
    t.logger.error("Fax number extracted does not match expected",
                   { expected: normalize.call(expected["fax"]), actual: normalize.call(fax) })
    next { _success: false, error: "Fax number extracted does not match expected" }
  end

  { _success: true }
end
