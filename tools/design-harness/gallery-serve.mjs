// One-URL design review: every window, current and proposed, dark and light, with an approve / changes / reject
// control and a comment box per window. Runs the design harness inside this process and proxies to it.
//   PORT=4300 node tools/design-harness/gallery-serve.mjs        -> http://127.0.0.1:4300/
// A window shows IMPROVED panes when a fixture "<name>-proposed" exists. The page is rebuilt on every request.
// Reviews are saved to ~/.cache/sde-design-harness/review.json ({ <window>: { status, comment, at } }), so an
// agent can read what was approved and what was asked for.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const DIR = path.join(ROOT, "tools/design-harness/fixtures");
const PORT = Number(process.env.PORT ?? 4300), INNER = PORT + 1;
const REVIEW = path.join(os.homedir(), ".cache/sde-design-harness/review.json");
const V1 = new Set(["warband-npc"]);   // the module's one AppV1 window
const pretty = (n) => n.replace(/^audit-/, "");
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

process.env.PORT = String(INNER);
process.env.MODULE_DIR = ROOT;   // this gallery is this checkout's review flow (kit, V1 set, review file): pin the harness to it
await import("./serve.mjs");   // the harness, on the inner port

const readReview = () => { try { return JSON.parse(fs.readFileSync(REVIEW, "utf8")); } catch { return {}; } };
const writeReview = (r) => { fs.mkdirSync(path.dirname(REVIEW), { recursive: true }); fs.writeFileSync(REVIEW, JSON.stringify(r, null, 2)); };

async function info(n) {
  try {
    const fx = (await import(`${pathToFileURL(path.join(DIR, n + ".mjs"))}?${Date.now()}`)).default;
    const w = fx.build ? { ...fx, ...fx.build(fx.initial) } : fx;
    return { width: Number(w.width) || 720, height: Number(fx.previewHeight ?? w.previewHeight ?? (Number(w.height) || 640) + 60), compareState: fx.compareState };
  } catch { return { width: 720, height: 700 }; }
}

async function build() {
  const names = fs.readdirSync(DIR).filter((f) => f.endsWith(".mjs") && !f.startsWith("_")).map((f) => f.replace(/\.mjs$/, ""));
  const base = names.filter((n) => !n.endsWith("-proposed") && n !== "kit");
  const only = names.filter((n) => n.endsWith("-proposed") && n !== "kit-proposed" && !names.includes(n.replace(/-proposed$/, "")));
  const pane = (n, theme, label, st, width, height) => {
    const scale = Math.min(1, 900 / width), q = new URLSearchParams({ embed: "1", theme }); if (st) q.set("state", st);
    return `<figure class="pane"><figcaption><b>${label}</b> ${theme} <a target="_blank" href="/w/${n}?theme=${theme}${st ? "&state=" + st : ""}">open</a> <a target="_blank" href="/w/${n}?w=420&theme=${theme}${st ? "&state=" + st : ""}">420</a></figcaption>
      <div class="frame" style="width:${Math.round(width * scale)}px;height:${Math.round(height * scale)}px"><iframe loading="lazy" src="/w/${n}?${q}" style="width:${width}px;height:${height}px;transform:scale(${scale})"></iframe></div></figure>`;
  };
  const review = (n) => `<div class="review" data-name="${n}"><span class="rv-l">Your call</span>
      <label><input type="radio" name="st-${n}" value="approved"> Approve</label><label><input type="radio" name="st-${n}" value="changes"> Needs changes</label><label><input type="radio" name="st-${n}" value="rejected"> Reject</label><label><input type="radio" name="st-${n}" value=""> Not reviewed</label>
      <textarea rows="2" placeholder="Comment: what to change, or what you like"></textarea><span class="rv-saved"></span></div>`;
  const rows = [];
  for (const pn of only) {
    const p = await info(pn), n = pn.replace(/-proposed$/, "");
    rows.push(`<section id="${n}" data-name="${n}" class="win"><h2>${esc(pretty(n))} <span class="k">new, nothing to compare</span></h2>${review(n)}<div class="grid"><div class="col"><h3>Improved</h3>${pane(pn, "dark", "NEW", p.compareState, p.width, p.height)}${pane(pn, "light", "NEW", p.compareState, p.width, p.height)}</div></div></section>`);
  }
  for (const n of base) {
    const now = await info(n), has = names.includes(n + "-proposed"), prop = has ? await info(n + "-proposed") : null, kind = V1.has(n) ? "V1" : "V2";
    rows.push(`<section id="${n}" data-name="${n}" class="win"><h2>${esc(pretty(n))} <span class="k ${kind}">${kind}</span>${has ? "" : ' <span class="k none">no proposal yet</span>'}</h2>${has ? review(n) : ""}
      <div class="grid"><div class="col"><h3>Current</h3>${pane(n, "dark", "NOW", now.compareState, now.width, now.height)}${pane(n, "light", "NOW", now.compareState, now.width, now.height)}</div>
      ${has ? `<div class="col"><h3>Improved</h3>${pane(n + "-proposed", "dark", "NEW", prop.compareState, prop.width, prop.height)}${pane(n + "-proposed", "light", "NEW", prop.compareState, prop.width, prop.height)}</div>` : ""}</div></section>`);
  }
  const all = [...only.map((p) => p.replace(/-proposed$/, "")), ...base];
  const nav = all.map((n) => `<a href="#${n}" data-n="${n}">${esc(pretty(n))}</a>`).join("");
  return `<!doctype html><meta charset="utf-8"><title>Window design review</title>
<style>body{margin:0;background:#16140f;color:#ddd;font:14px system-ui,sans-serif}header{background:#0b0b0b;border-bottom:1px solid #444;padding:10px 16px}
h1{margin:0 0 6px;font-size:18px}nav{display:flex;flex-wrap:wrap;gap:4px 10px;font-size:12px;margin-bottom:8px}nav a{color:#9cf;text-decoration:none}nav a.s-approved{color:#86d493}nav a.s-changes{color:#e8b64f}nav a.s-rejected{color:#ff8f80}
.bar{display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px}.bar button{background:#222;color:#ddd;border:1px solid #555;border-radius:4px;padding:3px 10px;cursor:pointer}.bar button.on{border-color:#c9c9c9;background:#333}
main{padding:16px}.win{margin:0 0 40px;padding:14px;border:1px solid #333;border-radius:8px}.win h2{margin:0 0 10px;font-size:20px}.k{font-size:11px;padding:1px 7px;border-radius:9px;border:1px solid #666;vertical-align:middle}.k.V1{border-color:#e8b64f;color:#e8b64f}.k.none{color:#888}
.review{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;margin:0 0 12px;padding:8px 10px;background:#0b0b0b;border:1px solid #444;border-radius:6px}.review textarea{flex:1 1 360px;min-width:200px;background:#000;color:#eee;border:1px solid #555;border-radius:4px;padding:6px;font:13px system-ui}.review label{cursor:pointer;white-space:nowrap}.rv-l{font-weight:700;color:#aaa}.rv-saved{font-size:11px;color:#86d493;min-width:50px}
.win.st-approved{border-color:#2d5a2d}.win.st-changes{border-color:#8a6a1c}.win.st-rejected{border-color:#7a2d2d}
.grid{display:flex;gap:28px;flex-wrap:wrap;align-items:flex-start}.col h3{margin:0 0 8px;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:#aaa}.pane{margin:0 0 14px}figcaption{font-size:12px;margin:0 0 4px;color:#aaa}figcaption a{color:#9cf;margin-left:8px}
.frame{overflow:hidden;border:1px solid #444;border-radius:4px;background:#2b2b2b}iframe{border:0;transform-origin:0 0;display:block}</style>
<a href="#top" style="position:fixed;left:10px;bottom:10px;z-index:9;padding:4px 10px;background:#000c;border:1px solid #666;border-radius:4px;color:#9cf;text-decoration:none;font-size:12px">index</a>
<header id="top"><h1>Window design review: now and improved, dark and light</h1><nav>${nav}</nav>
<div class="bar"><span id="tally"></span> Show: <button data-f="all" class="on">all</button><button data-f="">not reviewed</button><button data-f="approved">approved</button><button data-f="changes">needs changes</button><button data-f="rejected">rejected</button></div></header><main>${rows.join("")}</main>
<script>
const STATE = ${JSON.stringify(readReview())}; let filter = "all";
const secs = [...document.querySelectorAll("section.win")];
function paint(sec) { const n = sec.dataset.name, r = STATE[n] || {}; sec.className = "win" + (r.status ? " st-" + r.status : ""); const a = document.querySelector('nav a[data-n="' + n + '"]'); a.className = r.status ? "s-" + r.status : ""; }
function tally() { const c = { approved: 0, changes: 0, rejected: 0 }; let total = 0; for (const s of secs) if (s.querySelector(".review")) { total++; const st = (STATE[s.dataset.name] || {}).status; if (st) c[st]++; }
  document.getElementById("tally").textContent = c.approved + " approved, " + c.changes + " need changes, " + c.rejected + " rejected, " + (total - c.approved - c.changes - c.rejected) + " not reviewed (of " + total + ")";
  for (const s of secs) { const st = (STATE[s.dataset.name] || {}).status || ""; s.style.display = filter === "all" || filter === st ? "" : "none"; } }
async function save(n, patch, el) { STATE[n] = { ...(STATE[n] || {}), ...patch, at: new Date().toISOString() };
  const r = await fetch("/api/review", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: n, ...STATE[n] }) });
  const tag = el.querySelector(".rv-saved"); tag.textContent = r.ok ? "saved" : "NOT saved"; setTimeout(() => (tag.textContent = ""), 1500); paint(el.closest("section")); tally(); }
for (const rv of document.querySelectorAll(".review")) { const n = rv.dataset.name, r = STATE[n] || {};
  for (const i of rv.querySelectorAll("input")) { i.checked = i.value === (r.status || ""); i.onchange = () => save(n, { status: i.value }, rv); }
  const ta = rv.querySelector("textarea"); ta.value = r.comment || ""; let t; ta.oninput = () => { clearTimeout(t); t = setTimeout(() => save(n, { comment: ta.value }, rv), 600); }; }
for (const b of document.querySelectorAll(".bar button")) b.onclick = () => { filter = b.dataset.f; document.querySelectorAll(".bar button").forEach((x) => x.classList.toggle("on", x === b)); tally(); };
secs.forEach(paint); tally();
</script>`;
}

http.createServer(async (req, res) => {
  try {
    const u = new URL(req.url, "http://x");
    if (u.pathname === "/") { res.setHeader("content-type", "text/html; charset=utf-8"); return res.end(await build()); }
    if (u.pathname === "/api/review") {
      if (req.method === "GET") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(readReview())); }
      let body = ""; for await (const c of req) body += c;
      const { name, status, comment } = JSON.parse(body || "{}");
      if (!name || !/^[\w-]+$/.test(name)) { res.statusCode = 400; return res.end("bad name"); }
      const r = readReview(); r[name] = { status: status ?? r[name]?.status ?? "", comment: comment ?? r[name]?.comment ?? "", at: new Date().toISOString() }; writeReview(r);
      res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(r[name]));
    }
    const up = http.request({ host: "127.0.0.1", port: INNER, path: req.url, method: req.method, headers: req.headers }, (r) => { res.writeHead(r.statusCode, r.headers); r.pipe(res); });
    up.on("error", () => { res.statusCode = 502; res.end("harness not ready"); });
    req.pipe(up);
  } catch (e) { res.statusCode = 500; res.end(String(e.stack)); }
}).listen(PORT, "127.0.0.1", () => console.log(`design review: http://127.0.0.1:${PORT}/  (harness inside, on ${INNER}; reviews in ${REVIEW})`));
