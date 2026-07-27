export const AGENT_INDICATOR_ID = "__stagehand_agent_indicator__";

let indicatorHost: HTMLDivElement | null = null;
let requestedActive = false;
let installScheduled = false;

const INDICATOR_STYLES = `
  :host {
    all: initial !important;
    position: fixed !important;
    inset: 0 !important;
    z-index: 2147483647 !important;
    pointer-events: none !important;
    user-select: none !important;
    contain: strict !important;
  }

  .aura {
    position: absolute;
    inset: 0;
    overflow: hidden;
    opacity: 0;
    transition: opacity 320ms cubic-bezier(.22, 1, .36, 1);
    box-shadow:
      inset 0 0 10px rgba(255, 198, 114, .9),
      inset 0 0 30px rgba(255, 69, 0, .58),
      inset 0 0 68px rgba(206, 31, 2, .24);
  }

  :host([data-active="true"]) .aura {
    opacity: 1;
    transition-duration: 0ms;
  }

  .rim {
    position: absolute;
    inset: 0;
    border: 2px solid rgba(255, 157, 91, .82);
    box-shadow:
      inset 0 0 3px rgba(255, 235, 209, .94),
      0 0 9px rgba(255, 69, 0, .72);
  }

  .wave {
    position: absolute;
    border-radius: 999px;
    background: radial-gradient(
      ellipse at center,
      rgba(255, 225, 163, .98) 0%,
      rgba(244, 186, 65, .92) 18%,
      rgba(255, 69, 0, .82) 36%,
      rgba(206, 31, 2, .43) 54%,
      transparent 74%
    );
    filter: blur(8px);
    opacity: .9;
    will-change: transform;
  }

  :host(:not([data-active="true"])) .wave {
    animation-play-state: paused !important;
    will-change: auto;
  }

  .wave.horizontal {
    left: -18vw;
    width: 50vw;
    height: 42px;
    animation: tide-x 5.6s cubic-bezier(.45, 0, .55, 1) infinite alternate;
  }

  .wave.vertical {
    top: -18vh;
    width: 42px;
    height: 50vh;
    animation: tide-y 6.2s cubic-bezier(.45, 0, .55, 1) infinite alternate;
  }

  .top { top: -20px; }
  .bottom { bottom: -20px; animation-delay: -2.8s !important; }
  .left { left: -20px; animation-delay: -1.55s !important; }
  .right { right: -20px; animation-delay: -4.65s !important; }

  @keyframes tide-x {
    0% { transform: translate3d(0, 0, 0) scaleX(.86); }
    48% { transform: translate3d(34vw, 0, 0) scaleX(1.08); }
    100% { transform: translate3d(68vw, 0, 0) scaleX(.9); }
  }

  @keyframes tide-y {
    0% { transform: translate3d(0, 0, 0) scaleY(.86); }
    52% { transform: translate3d(0, 34vh, 0) scaleY(1.08); }
    100% { transform: translate3d(0, 68vh, 0) scaleY(.9); }
  }

  @media (prefers-reduced-motion: reduce) {
    .wave { animation: none !important; }
    .wave.horizontal { left: 26vw; }
    .wave.vertical { top: 26vh; }
  }
`;

function scheduleInstall(): void {
  if (installScheduled) return;
  installScheduled = true;
  const retry = () => {
    installScheduled = false;
    installAgentIndicator();
  };
  document.addEventListener("DOMContentLoaded", retry, { once: true });
  globalThis.setTimeout(retry, 100);
}

export function installAgentIndicator(): boolean {
  try {
    if (indicatorHost?.isConnected) return true;
    const root = document.documentElement ?? document.body ?? document.head;
    if (!root) {
      scheduleInstall();
      return false;
    }

    const host = document.createElement("div");
    host.id = AGENT_INDICATOR_ID;
    host.setAttribute("aria-hidden", "true");
    host.dataset.active = String(requestedActive);

    const shadow = host.attachShadow({ mode: "closed" });
    const style = document.createElement("style");
    style.textContent = INDICATOR_STYLES;
    const aura = document.createElement("div");
    aura.className = "aura";
    aura.innerHTML = `
      <div class="rim"></div>
      <div class="wave horizontal top"></div>
      <div class="wave horizontal bottom"></div>
      <div class="wave vertical left"></div>
      <div class="wave vertical right"></div>
    `;
    shadow.append(style, aura);
    root.appendChild(host);
    indicatorHost = host;
    return true;
  } catch {
    return false;
  }
}

export function setAgentIndicatorActive(active: boolean): boolean {
  requestedActive = active;
  if (!active && !indicatorHost?.isConnected) return true;
  if (!installAgentIndicator() || !indicatorHost) return false;
  indicatorHost.dataset.active = String(active);
  return true;
}

export function isAgentIndicatorHost(element: Element): boolean {
  return element === indicatorHost;
}

export function isAgentIndicatorInstalled(): boolean {
  return indicatorHost?.isConnected === true;
}
