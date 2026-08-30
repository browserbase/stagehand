# frozen_string_literal: true

# Port of packages/evals/tasks/bench/observe/observe_main_frame_element_ids.ts

Evals.define_task("observe_main_frame_element_ids") do |t|
  # Keep backend node IDs large enough to exercise Anthropic's bare-id failure mode.
  filler = (0...2500).map { |index| "<span hidden data-filler=\"#{index}\">filler #{index}</span>" }.join

  cases = [
    { instruction: "Find the Target Checkout button", marker: "checkout", label: "Target Checkout" },
    { instruction: "Find the Pricing Plans button", marker: "pricing", label: "Pricing Plans" },
    { instruction: "Find the Request Demo button", marker: "demo", label: "Request Demo" },
  ]

  buttons = cases.map do |c|
    <<~HTML
      #{filler}
      <section>
        <button onclick="document.body.dataset.clicked = '#{c[:marker]}'">
          #{c[:label]}
        </button>
      </section>
    HTML
  end.join

  html = <<~HTML
    <!doctype html>
    <html>
      <body>
        <main>#{buttons}</main>
      </body>
    </html>
  HTML

  # Equivalent of JS encodeURIComponent (escape everything outside its unreserved set).
  encoded = html.gsub(/[^A-Za-z0-9\-_.!~*'()]/) { |c| c.each_byte.map { |b| format("%%%02X", b) }.join }

  t.page.goto("data:text/html,#{encoded}")

  results = []
  failure = nil

  cases.each do |test_case|
    t.page.evaluate("(() => { delete document.body.dataset.clicked; })()")

    observations = t.stagehand.observe(test_case[:instruction]).data
    if observations.empty?
      failure = {
        _success: false,
        failedInstruction: test_case[:instruction],
        reason: "observe returned no elements",
        results: results,
      }
      break
    end

    t.stagehand.act(observations[0])
    clicked = t.page.evaluate("(() => document.body.dataset.clicked)()")
    results << {
      instruction: test_case[:instruction],
      clicked: clicked,
      observations: observations.map(&:to_wire),
    }

    if clicked != test_case[:marker]
      failure = {
        _success: false,
        failedInstruction: test_case[:instruction],
        expectedClicked: test_case[:marker],
        clicked: clicked,
        results: results,
      }
      break
    end
  end

  failure || { _success: true, results: results }
end
