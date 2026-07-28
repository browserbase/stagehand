import { getCoreFixtureBaseUrl } from "./server.js";

export const dropdownHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Core Dropdown Fixture</title>
    <style>
      body { font-family: sans-serif; margin: 0; padding: 24px; }
      #app { max-width: 640px; }
      #menu { display: none; margin-top: 8px; padding: 8px 16px; border: 1px solid #ccc; }
      #menu.open { display: block; }
      #hover-status { margin-top: 12px; color: #444; }
      input { margin-top: 16px; width: 240px; padding: 8px; }
    </style>
  </head>
  <body>
    <div id="app">
      <div>
        <button id="dropdown-button" type="button" aria-expanded="false">Open Menu</button>
        <ul id="menu" aria-hidden="true">
          <li>Alpha</li>
          <li>Beta</li>
          <li>Gamma</li>
        </ul>
      </div>
      <p id="hover-status">idle</p>
      <input id="fixture-input" type="text" value="" />
    </div>
    <script>
      const button = document.getElementById("dropdown-button");
      const menu = document.getElementById("menu");
      const hoverStatus = document.getElementById("hover-status");
      button.addEventListener("mouseenter", () => {
        hoverStatus.textContent = "hovered";
      });
      button.addEventListener("mouseleave", () => {
        hoverStatus.textContent = "idle";
      });
      button.addEventListener("click", () => {
        const open = menu.classList.toggle("open");
        button.setAttribute("aria-expanded", open ? "true" : "false");
        menu.setAttribute("aria-hidden", open ? "false" : "true");
      });
    </script>
  </body>
</html>`;

export const resistorHtml = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Core Resistor Fixture</title>
    <style>
      body { font-family: sans-serif; margin: 0; }
      header { position: sticky; top: 0; background: #fff; padding: 16px; border-bottom: 1px solid #ddd; }
      main { padding: 24px; }
      .spacer { height: 2400px; background: linear-gradient(180deg, #fafafa, #e9e9e9); }
    </style>
  </head>
  <body>
    <header>Resistor Reference</header>
    <main>
      <h1>Resistor Color Codes</h1>
      <p>Scroll to exercise viewport movement.</p>
      <div class="spacer"></div>
    </main>
  </body>
</html>`;

export const coreFixtureRoutes = [
  { path: "/dropdown", html: dropdownHtml },
  { path: "/resistor", html: resistorHtml },
] as const;

function htmlFixtureUrl(name: string, html: string): string {
  return `data:text/html;fixture=${name};base64,${Buffer.from(html, "utf8").toString("base64")}`;
}

function fixtureUrl(path: string, fallback: string): string {
  const baseUrl = getCoreFixtureBaseUrl();
  return baseUrl ? `${baseUrl}${path}` : fallback;
}

const dropdownSelectors = {
  button: "#dropdown-button",
  menu: "#menu",
  hoverStatus: "#hover-status",
  input: "#fixture-input",
} as const;

const resistorSelectors = {
  header: "header",
  heading: "h1",
} as const;

export const dropdownFixture = {
  get url() {
    return fixtureUrl("/dropdown", htmlFixtureUrl("dropdown", dropdownHtml));
  },
  selectors: dropdownSelectors,
  targets: {
    button: { kind: "selector", value: dropdownSelectors.button },
    menu: { kind: "selector", value: dropdownSelectors.menu },
    hoverStatus: { kind: "selector", value: dropdownSelectors.hoverStatus },
    input: { kind: "selector", value: dropdownSelectors.input },
  } as const,
  expected: {
    title: "Core Dropdown Fixture",
    buttonText: "Open Menu",
    hoverStatus: "hovered",
  },
};

export const resistorFixture = {
  get url() {
    return fixtureUrl("/resistor", htmlFixtureUrl("resistor", resistorHtml));
  },
  selectors: resistorSelectors,
  expected: {
    title: "Core Resistor Fixture",
    headingText: "Resistor Color Codes",
  },
};
