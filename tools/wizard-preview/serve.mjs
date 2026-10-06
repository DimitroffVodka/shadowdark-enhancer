// A clickable preview of the import wizard, with no Foundry world running.
//   node tools/wizard-preview/serve.mjs        then open http://127.0.0.1:4188/
//
// The wizard's own code runs in your browser: file recognition, the pages and their buttons, the
// check, and reading your PDFs (Foundry's own pdf.js, from FOUNDRY_APP). The template is rendered by
// this server with Foundry's Handlebars. What Foundry would do on the server is simulated and
// labelled as such: uploads and the final import run. "Load sample files" feeds the wizard invented
// PDFs and maps carrying the real Arcane Library file names, so you can click through without any books.
import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import zlib from "node:zlib";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const FOUNDRY = process.env.FOUNDRY_APP ?? path.join(os.homedir(), "FoundryV14", "app");
const SYSTEM = process.env.SDE_SYSTEM ?? path.join(FOUNDRY, "../Data/systems/shadowdark");
const PORT = Number(process.env.PORT ?? 4188);
const MODULE_ID = JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8")).id;
const Handlebars = createRequire(path.join(FOUNDRY, "x.js"))("handlebars");

const flat = (o, p = "", out = {}) => { for (const [k, v] of Object.entries(o)) (v && typeof v === "object") ? flat(v, `${p}${k}.`, out) : out[`${p}${k}`] = v; return out; };
const readJson = (f) => { try { return flat(JSON.parse(fs.readFileSync(f, "utf8"))); } catch { return {}; } };
// Words only the simulated import run uses; they live here, not in languages/en.json, because the module never asks for them.
const PREVIEW = {
  "SDE.importer.wizard.preview.reading": "Reading {title}",
  "SDE.importer.wizard.preview.building": "Building the map for {title}",
  "SDE.importer.wizard.preview.finishing": "Finishing up",
  "SDE.importer.wizard.preview.exampleTitle": "Example: an entry the importer was unsure about",
  "SDE.importer.wizard.preview.exampleWhy": "This is a made-up example for the preview. A real one would say what was unclear and offer to review it.",
};
const strings = () => ({ ...readJson(path.join(FOUNDRY, "public/lang/en.json")), ...readJson(path.join(SYSTEM, "i18n/en.json")), ...readJson(path.join(ROOT, "languages/en.json")), ...PREVIEW });
const fmt = (s, d) => String(s).replace(/\{(\w+)\}/g, (m, k) => d?.[k] ?? m);

function renderTemplate(vm) {
  const S = strings(), hb = Handlebars.create();
  hb.registerHelper("localize", (key, o) => (S[key] === undefined ? key : fmt(S[key], o?.hash)));
  const file = fs.readFileSync(path.join(ROOT, "templates/importer-wizard.hbs"), "utf8");
  return hb.compile(file)(vm).replace(/<(\w+)/, `<$1 data-application-part="body"`);
}

const moduleStyles = () => JSON.parse(fs.readFileSync(path.join(ROOT, "module.json"), "utf8")).styles.map((s) => s.src ?? s);

// ── Invented sample files, carrying the real file names ───────────────────────────────────────────
const { SOURCE_PDFS } = await import(pathToFileURL(path.join(ROOT, "scripts/importer/char-content/char-content-manifest.mjs")));
const { allSites } = await import(pathToFileURL(path.join(ROOT, "scripts/importer/adventure/adventure-manifest.mjs")));
const { writePdf } = await import(pathToFileURL(path.join(ROOT, "test/pdf-synth/pdf-writer.mjs")));

const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const body = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(body)); return Buffer.concat([len, body, c]); };
/** A plain grey PNG of w x h. */
function png(w, h) {
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 90)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Every file the wizard knows how to find: [file name, kind, size hint in MB for the optional real-sized mode]. */
function samples() {
  const books = Object.entries(SOURCE_PDFS).map(([src, p]) => ({ name: p.split("/").pop(), kind: "pdf", mb: { CORE: 74.3, WR: 145.2, GMWR: 97.5 }[src] ?? 0 }));
  const maps = allSites().map((s) => ({ name: `${s.mapNames?.[0] ?? s.title} (${s.grid?.[0] ?? 30} wide x ${s.grid?.[1] ?? 20} high).png`, kind: "png", grid: s.grid ?? [30, 20] }));
  // The hex maps, under the names they ship with.
  for (const name of ["Western Reaches GM Map A0.png", "The Gloaming Hex Map.png", "The Djurum Hex Map.png", "Isles of Andrik Hex Map.png", "Jungle Hex Map - North.png", "Jungle Hex Map - South.png", "Morzomotha Hex Map (VTT).png"]) {
    maps.unshift({ name, kind: "png", grid: [993, 1404] });
  }
  return [...books, ...maps];
}

function sampleFile(name, q) {
  const s = samples().find((x) => x.name === name);
  if (!s) return null;
  if (s.kind === "png") { const [gw, gh] = s.grid; const k = gw > 200 ? 0.1 : 5; return { type: "image/png", body: png(Math.round(gw * k), Math.round(gh * k)) }; }
  const pdf = Buffer.from(writePdf([{ runs: [{ x: 50, y: 700, text: `Invented sample of ${name}` }] }]));
  const pad = Number(q.get("mb") ?? 0) * 1048576;
  return { type: "application/pdf", body: pad > pdf.length ? Buffer.concat([pdf, Buffer.alloc(pad - pdf.length, 32)]) : pdf };
}

// ── The page ─────────────────────────────────────────────────────────────────────────────────────
const page = () => `<!doctype html><html><head><meta charset="utf-8"><title>Import wizard preview</title>
<link rel="stylesheet" href="/css/foundry2.css"><link rel="stylesheet" href="/fonts/fontawesome/css/all.min.css">
<style>@import url("/systems/shadowdark/css/shadowdark.css") layer(system);
${moduleStyles().map((s) => `@import url("/modules/${MODULE_ID}/${s}") layer(modules);`).join("\n")}
@layer modules{.application.shadowdark .window-header .window-title{font-size:inherit;font-family:inherit}}</style>
<style>body{display:block;height:auto;min-height:100vh;padding:16px;background:#2b2b2b url("/ui/denim075.png")}
#preview-bar{display:flex;flex-wrap:wrap;gap:6px 14px;align-items:center;max-width:680px;margin:0 0 12px;padding:8px 10px;font:12px/1.4 sans-serif;color:#ccc;background:#000a;border:1px solid #555;border-radius:6px}
#preview-bar label{display:inline-flex;gap:5px;align-items:center;cursor:pointer}
#preview-bar button{padding:3px 10px;border:1px solid #666;border-radius:4px;background:#222;color:#eee;cursor:pointer}
#preview-bar .why{flex-basis:100%;color:#999}
.application{position:relative!important;inset:auto!important;margin:0;width:640px;height:min(720px,calc(100vh - 150px));min-height:460px}
#toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);padding:8px 14px;font:13px sans-serif;color:#fff;background:#000d;border:1px solid #888;border-radius:6px;display:none;z-index:9}</style>
</head><body class="vtt game system-shadowdark theme-dark">
<div id="preview-bar">
  <label><input type="checkbox" id="sim-forge"> Pretend I am on The Forge (50 MB per file)</label>
  <label><input type="checkbox" id="sim-fail"> Make uploads fail</label>
  <label><input type="checkbox" id="sim-big"> Sample big books at real size (317 MB)</label>
  <label><input type="checkbox" id="sim-problem"> Make one entry need attention</label>
  <button id="load-samples" type="button">Load sample files</button>
  <button id="restart" type="button">Start over</button>
  <span class="why">Real here: file recognition, every page and button, the check, and reading your PDFs with Foundry's pdf.js. Simulated here: uploads and the final import.</span>
</div>
<div class="application window-app themed theme-dark shadowdark sde-import-wizard" id="sde-import-wizard" data-appid="1">
  <header class="window-header"><i class="window-icon fa-solid fa-wand-magic-sparkles" inert></i><h1 class="window-title">Import wizard</h1>
    <button type="button" class="header-control icon fa-solid fa-xmark" id="win-close"></button></header>
  <section class="window-content"></section>
</div>
<div id="toast"></div>
<script type="module" src="/modules/${MODULE_ID}/tools/wizard-preview/preview.mjs"></script>
</body></html>`;

const TYPES = { ".css": "text/css", ".js": "text/javascript", ".mjs": "text/javascript", ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".webp": "image/webp", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".woff": "font/woff", ".ttf": "font/ttf", ".TTF": "font/ttf", ".hbs": "text/plain", ".html": "text/html" };
const roots = [["/scripts/pdfjs/", path.join(FOUNDRY, "node_modules/@foundryvtt/pdfjs")], ["/systems/shadowdark/", SYSTEM], [`/modules/${MODULE_ID}/`, ROOT], ["/", path.join(FOUNDRY, "public")]];

http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x"), p = decodeURIComponent(u.pathname);
  try {
    if (p === "/") { res.setHeader("content-type", "text/html; charset=utf-8"); return res.end(page()); }
    if (p === "/strings.json") { res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store"); return res.end(JSON.stringify(strings())); }
    // Opt-in: WIZARD_PREVIEW_FILES=<folder> serves that folder's files at /local/<name>, so a test can load real downloads.
    if (p.startsWith("/local/") && process.env.WIZARD_PREVIEW_FILES) {
      const f = path.join(process.env.WIZARD_PREVIEW_FILES, path.basename(p));
      if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.statusCode = 404; return res.end(); }
      res.setHeader("content-type", "application/octet-stream"); res.setHeader("cache-control", "no-store");
      return fs.createReadStream(f).pipe(res);
    }
    if (p === "/sample-list.json") { res.setHeader("content-type", "application/json"); return res.end(JSON.stringify(samples())); }
    if (p.startsWith("/sample/")) {
      const f = sampleFile(p.slice(8), u.searchParams);
      if (!f) { res.statusCode = 404; return res.end("no such sample"); }
      res.setHeader("content-type", f.type); res.setHeader("cache-control", "no-store"); return res.end(f.body);
    }
    if (p === "/render" && req.method === "POST") {
      const chunks = []; for await (const c of req) chunks.push(c);
      res.setHeader("content-type", "text/html; charset=utf-8"); res.setHeader("cache-control", "no-store");
      return res.end(renderTemplate(JSON.parse(Buffer.concat(chunks).toString())));
    }
    for (const [prefix, dir] of roots) {
      if (!p.startsWith(prefix)) continue;
      const f = path.join(dir, p.slice(prefix.length));
      if (!f.startsWith(dir) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) continue;
      res.setHeader("content-type", TYPES[path.extname(f)] ?? "application/octet-stream"); res.setHeader("cache-control", "no-store");
      return fs.createReadStream(f).pipe(res);
    }
    res.statusCode = 404; res.end("not found: " + p);
  } catch (err) { res.statusCode = 500; res.setHeader("content-type", "text/plain"); res.end(String(err.stack ?? err)); }
}).listen(PORT, "127.0.0.1", () => console.log(`import wizard preview: http://127.0.0.1:${PORT}/`));
