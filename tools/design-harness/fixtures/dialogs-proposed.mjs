// Proposed standard dialog set (design proposal 2026-10-03): the five DialogV2 shapes on the UI kit + proposed/css/dialogs.css.
// Each frame mirrors DialogV2's markup (window-header, .dialog-content, footer.form-footer with its own buttons).
// Strings are existing SDE.* keys from languages/en.json; NEW lists what the proposal adds.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UI_CSS } from "./_proposed.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const flat = (o, p = "", out = {}) => { for (const [k, v] of Object.entries(o)) (v && typeof v === "object") ? flat(v, `${p}${k}.`, out) : out[`${p}${k}`] = v; return out; };
const NEW = { "SDE.dialog.keepIt": "Keep it", "SDE.dialog.reading": "Reading the map" };
const S = { ...flat(JSON.parse(fs.readFileSync(path.join(ROOT, "languages/en.json"), "utf8"))), ...NEW };
const fmt = (s, d) => String(s).replace(/\{(\w+)\}/g, (m, k) => d?.[k] ?? m);
const L = (k, d) => fmt(S[k] ?? `[${k}]`, d);
const icon = (c) => `<i class="${c}" inert></i>`;
const btn = (label, { action, cls = "", ic = "" } = {}) => `<button type="button" class="${cls}" data-action="${action}">${ic ? icon(ic) : ""}${label}</button>`;
const dialog = (title, content, buttons, extra = "") => `<div class="application dialog window-app themed sde-ui sde-dialog ${extra}" role="dialog">
  <header class="window-header"><h1 class="window-title">${title}</h1><button type="button" class="header-control icon fa-solid fa-xmark" aria-label="${L("SDE.importer.btn.close")}"></button></header>
  <section class="window-content"><div class="dialog-content standard-form">${content}</div><footer class="form-footer">${buttons}</footer></section>
</div>`;

// 1. simple confirm (stale build): two buttons, the affirmative is the filled default
const d1 = dialog(L("SDE.staleBuild.title"),
  `<div class="dlg-msg info">${icon("fa-solid fa-rotate")}<div class="dlg-fields"><p class="dlg-text">${L("SDE.staleBuild.body")}</p><p class="dlg-text"><strong>${L("SDE.staleBuild.prompt")}</strong></p><p class="dlg-sub">${L("SDE.staleBuild.versions", { cached: "1.42.0", installed: "1.43.1" })}</p></div></div>`,
  btn(L("SDE.staleBuild.keepGoing"), { action: "no" }) + btn(L("SDE.staleBuild.reload"), { action: "yes", cls: "default", ic: "fa-solid fa-rotate" }));

// 2. destructive confirm: explicit verbs, the SAFE button is the filled default, the destructive one is a red outline on the left
const d2 = dialog(L("SDE.sessionRecap.dialog.deleteTitle"),
  `<div class="dlg-msg danger">${icon("fa-solid fa-triangle-exclamation")}<div class="dlg-fields"><p class="dlg-text">${L("SDE.sessionRecap.dialog.deleteBody")}</p><ul class="dlg-items"><li><strong>Session 14: The Marrowgate Heist</strong></li></ul></div></div>`,
  btn(L("SDE.rulesData.set.delete"), { action: "yes", cls: "danger", ic: "fa-solid fa-trash" }) + btn(L("SDE.dialog.keepIt"), { action: "no", cls: "default" }));

// 3. multi-choice: a list of rows, one action each (the dying GM prompt); Cancel is the quiet last row
const d3 = dialog(L("SDE.dying.menuTitle", { name: "Aldric" }),
  `<div class="dlg-msg">${icon("fa-solid fa-skull")}<p class="dlg-text">${L("SDE.dying.menuHint")}</p></div>`,
  btn(L("SDE.dying.stabilizeWith", { name: "Seraphina", dc: 12 }), { action: "check", cls: "default", ic: "fa-solid fa-dice-d20" })
  + btn(L("SDE.dying.stabilizeNow"), { action: "stabilize", ic: "fa-solid fa-heart-pulse" })
  + btn(L("SDE.dying.addRound"), { action: "add", ic: "fa-solid fa-plus" })
  + btn(L("SDE.dying.removeRound"), { action: "remove", ic: "fa-solid fa-minus" })
  + btn(L("SDE.dying.conscious"), { action: "conscious", ic: "fa-solid fa-eye" })
  + btn(L("SDE.dying.riseNow"), { action: "rise", ic: "fa-solid fa-arrow-up" })
  + btn(L("SDE.importer.btn.cancel"), { action: "cancel", cls: "ghost" }), "dlg-choices");

// 4. prompt with two fields
const d4 = dialog(L("SDE.rulesData.set.newTitle"),
  `<div class="dlg-fields"><div class="ui-field"><label class="ui-label" for="dlg-name">${L("SDE.rulesData.set.name")}</label><input id="dlg-name" type="text" name="name" autofocus></div><div class="ui-field"><label class="ui-label" for="dlg-from">${L("SDE.rulesData.set.startFrom")}</label><select id="dlg-from" name="from"><option>Shadowdark default</option><option>Western Reaches</option></select></div></div>`,
  btn(L("SDE.importer.btn.cancel"), { action: "cancel" }) + btn(L("SDE.rulesData.set.create"), { action: "ok", cls: "default", ic: "fa-solid fa-plus" }));

// 5. progress: one line of words, one bar, one way out
const d5 = dialog(L("SDE.dialog.reading"),
  `<div class="dlg-fields"><div class="dlg-progress-line"><span>${L("SDE.hexMap.progress.classifying", { done: 412, total: 1240 })}</span><span class="ui-value">33%</span></div><progress class="dlg-progress" max="100" value="33"></progress><p class="dlg-sub">${L("SDE.hexMap.progress.reading", { k: 3, total: 9 })}</p></div>`,
  btn(L("SDE.importer.btn.cancel"), { action: "cancel" }));

const html = `<div class="dlg-stack">${[d1, d2, d3, d4, d5].join("")}</div>`;
export default { previewHeight: 1100, title: "proposed dialogs", width: 440, html, css: UI_CSS() + "\n" + fs.readFileSync(path.join(ROOT, "tools/design-harness/proposed/css/dialogs.css"), "utf8"), strings: NEW };
