import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { Page } from "playwright";

/** Capture the rendered observation surface, not the application's behavior. */
export async function captureObservation(page: Page): Promise<string> {
  return page.evaluate(() => {
    const elements = Array.from(document.querySelectorAll("*"));
    if (elements.some((element) => element.shadowRoot || element.matches("iframe, frame"))) {
      throw new Error("Observation tasks do not support frames or shadow DOM");
    }
    const clone = document.documentElement.cloneNode(true) as HTMLElement;
    const copies = [clone, ...Array.from(clone.querySelectorAll("*"))];
    for (const [index, source] of elements.entries()) {
      const target = copies[index];
      // Inline the styles from this session; never fetch assets a second time.
      const computed = getComputedStyle(source);
      const styles = Array.from(computed)
        .filter((name) => !computed.getPropertyValue(name).includes("url("))
        .map((name) => `${name}: ${computed.getPropertyValue(name)};`)
        .join(" ");
      target.setAttribute("style", styles);
      for (const attribute of Array.from(target.attributes)) {
        if (
          /^on/i.test(attribute.name) ||
          ["src", "srcset", "poster", "background", "ping", "autofocus"].includes(attribute.name)
        ) {
          target.removeAttribute(attribute.name);
        }
      }
      if (source instanceof HTMLInputElement) {
        if (source.type === "password" || source.type === "file") {
          target.removeAttribute("value");
        } else {
          target.setAttribute("value", source.value);
        }
        target.toggleAttribute("checked", source.checked);
      } else if (source instanceof HTMLTextAreaElement) {
        target.textContent = source.value;
      } else if (source instanceof HTMLOptionElement) {
        target.toggleAttribute("selected", source.selected);
      }
      // Keep link identity useful for extraction, resolving against the source URL.
      if (source instanceof HTMLAnchorElement && source.hasAttribute("href")) {
        target.setAttribute("href", source.href);
      }
    }
    clone
      .querySelectorAll("script, style, link, base, meta, object, embed")
      .forEach((node) => node.remove());
    const head = clone.querySelector("head")!;
    const policy = document.createElement("meta");
    policy.httpEquiv = "Content-Security-Policy";
    policy.content =
      "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'; frame-src 'none'";
    head.prepend(policy);
    const charset = document.createElement("meta");
    charset.setAttribute("charset", "utf-8");
    head.prepend(charset);
    return "<!doctype html>\n" + clone.outerHTML;
  });
}

export async function writeObservationTask(page: Page, output: string): Promise<void> {
  const html = await captureObservation(page);
  const directory = resolve(output);
  // Exclusive creation prevents accidentally replacing a reviewed task.
  await mkdir(directory);
  try {
    await writeFile(resolve(directory, "index.html"), html);
    await writeFile(
      resolve(directory, "manifest.json"),
      JSON.stringify(
        {
          version: 1,
          kind: "observation",
          sourceUrl: page.url(),
          recordedAt: new Date().toISOString(),
          viewport: page.viewportSize(),
          limitations: [
            "No application scripts or remote assets",
            "No post-click behavior",
            "No frames or shadow DOM",
            "No pseudo-element content or canvas pixels",
          ],
        },
        null,
        2,
      ) + "\n",
    );
  } catch (error) {
    await rm(directory, { recursive: true, force: true });
    throw error;
  }
}
