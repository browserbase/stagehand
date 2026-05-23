/**
 * stealth.js — Anti-bot-detection patches.
 *
 * Injected at document_start in the MAIN world (see manifest.json).
 * Must run before any page script to reliably override browser fingerprints.
 */

(function () {
  "use strict";

  // 1. navigator.webdriver → false (real Chrome returns false, not undefined)
  try {
    Object.defineProperty(navigator, "webdriver", {
      get: () => false,
      configurable: true,
    });
  } catch (_) {}

  // 2. navigator.languages — ensure realistic value
  try {
    Object.defineProperty(navigator, "languages", {
      get: () => ["en-US", "en"],
      configurable: true,
    });
  } catch (_) {}

  // 3. navigator.plugins — fake standard Chrome plugins
  try {
    const fakePlugins = [
      {
        name: "Chrome PDF Plugin",
        filename: "internal-pdf-viewer",
        description: "Portable Document Format",
      },
      {
        name: "Chrome PDF Viewer",
        filename: "mhjfbmdgcfjbbpaeojofohoefgiehjai",
        description: "",
      },
      {
        name: "Native Client",
        filename: "internal-nacl-plugin",
        description: "",
      },
    ];

    const pluginArray = Object.create(PluginArray.prototype);
    fakePlugins.forEach((p, i) => {
      const plugin = Object.create(Plugin.prototype);
      Object.defineProperties(plugin, {
        name: { get: () => p.name },
        filename: { get: () => p.filename },
        description: { get: () => p.description },
        length: { get: () => 0 },
      });
      Object.defineProperty(pluginArray, i, {
        get: () => plugin,
        enumerable: true,
      });
    });
    Object.defineProperty(pluginArray, "length", {
      get: () => fakePlugins.length,
    });
    pluginArray.item = (i) => pluginArray[i] || null;
    pluginArray.namedItem = (name) => {
      const idx = fakePlugins.findIndex((p) => p.name === name);
      return idx >= 0 ? pluginArray[idx] : null;
    };
    pluginArray.refresh = () => {};
    pluginArray[Symbol.iterator] = function* () {
      for (let i = 0; i < fakePlugins.length; i++) yield pluginArray[i];
    };

    Object.defineProperty(navigator, "plugins", {
      get: () => pluginArray,
      configurable: true,
    });
  } catch (_) {}

  // 4. navigator.mimeTypes — match the fake plugins
  try {
    const fakeMimeTypes = [
      {
        type: "application/pdf",
        suffixes: "pdf",
        description: "Portable Document Format",
      },
      {
        type: "application/x-google-chrome-pdf",
        suffixes: "pdf",
        description: "Portable Document Format",
      },
    ];

    const mimeTypeArray = Object.create(MimeTypeArray.prototype);
    fakeMimeTypes.forEach((m, i) => {
      const mimeType = Object.create(MimeType.prototype);
      Object.defineProperties(mimeType, {
        type: { get: () => m.type },
        suffixes: { get: () => m.suffixes },
        description: { get: () => m.description },
        enabledPlugin: { get: () => null },
      });
      Object.defineProperty(mimeTypeArray, i, {
        get: () => mimeType,
        enumerable: true,
      });
    });
    Object.defineProperty(mimeTypeArray, "length", {
      get: () => fakeMimeTypes.length,
    });
    mimeTypeArray.item = (i) => mimeTypeArray[i] || null;
    mimeTypeArray.namedItem = (name) => {
      const idx = fakeMimeTypes.findIndex((m) => m.type === name);
      return idx >= 0 ? mimeTypeArray[idx] : null;
    };
    mimeTypeArray[Symbol.iterator] = function* () {
      for (let i = 0; i < fakeMimeTypes.length; i++) yield mimeTypeArray[i];
    };

    Object.defineProperty(navigator, "mimeTypes", {
      get: () => mimeTypeArray,
      configurable: true,
    });
  } catch (_) {}

  // 5. WebGL renderer/vendor spoofing
  try {
    const WEBGL_VENDOR = "Google Inc. (Google)";
    const WEBGL_RENDERER =
      "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)";

    const originalGetParameter = WebGLRenderingContext.prototype.getParameter;
    WebGLRenderingContext.prototype.getParameter = function (param) {
      if (param === 0x9245) return WEBGL_VENDOR;
      if (param === 0x9246) return WEBGL_RENDERER;
      return originalGetParameter.call(this, param);
    };

    if (typeof WebGL2RenderingContext !== "undefined") {
      const originalGetParameter2 =
        WebGL2RenderingContext.prototype.getParameter;
      WebGL2RenderingContext.prototype.getParameter = function (param) {
        if (param === 0x9245) return WEBGL_VENDOR;
        if (param === 0x9246) return WEBGL_RENDERER;
        return originalGetParameter2.call(this, param);
      };
    }
  } catch (_) {}

  // 6. Permissions API — notifications should return 'prompt', not 'denied'
  try {
    const originalQuery = Permissions.prototype.query;
    Permissions.prototype.query = function (descriptor) {
      if (descriptor && descriptor.name === "notifications") {
        return Promise.resolve({ state: "prompt", onchange: null });
      }
      return originalQuery.call(this, descriptor);
    };
  } catch (_) {}

  try {
    Object.defineProperty(Notification, "permission", {
      get: () => "default",
      configurable: true,
    });
  } catch (_) {}

  // 7. window.chrome.runtime — ensure it exists
  try {
    if (!window.chrome) {
      window.chrome = {};
    }
    if (!window.chrome.runtime) {
      window.chrome.runtime = {
        connect: function () {
          return {};
        },
        sendMessage: function () {},
      };
    }
  } catch (_) {}

  // 8. Remove Chromedriver artifacts
  try {
    for (const prop of Object.getOwnPropertyNames(document)) {
      if (prop.startsWith("$cdc_") || prop.startsWith("cdc_")) {
        delete document[prop];
      }
    }
  } catch (_) {}

  // 9. navigator.hardwareConcurrency — ensure a reasonable value
  try {
    if (navigator.hardwareConcurrency < 4) {
      Object.defineProperty(navigator, "hardwareConcurrency", {
        get: () => 8,
        configurable: true,
      });
    }
  } catch (_) {}

  // 10. navigator.deviceMemory — ensure a reasonable value
  try {
    if (!navigator.deviceMemory || navigator.deviceMemory < 4) {
      Object.defineProperty(navigator, "deviceMemory", {
        get: () => 8,
        configurable: true,
      });
    }
  } catch (_) {}

  // 11. Patch iframe contentWindow.navigator to match parent
  try {
    const originalCreateElement = document.createElement.bind(document);
    document.createElement = function (tagName, options) {
      const el = originalCreateElement(tagName, options);
      if (tagName.toLowerCase() === "iframe") {
        el.addEventListener("load", function () {
          try {
            if (el.contentWindow && el.contentWindow.navigator) {
              Object.defineProperty(el.contentWindow.navigator, "webdriver", {
                get: () => false,
                configurable: true,
              });
            }
          } catch (_) {}
        });
      }
      return el;
    };
  } catch (_) {}
})();
