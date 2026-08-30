# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_github_stars.ts

Evals.define_task("extract_github_stars") do |t|
  t.page.goto("https://github.com/facebook/react")

  result = t.stagehand.extract(
    "Extract the number of stars for the project",
    schema: {
      "type" => "object",
      "properties" => {
        "stars" => { "type" => "number", "description" => "the number of stars for the project" },
      },
      "required" => ["stars"],
      "additionalProperties" => false,
    },
  )
  stars = result.data["stars"]

  expected_stars_string = t.page.locator("#repo-stars-counter-star").first.inner_html

  expected_stars =
    if expected_stars_string.downcase.end_with?("k")
      expected_stars_string[0...-1].to_f * 1000
    else
      expected_stars_string.to_f
    end

  tolerance = 1000
  is_within_tolerance = (stars - expected_stars).abs <= tolerance

  { _success: is_within_tolerance, stars: stars }
end
