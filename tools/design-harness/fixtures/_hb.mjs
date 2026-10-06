// Shared by fixtures that must compose a window out of several templates, or nest one template (the encounter creator)
// in a host the harness has no frame for. Compiles a repo template with the same strings and the common helpers the
// harness stubs, and wraps the result in a window frame, handing the harness a finished window as `html`.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";

const ROOT = new URL("../../../", import.meta.url);
const FOUNDRY = process.env.FOUNDRY_APP ?? path.join(os.homedir(), "FoundryV14", "app");
const Handlebars = createRequire(path.join(FOUNDRY, "x.js"))("handlebars").create();
const read = (f) => JSON.parse(readFileSync(f, "utf8"));
const flat = (o, p = "", out = {}) => { for (const [k, v] of Object.entries(o)) (v && typeof v === "object") ? flat(v, `${p}${k}.`, out) : out[`${p}${k}`] = v; return out; };
export const strings = { ...flat(read(path.join(FOUNDRY, "public/lang/en.json"))), ...flat(read(new URL("languages/en.json", ROOT))) };
export const say = (k, d) => (strings[k] ?? k).replace(/\{(\w+)\}/g, (m, x) => d?.[x] ?? m);
export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
Handlebars.registerHelper({
  localize: (k, o) => say(k, o?.hash), eq: (a, b) => a === b, includes: (a, v) => Array.isArray(a) && a.includes(v),
  array: (...a) => a.slice(0, -1), checked: (v) => (v ? "checked" : ""),
});
export const compile = (file, ctx) => Handlebars.compile(readFileSync(new URL(file, ROOT), "utf8"))(ctx);
export function windowHtml(id, { title, icon = "", classes = "", theme = "dark", tag = "div" }, body) {
  return `<${tag} id="${id}" class="application window-app themed theme-${theme} shadowdark ${classes}" data-appid="1"><header class="window-header"><i class="window-icon ${icon}" inert></i><h1 class="window-title">${esc(title)}</h1><button type="button" class="header-control icon fa-solid fa-ellipsis-vertical"></button><button type="button" class="header-control icon fa-solid fa-xmark"></button></header><section class="window-content">${body}</section></${tag}>`;
}
