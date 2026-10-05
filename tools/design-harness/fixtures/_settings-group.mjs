// Shared by the settings-group-* fixtures. SettingsGroupMenu (scripts/shared/settings-group-menu.mjs) renders its
// settings with Foundry's {{formGroup}}, which the harness stubs as a label-less text box, so these fixtures compile the
// real templates/settings-group.hbs here with a formGroup that writes what Foundry's does (form-group > label,
// form-fields, hint), and hand the harness a finished window as `html`. The settings themselves are read out of the
// real registerSettings() source (name, hint, type, default, choices, range), and the group layout from the real
// SETTING_GROUPS. Not the real thing: the file-picker and range-picker custom elements (core JS the harness does not
// run) are written as the markup core produces for them.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { SETTING_GROUPS } from "../../../scripts/shared/setting-groups.mjs";

const ROOT = new URL("../../../", import.meta.url);
const FOUNDRY = process.env.FOUNDRY_APP ?? path.join(os.homedir(), "FoundryV14", "app");
const Handlebars = createRequire(path.join(FOUNDRY, "x.js"))("handlebars").create();
const read = (f) => JSON.parse(readFileSync(f, "utf8"));
const flat = (o, p = "", out = {}) => { for (const [k, v] of Object.entries(o)) (v && typeof v === "object") ? flat(v, `${p}${k}.`, out) : out[`${p}${k}`] = v; return out; };
const S = { ...flat(read(path.join(FOUNDRY, "public/lang/en.json"))), ...flat(read(new URL("languages/en.json", ROOT))) };
const src = readFileSync(new URL("scripts/shared/settings.mjs", ROOT), "utf8");
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
const tr = (k) => S[k] ?? k;

// settings.mjs registrations: find `game.settings.register(MODULE_ID, "key", {` and the object's closing brace.
function registration(key) {
  const at = src.indexOf(`game.settings.register(MODULE_ID, "${key}", {`);
  if (at < 0) return null;
  let i = src.indexOf("{", at), depth = 0, j = i;
  for (; j < src.length; j++) { if (src[j] === "{") depth++; else if (src[j] === "}" && --depth === 0) break; }
  const proxy = new Proxy(function () {}, { get: () => proxy, apply: () => proxy, construct: () => proxy });
  try { return new Function("MODULE_ID", "foundry", "game", "Hooks", "ui", "CONFIG", "DEFAULT_ENCOUNTER_SOURCES", "BOOK_CHECKS", "defaultCrawlState", "defaultOverlandState", "RulesDataApp", `return (${src.slice(i, j + 1)});`)("shadowdark-enhancer", proxy, proxy, proxy, proxy, proxy, [], [], () => ({}), () => ({}), class {}); }
  catch (e) { return { name: key, hint: "", type: String, default: "", error: String(e) }; }
}

// What the field renders as, by the setting's type, the way SettingsConfig builds it.
function control(name, s, value) {
  const choices = s.choices;
  if (s.filePicker && s.filePicker !== "folder") return `<file-picker type="image" style="display:flex;gap:4px"><input type="text" class="image" name="${name}" value="${esc(value)}"><button type="button" class="fa-solid fa-file-import fa-fw"></button></file-picker>`;
  if (choices) return `<select name="${name}">${Object.entries(choices).map(([k, v]) => `<option value="${esc(k)}"${String(k) === String(value) ? " selected" : ""}>${esc(tr(v))}</option>`).join("")}</select>`;
  if (s.type === Boolean) return `<input type="checkbox" name="${name}"${value ? " checked" : ""}>`;
  if (s.type === Number && s.range) return `<range-picker name="${name}" style="display:flex;gap:6px;align-items:center"><input type="range" min="${s.range.min}" max="${s.range.max}" step="${s.range.step}" value="${value}"><span class="range-value">${value}</span></range-picker>`;
  if (s.type === Number) return `<input type="number" name="${name}" value="${value}">`;
  return `<input type="text" name="${name}" value="${esc(value)}">`;
}

// `faked`: settings of another package (the system's Pulp and Momentum, Extras' Grinder) the harness cannot read.
export function settingsGroupHtml(groupKey, { faked = {}, title, template = "templates/settings-group.hbs", extra = {} } = {}) {
  const group = SETTING_GROUPS.find((g) => g.key === groupKey);
  const field = (setting, fallbackKey) => {
    const name = `shadowdark-enhancer.${fallbackKey}`;
    return { menu: false, field: { label: tr(setting.name), hint: tr(setting.hint), html: control(name, setting, setting.default ?? (setting.type === Boolean ? false : "")) } };
  };
  const formGroup = (f) => new Handlebars.SafeString(`<div class="form-group"><label>${esc(f.label)}</label><div class="form-fields">${f.html}</div><p class="hint">${esc(f.hint)}</p></div>`);
  Handlebars.registerHelper("localize", (k, o) => tr(k).replace(/\{(\w+)\}/g, (m, x) => o?.hash?.[x] ?? m));
  Handlebars.registerHelper("formGroup", (f) => formGroup(f));
  Object.entries(extra).forEach(([k, v]) => { S[k] = v; });
  const entry = (e) => {
    if (typeof e === "string") {
      const reg = registration(e) ?? { name: `SDE.settings.${e}.name`, hint: `SDE.settings.${e}.hint`, type: Boolean, default: true };   // registered outside settings.mjs
      if (reg.filePicker === "folder") return { folders: true, name: `shadowdark-enhancer.${e}`, label: tr(reg.name), hint: tr(reg.hint), values: ["modules/shadowdark-enhancer/assets/portraits", "worlds/western-reaches/art/tokens"] };
      return field(reg, e);
    }
    if (e.menu) return { menu: true, key: e.menu, icon: e.icon, label: `SDE.settings.${e.menu}.name`, hint: `SDE.settings.${e.menu}.hint`, buttonText: `SDE.settings.${e.menu}.label` };
    if (e.note) return { note: e.note };
    if (e.key) return { ...field(registration(e.key), e.key), pending: !!e.pending, option: !!e.option };
    if (e.setting) {
      const f = faked[e.setting];
      if (f) return { ...field(f, e.setting), showIf: e.showIf ?? null };
      return e.missing ? { note: e.missing } : null;
    }
    return null;
  };
  const sections = group.sections.map((s) => ({ label: s.label, hint: s.hint, mode: !!s.mode, switchLabel: s.mode && s.label ? `${s.label}Switch` : null, entries: s.entries.map(entry).filter(Boolean) }));
  // the real template, with its entry.field slot replaced: formGroup is handed the prepared field
  const tpl = readFileSync(new URL(template, ROOT), "utf8");
  const body = Handlebars.compile(tpl)({ rootId: "x", sections });
  const w = title ?? tr(`SDE.settings.${groupKey}.name`);
  return { title: w, icon: group.icon, body };
}

export function windowHtml(name, { title, icon, body }, classes = "sde-settings-group sde-ui", theme = "dark") {
  return `<form id="${name}" class="application window-app themed theme-${theme} shadowdark ${classes}" data-appid="1"><header class="window-header"><i class="window-icon ${icon}" inert></i><h1 class="window-title">${esc(title)}</h1><button type="button" class="header-control icon fa-solid fa-ellipsis-vertical"></button><button type="button" class="header-control icon fa-solid fa-xmark"></button></header><section class="window-content standard-form">${body}</section></form>`;
}

// The proposed (kit) version of a group: the proposed template, the kit css, root class sde-ui. Folder pickers are
// written out as core draws them, because the file-picker element does not run in the harness.
import { UI_CSS } from "./_proposed.mjs";
export function proposedGroupFixture(groupKey, faked) {
  const g = settingsGroupHtml(groupKey, { faked, template: "tools/design-harness/proposed/templates/settings-group.hbs" });
  const body = g.body.replace(/<file-picker type="folder" value="([^"]*)"><\/file-picker>/g, '<file-picker style="display:flex;gap:4px;flex:1"><input type="text" value="$1"><button type="button" class="ui-icon fa-solid fa-folder-open"></button></file-picker>');
  return { previewHeight: 760, title: g.title, width: 720, css: UI_CSS() + "\n" + readFileSync(new URL("tools/design-harness/proposed/css/settings-group.css", ROOT), "utf8"),
    html: windowHtml(`sde-settings-${groupKey}`, { ...g, body }, "sde-ui") };
}
