# frozen_string_literal: true

# Port of packages/evals/tasks/bench/act/iframe_form_filling.ts

Evals.define_task("iframe_form_filling") do |t|
  t.page.goto("https://browserbase.github.io/stagehand-eval-sites/sites/iframe-form-filling/")

  t.stagehand.act("type 'nunya' into the 'first name' field")
  t.stagehand.act("type 'business' into the 'last name' field")
  t.stagehand.act("type 'test@email.com' into the 'email' field")
  t.stagehand.act("click 'phone' as the preferred contact method")
  t.stagehand.act("type 'yooooooooooooooo' into the message box")

  # The form lives in a cross-origin iframe, so main-frame evaluation
  # cannot access its contentDocument. V4 locators resolve `>>` iframe
  # hops server-side and can inspect the OOPIF directly.
  first_name_value = t.page.locator('iframe >> input[placeholder="Jane"]').input_value

  last_name_value = t.page.locator('iframe >> input[placeholder="Doe"]').input_value

  email_value = t.page.locator('iframe >> input[placeholder="jane@example.com"]').input_value

  contact_value = t.page
                   .locator("iframe >> xpath=/html/body/main/section[1]/form/fieldset/label[2]/input")
                   .checked?

  message_value = t.page.locator('iframe >> textarea[placeholder="Say hello…"]').input_value

  passed =
    first_name_value.downcase.strip == "nunya" &&
    last_name_value.downcase.strip == "business" &&
    email_value.downcase == "test@email.com" &&
    message_value.downcase == "yooooooooooooooo" &&
    contact_value

  { _success: passed }
end
