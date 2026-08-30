# frozen_string_literal: true

# Port of packages/evals/tasks/bench/extract/extract_jfk_links.ts

Evals.define_task("extract_jfk_links") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/jfk/")

  result = t.stagehand.extract(
    "extract all the record file name and their corresponding links",
    schema: {
      "type" => "object",
      "properties" => {
        "records" => {
          "type" => "array",
          "items" => {
            "type" => "object",
            "properties" => {
              "file_name" => { "type" => "string", "description" => "the file name of the record" },
              "link" => { "type" => "string", "format" => "uri" },
            },
            "required" => %w[file_name link],
            "additionalProperties" => false,
          },
        },
      },
      "required" => ["records"],
      "additionalProperties" => false,
    },
  )

  # The list of records we expect to see
  expected_records = [
    {
      "file_name" => "104-10003-10041.pdf",
      "link" => "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10003-10041.pdf",
    },
    {
      "file_name" => "104-10004-10143 (C06932208).pdf",
      "link" => "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10004-10143%20(C06932208).pdf",
    },
    {
      "file_name" => "104-10004-10143.pdf",
      "link" => "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10004-10143.pdf",
    },
    {
      "file_name" => "104-10004-10156.pdf",
      "link" => "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10004-10156.pdf",
    },
    {
      "file_name" => "104-10004-10213.pdf",
      "link" => "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10004-10213.pdf",
    },
    {
      "file_name" => "104-10005-10321.pdf",
      "link" => "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10005-10321.pdf",
    },
    {
      "file_name" => "104-10006-10247.pdf",
      "link" => "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10006-10247.pdf",
    },
    {
      "file_name" => "104-10007-10345.pdf",
      "link" => "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10007-10345.pdf",
    },
    {
      "file_name" => "104-10009-10021.pdf",
      "link" => "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10009-10021.pdf",
    },
    {
      "file_name" => "104-10009-10222.pdf",
      "link" => "https://www.archives.gov/files/research/jfk/releases/2025/0318/104-10009-10222.pdf",
    },
  ]

  extracted_records = result.data["records"]

  # Check that all expected records exist in the extraction
  missing_records = expected_records.reject do |expected|
    extracted_records.any? do |r|
      r["file_name"] == expected["file_name"] && r["link"] == expected["link"]
    end
  end

  # Check that the extraction array is exactly length 10
  if extracted_records.length != 10
    next {
      _success: false,
      reason: "Extraction has #{extracted_records.length} records (expected 10).",
    }
  end

  unless missing_records.empty?
    next {
      _success: false,
      reason: "Missing one or more expected records.",
      missingRecords: missing_records,
      extractedRecords: extracted_records,
    }
  end

  # If we reach here, the number of records is correct, and all are present
  { _success: true }
end
