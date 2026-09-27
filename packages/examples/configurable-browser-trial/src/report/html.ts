import { OUTCOME_LABELS } from "../scorecard.js";
import type { Outcome, Scorecard, SiteScore } from "../types.js";

// Official Browserbase brand palette.
const C = {
  primary: "#F03603",
  black: "#100D0D",
  gray: "#514F4F",
  white: "#F9F6F4",
  blue: "#4DA9E4",
  yellow: "#F4BA41",
  green: "#90C94D",
  border: "#edebeb",
};

const OUTCOME_COLOR: Record<Outcome, string> = {
  pass: C.green,
  blocked_antibot: C.primary,
  captcha_unsolved: C.primary,
  account_wall: C.yellow,
  timeout: C.yellow,
  error: C.gray,
};

const pct = (n: number) => `${Math.round(n * 100)}%`;
const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function donut(rate: number, met: boolean): string {
  const color = met ? C.green : rate >= 0.5 ? C.yellow : C.primary;
  const deg = Math.round(rate * 360);
  return `<div class="donut" style="background:conic-gradient(${color} ${deg}deg, ${C.border} 0)">
    <div class="donut-hole"><span style="color:${color}">${pct(rate)}</span></div>
  </div>`;
}

function featureChips(s: Scorecard): string {
  const f = s.features;
  const chip = (label: string, on: boolean) =>
    `<span class="chip ${on ? "on" : "off"}">${on ? "✓" : "✕"} ${label}</span>`;
  return [
    chip("Advanced Stealth", f.advancedStealth),
    chip(`Residential Proxies${f.proxyCountry ? ` · ${f.proxyCountry}` : ""}`, f.proxies),
    chip("CAPTCHA Solving", f.solveCaptchas),
    chip("Ad Blocking", f.blockAds),
  ].join("");
}

function siteCard(site: SiteScore): string {
  const rows = site.results
    .map((r) => {
      const color = OUTCOME_COLOR[r.outcome];
      const replay = r.replayUrl
        ? `<a href="${r.replayUrl}" target="_blank">▶ replay</a>`
        : "<span class='muted'>—</span>";
      return `<tr>
        <td class="num">${r.attempt}</td>
        <td><span class="dot" style="background:${color}"></span>${OUTCOME_LABELS[r.outcome]}</td>
        <td class="reason">${esc(r.reason)}</td>
        <td>${replay}</td>
      </tr>`;
    })
    .join("");

  const seen = site.detected.length ? site.detected.join(", ") : (site.antibot ?? "—");
  return `<div class="card">
    <div class="card-head">
      ${donut(site.successRate, site.met)}
      <div class="card-meta">
        <h3>${esc(site.name)} ${site.met ? `<span class="badge met">TARGET MET</span>` : `<span class="badge miss">BELOW TARGET</span>`}</h3>
        <div class="muted">${esc(site.task)}</div>
        <div class="kv"><b>${site.passes}/${site.attempts}</b> passed · target ${pct(site.target)} · anti-bot: <b>${esc(seen)}</b></div>
        <a class="muted url" href="${esc(site.url)}" target="_blank">${esc(site.url)}</a>
      </div>
    </div>
    <table class="attempts">
      <thead><tr><th>#</th><th>Outcome</th><th>Reason</th><th>Session</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  </div>`;
}

/** A clean, on-brand, single-file report a customer can forward to their CTO. */
export function renderHtml(s: Scorecard): string {
  const title = s.customer ? `${esc(s.customer)} — ${esc(s.name)}` : esc(s.name);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${title}</title>
<style>
  :root { --primary:${C.primary}; --black:${C.black}; --gray:${C.gray}; --white:${C.white}; --border:${C.border}; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--white); color:var(--black);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Helvetica,Arial,sans-serif; line-height:1.5; }
  .wrap { max-width:980px; margin:0 auto; padding:48px 24px 80px; }
  header { border-bottom:3px solid var(--primary); padding-bottom:20px; margin-bottom:28px; }
  .brand { color:var(--primary); font-weight:800; letter-spacing:.06em; text-transform:uppercase; font-size:13px; }
  h1 { font-size:30px; margin:6px 0 4px; }
  h2 { font-size:18px; margin:36px 0 14px; }
  .sub { color:var(--gray); font-size:14px; }
  .chips { margin-top:14px; display:flex; flex-wrap:wrap; gap:8px; }
  .chip { font-size:12px; padding:5px 10px; border-radius:999px; border:1px solid var(--border); font-weight:600; }
  .chip.on { background:rgba(144,201,77,.16); color:#3f6b18; border-color:rgba(144,201,77,.5); }
  .chip.off { background:#f3f1f0; color:var(--gray); }
  .summary { display:flex; gap:16px; flex-wrap:wrap; margin:24px 0 8px; }
  .stat { flex:1; min-width:170px; background:#fff; border:1px solid var(--border); border-radius:14px; padding:18px 20px; }
  .stat .big { font-size:34px; font-weight:800; }
  .stat .lbl { color:var(--gray); font-size:13px; text-transform:uppercase; letter-spacing:.04em; }
  .card { background:#fff; border:1px solid var(--border); border-radius:16px; padding:20px; margin:16px 0; }
  .card-head { display:flex; gap:18px; align-items:center; }
  .card-meta h3 { margin:0 0 4px; font-size:18px; display:flex; align-items:center; gap:10px; }
  .card-meta .kv { font-size:13px; color:var(--gray); margin-top:6px; }
  .url { font-size:12px; display:inline-block; margin-top:6px; word-break:break-all; }
  .muted { color:var(--gray); text-decoration:none; }
  .badge { font-size:11px; font-weight:700; padding:2px 8px; border-radius:6px; }
  .badge.met { background:rgba(144,201,77,.2); color:#3f6b18; }
  .badge.miss { background:rgba(240,54,3,.12); color:var(--primary); }
  .donut { width:84px; height:84px; border-radius:50%; flex:0 0 84px; display:flex; align-items:center; justify-content:center; }
  .donut-hole { width:60px; height:60px; background:#fff; border-radius:50%; display:flex; align-items:center; justify-content:center; font-weight:800; font-size:16px; }
  table { width:100%; border-collapse:collapse; margin-top:14px; font-size:13px; }
  th { text-align:left; color:var(--gray); font-weight:600; border-bottom:1px solid var(--border); padding:8px 10px; }
  td { padding:8px 10px; border-bottom:1px solid #f4f2f1; vertical-align:top; }
  td.num { color:var(--gray); width:30px; }
  td.reason { color:var(--gray); }
  .dot { display:inline-block; width:9px; height:9px; border-radius:50%; margin-right:8px; }
  a { color:var(--primary); }
  footer { margin-top:48px; color:var(--gray); font-size:12px; border-top:1px solid var(--border); padding-top:16px; }
</style>
</head>
<body>
  <div class="wrap">
    <header>
      <div class="brand">Browserbase · Verified Trial Scorecard</div>
      <h1>${title}</h1>
      <div class="sub">${esc(s.startedAt)} → ${esc(s.finishedAt)} · ${esc(s.region)} · ${esc(s.model)}</div>
      <div class="chips">${featureChips(s)}</div>
    </header>

    <section class="summary">
      <div class="stat"><div class="big" style="color:${s.sitesMet === s.siteCount ? C.green : C.primary}">${s.sitesMet}/${s.siteCount}</div><div class="lbl">Sites hit target</div></div>
      <div class="stat"><div class="big">${pct(s.overallRate)}</div><div class="lbl">Overall success</div></div>
      <div class="stat"><div class="big">${s.totalPasses}/${s.totalAttempts}</div><div class="lbl">Attempts passed</div></div>
    </section>

    <h2>Per-site results</h2>
    ${s.sites.map(siteCard).join("\n")}

    <footer>
      Generated by <b>bbpoc</b> — the Browserbase verified-trial harness. Each session above is a real, replayable cloud-browser run.
    </footer>
  </div>
</body>
</html>`;
}
