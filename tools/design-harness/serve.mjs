// Render a module template inside a Foundry v14 window frame, with Foundry's core CSS,
// the Shadowdark system CSS and this module's stylesheets, with no world running.
//   node tools/design-harness/serve.mjs        then open http://127.0.0.1:4177/
// Edit a template or stylesheet and reload: nothing is cached.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FOUNDRY = process.env.FOUNDRY_APP ?? path.join(os.homedir(), "FoundryV14", "app");
const SYSTEM = process.env.SDE_SYSTEM ?? path.join(FOUNDRY, "../Data/systems/shadowdark");
const PORT = Number(process.env.PORT ?? 4177);
const MODULE_ID = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8")).id;
const Handlebars = createRequire(path.join(FOUNDRY, "x.js"))("handlebars");

const flat = (o, p = "", out = {}) => { for (const [k, v] of Object.entries(o)) (v && typeof v === "object") ? flat(v, `${p}${k}.`, out) : out[`${p}${k}`] = v; return out; };
const readJson = (f) => { try { return flat(JSON.parse(fs.readFileSync(f, "utf8"))); } catch { return {}; } };
const strings = () => ({ ...readJson(path.join(FOUNDRY, "public/lang/en.json")), ...readJson(path.join(SYSTEM, "i18n/en.json")), ...readJson(path.join(ROOT, "languages/en.json")) });

const missing = new Set();
function register(S) {
  const hb = Handlebars.create();
  const fmt = (s, d) => String(s).replace(/\{(\w+)\}/g, (m, k) => d?.[k] ?? m);
  hb.registerHelper("localize", (key, o) => { const s = S[key]; if (s === undefined) { missing.add(key); return key; } return fmt(s, o?.hash); });
  hb.registerHelper({
    eq: (a, b) => a === b, not: (a) => !a, gt: (a, b) => a > b, lt: (a, b) => a < b,
    and: (...a) => a.slice(0, -1).every(Boolean), or: (...a) => a.slice(0, -1).some(Boolean),
    includes: (arr, v) => Array.isArray(arr) ? arr.includes(v) : false,
    array: (...a) => a.slice(0, -1), join: (arr, sep) => (Array.isArray(arr) ? arr : []).join(typeof sep === "string" ? sep : ", "),
    isFinite: (v) => Number.isFinite(v), checked: (v) => (v ? "checked" : ""), select: (v, o) => o.fn ? o.fn(this) : v,
    selectOptions: (choices, o) => new Handlebars.SafeString(Object.entries(choices ?? {}).map(([k, v]) => `<option value="${k}"${String(k) === String(o.hash.selected) ? " selected" : ""}>${v?.label ?? v}</option>`).join("")),
    formGroup: (f, o) => new Handlebars.SafeString(`<div class="form-group"><label>${o.hash.label ?? ""}</label><div class="form-fields"><input type="text" value="${o.hash.value ?? ""}"></div></div>`),
    numberFormat: (n, o) => (o?.hash?.sign && Number(n) >= 0 ? "+" : "") + Number(n).toLocaleString(), ifThen: (c, a, b) => (c ? a : b),
    concat: (...a) => a.slice(0, -1).join(""), editor: (c) => new Handlebars.SafeString(`<div class="editor-content">${c ?? ""}</div>`),
    numberInput: (v, o) => new Handlebars.SafeString(`<input type="number" name="${o.hash.name}" value="${v ?? ""}" class="${o.hash.class ?? ""}" placeholder="${o.hash.placeholder ?? ""}">`),
  });
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith(".hbs") ? [path.join(d, e.name)] : []);
  for (const f of walk(path.join(SYSTEM, "templates"))) hb.registerPartial(path.relative(path.join(SYSTEM, "templates"), f).replace(/\.hbs$/, ""), fs.readFileSync(f, "utf8"));   // the system's own partials (actors/npc/..., ui/sd-box)
  for (const f of walk(path.join(ROOT, "templates"))) hb.registerPartial(`modules/${MODULE_ID}/${path.relative(ROOT, f)}`, fs.readFileSync(f, "utf8"));
  return hb;
}

const moduleStyles = () => JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8")).styles.map((s) => s.src ?? s);

// What `design-check` reports under the window: the failures that read as "text thrown at a wall".
const CHECK = `window.runCheck = () => {
  document.getElementById("design-check")?.remove();
  const win = document.querySelector(".application") ?? document.getElementById("ui-middle"), c = win.querySelector(".window-content") ?? win, bad = [];
  const label = (e) => e.tagName.toLowerCase() + (e.className && typeof e.className === "string" ? "." + e.className.trim().split(/\\s+/)[0] : "");
  const wr = win.getBoundingClientRect();
  for (const e of c.querySelectorAll("*")) {
    const r = e.getBoundingClientRect(); if (!r.width || !r.height) continue;
    if (r.right > wr.right + 1 || r.left < wr.left - 1) bad.push("sticks out sideways: " + label(e));
    else if (!e.matches("input[type=checkbox],input[type=radio]") && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).textOverflow === "ellipsis") bad.push("text cut off with ...: " + label(e));
    else if (!e.matches("input,select") && e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === "visible" && e.children.length === 0) bad.push("text overflows: " + label(e));
    if (e.matches("button, input:not([type=hidden],[type=checkbox],[type=radio]), select, textarea") && (r.height < 22 || r.width < 22)) bad.push("tiny control: " + label(e));
  }
  if (c.scrollWidth > c.clientWidth + 1) bad.push("window scrolls sideways");
  const buttons = [...c.querySelectorAll("button")].filter((b) => b.offsetParent).length;
  const primaries = [...c.querySelectorAll("button.sde-import-primary")].filter((b) => b.offsetParent).length;
  const s = { buttons, primaries, controls: c.querySelectorAll("button,input,select,textarea").length, problems: [...new Set(bad)] };
  window.__design = s;
  const el = document.createElement("pre"); el.id = "design-check";
  el.textContent = "visible buttons: " + buttons + "   primary: " + primaries + (s.problems.length ? "\\n" + s.problems.join("\\n") : "\\nno layout problems found");
  document.body.append(el);
};`;

// A fixture is one window. Either fixed (template + context) or a set of screens: `build(state)` returns the
// window for a state name, `initial` is the first, and `actions` says what a data-action click does:
//   { state: "tab-{tab}" }       go to that state, {x} filled from the element's data-x
//   { toggle: ["more", "less"] } flip between two states
async function load(name) { return (await import(`${pathToFileURL(path.join(ROOT, "tools/design-harness/fixtures", name + ".mjs"))}?${Date.now()}`)).default; }

function windowFor(fx, state) { return fx.build ? { ...fx, ...fx.build(state ?? fx.initial) } : fx; }

function renderWindow(fx, state) {
  const S = strings(), w = windowFor(fx, state);
  Object.assign(S, w.strings);   // strings a proposal adds, until they are in languages/en.json
  const hb = register(S);
  missing.clear();
  if (w.html) return { html: w.html.replace(/(src|href)="(modules|systems|icons|ui)\//g, '$1="/$2/'), title: w.title ?? "", w, S };
  // ApplicationV2 puts data-application-part on each part's root element; module CSS selects on it.
  const html = (w.parts ?? [{ template: w.template, context: w.context }]).map((p, i) =>
    hb.compile(fs.readFileSync(path.join(ROOT, p.template), "utf8"))(p.context).replace(/<(\w+)/, `<$1 data-application-part="${p.id ?? (i ? "part" + i : "body")}"`)).join("\n");
  return { html, title: S[w.title] ?? w.title, w, S };
}

async function page(name, q) {
  const fx = await load(name), state = q.get("state") ?? fx.initial;
  const { html: body, title, w } = renderWindow(fx, state);
  const theme = q.get("theme") === "light" ? "light" : "dark";
  const width = q.get("w") ?? w.width, h = q.get("h") ?? w.height ?? "auto";
  const px = (v) => (v === "auto" || !v ? "auto" : v + "px");
  return `<!doctype html><html><head><meta charset="utf-8"><title>${name}</title>
<link rel="stylesheet" href="/css/foundry2.css"><link rel="stylesheet" href="/fonts/fontawesome/css/all.min.css">
<style>@import url("/systems/shadowdark/css/shadowdark.css") layer(system);
${moduleStyles().map((s) => `@import url("/modules/${MODULE_ID}/${s}") layer(modules);`).join("\n")}
/* mirrors 747e67ad on branch fix/window-titles (not merged yet): titles inherit the header font. Delete once it is in master. */
@layer modules{.application.shadowdark .window-header .window-title{font-size:inherit;font-family:inherit}}</style>
${w.css ? `<style>${w.css}</style><style>@layer reset{${w.css}}</style>` : ""}
${q.get("embed") ? "<style>#design-check{position:static;display:inline-block;margin:10px 0 0;max-width:none}</style>" : ""}
<style>body{display:block;height:auto;min-height:100vh;padding:16px;background:#2b2b2b url("/ui/denim075.png")}
.application{position:relative!important;inset:auto!important;margin:0 0 16px;width:${px(width)};height:${px(h)};max-height:calc(100vh - 80px)}
.harness-toolbar{display:flex;gap:6px;align-items:center;margin:0 0 10px;font:12px sans-serif;color:#aaa}.harness-toolbar button{padding:3px 10px;border:1px solid #555;border-radius:4px;background:#222;color:#ddd;cursor:pointer}
#design-check{position:fixed;right:8px;bottom:8px;max-width:360px;margin:0;padding:8px 10px;font:12px/1.3 monospace;white-space:pre-wrap;color:#fff;background:#000c;border:1px solid #888;border-radius:4px;z-index:9999;user-select:text}</style>
</head><body class="vtt game system-shadowdark theme-${theme}">
${w.toolbar ? `<div class="harness-toolbar">${w.toolbar}</div>` : ""}
${w.html ? `<div id="ui"><div id="ui-middle" style="width:${px(width)}">${body}</div></div>` : ""}
${w.html ? "<!--" : ""}<div id="${w.id ?? "sde-" + name}" class="application window-app themed theme-${theme} ${(w.classes ?? ["shadowdark"]).join(" ")}" data-appid="1">
<header class="window-header"><i class="window-icon ${w.icon ?? ""}" inert></i><h1 class="window-title">${title}</h1>
<button type="button" class="header-control icon fa-solid fa-ellipsis-vertical"></button><button type="button" class="header-control icon fa-solid fa-xmark"></button></header>
<section class="window-content">${body}</section>${w.resizable ? '<div class="window-resize-handle"></div>' : ""}</div>${w.html ? "-->" : ""}
${missing.size ? `<script>console.warn("missing strings:", ${JSON.stringify([...missing])})</script>` : ""}
<script>${CHECK}
const NAME = ${JSON.stringify(name)}, ACTIONS = ${JSON.stringify(fx.actions ?? {})}; let state = ${JSON.stringify(state ?? null)};
addEventListener("load", runCheck);
document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]"), a = el && ACTIONS[el.dataset.action]; if (!a) return;
  e.preventDefault();
  state = a.toggle ? (state === a.toggle[0] ? a.toggle[1] : a.toggle[0]) : a.state.replace(/\\{(\\w+)(?:\\|(\\d+))?\\}/g, (m, k, n) => { const p = (state ?? "").split("."); return /^\\d+$/.test(k) ? p[k] ?? "" : el.dataset[k] ?? (n === undefined ? "" : p[n] ?? ""); });
  const r = await (await fetch("/w/" + NAME + "?frag=1&state=" + encodeURIComponent(state))).json();
  (document.querySelector(".window-content") ?? document.getElementById("ui-middle")).innerHTML = r.html; const wt = document.querySelector(".window-title"); if (wt) wt.textContent = r.title;
  history.replaceState(null, "", "?state=" + encodeURIComponent(state)); runCheck();
});</script></body></html>`;
}

const TYPES = { ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".TTF": "font/ttf", ".hbs": "text/plain" };
const roots = [["/systems/shadowdark/", SYSTEM], ["/modules/game-icons-net/", path.join(FOUNDRY, "../Data/modules/game-icons-net")], [`/modules/${MODULE_ID}/`, ROOT], ["/", path.join(FOUNDRY, "public")]];

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), p = decodeURIComponent(u.pathname);
  try {
    // shot.mjs asks this before reusing a running server, so a stale one from another checkout is not trusted.
    if (p === "/.harness") { res.writeHead(200, { "content-type": "text/plain" }); return res.end(ROOT); }
    if (p === "/" || p.startsWith("/compare/")) {
      const names = fs.readdirSync(path.join(ROOT, "tools/design-harness/fixtures")).filter((f) => !f.startsWith("_")).map((f) => f.replace(/\.mjs$/, ""));
      const frame = async (label, n, state) => {
        const fx = await load(n);
        return `<section style="margin:0 0 22px"><h2 style="margin:0 0 6px;font-size:16px"><span style="display:inline-block;min-width:64px;padding:1px 8px;margin-right:8px;border-radius:3px;background:${label === "AFTER" ? "#2d5a2d" : "#5a2d2d"};font-size:12px;letter-spacing:.5px">${label}</span>${n}
          <small style="font-weight:normal"><a style="color:#9cf" href="/w/${n}${state ? "?state=" + state : ""}" target="_blank">open alone</a> · <a style="color:#9cf" href="/w/${n}?w=420${state ? "&state=" + state : ""}" target="_blank">420px</a></small></h2>
          <iframe src="/w/${n}?embed=1${state ? "&state=" + state : ""}" style="width:100%;height:${fx.previewHeight ?? 700}px;border:1px solid #444;border-radius:4px;background:#2b2b2b"></iframe></section>`;
      };
      const pair = async (n) => (await frame("BEFORE", n)) + (await frame("AFTER", n + "-proposed", (await load(n + "-proposed")).compareState));
      let inner;
      if (p.startsWith("/compare/")) inner = await pair(p.slice(9));
      else inner = (await Promise.all(names.filter((n) => !n.endsWith("-proposed")).map(async (n) => names.includes(n + "-proposed")
        ? `<div style="margin:0 0 30px;padding:12px;border:1px solid #333;border-radius:6px"><h1 style="margin:0 0 10px;font-size:19px">${n}: before and after</h1>${await pair(n)}</div>`
        : `<div style="margin:0 0 30px"><h1 style="margin:0 0 10px;font-size:19px">${n}</h1>${await frame("NOW", n)}</div>`))).join("");
      res.setHeader("content-type", "text/html; charset=utf-8");
      return res.end(`<!doctype html><meta charset="utf-8"><title>Design harness</title><body style="margin:0;padding:16px;background:#1b1b1b;color:#ddd;font:15px sans-serif">${p === "/" ? '<h1 style="margin:0 0 14px">Design harness</h1>' : ""}${inner}</body>`);
    }
    if (p.startsWith("/w/") && u.searchParams.get("frag")) { const { html, title } = renderWindow(await load(p.slice(3)), u.searchParams.get("state")); res.setHeader("content-type", "application/json"); return res.end(JSON.stringify({ html, title })); }
    if (p.startsWith("/w/")) { res.setHeader("content-type", "text/html; charset=utf-8"); return res.end(await page(p.slice(3), u.searchParams)); }
    for (const [prefix, dir] of roots) {
      if (!p.startsWith(prefix)) continue;
      const f = path.join(dir, p.slice(prefix.length));
      if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
      res.setHeader("content-type", TYPES[path.extname(f)] ?? "application/octet-stream"); res.setHeader("cache-control", "no-store");
      return fs.createReadStream(f).pipe(res);
    }
    res.statusCode = 404; res.end("not found: " + p);
  } catch (err) { res.statusCode = 500; res.setHeader("content-type", "text/plain"); res.end(String(err.stack ?? err)); }
}).listen(PORT, "127.0.0.1", () => console.log(`design harness: http://127.0.0.1:${PORT}/`));
