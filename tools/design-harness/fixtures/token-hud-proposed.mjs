// Proposed Token HUD buttons (design proposal 2026-10-03): BEFORE is what movement-tracker, item-drops and quick-adjust inject
// today (div.control-icon, title only); AFTER is button.control-icon.sde-hud-btn with aria-label and data-tooltip, 40px, from
// proposed/css/token-hud.css. The core buttons are copies of templates/hud/token-hud.hbs. Also the prayer-roll icon fix.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const flat = (o, p = "", out = {}) => { for (const [k, v] of Object.entries(o)) (v && typeof v === "object") ? flat(v, `${p}${k}.`, out) : out[`${p}${k}`] = v; return out; };
const S = flat(JSON.parse(fs.readFileSync(path.join(ROOT, "languages/en.json"), "utf8")));
const fmt = (s, d) => String(s).replace(/\{(\w+)\}/g, (m, k) => d?.[k] ?? m);
const L = (k, d) => fmt(S[k] ?? `[${k}]`, d);
const core = (ic, label) => `<button type="button" class="control-icon" data-tooltip aria-label="${label}"><i class="fa-solid ${ic}" inert></i></button>`;
const old = (ic, tip) => `<div class="control-icon" title="${tip}"><i class="fa-solid ${ic}" style="font-size:1.2em;"></i></div>`;
const neu = (ic, tip, action) => `<button type="button" class="control-icon sde-hud-btn" data-action="${action}" data-tooltip aria-label="${tip}"><i class="fa-solid ${ic}" inert></i></button>`;
const hud = (title, right, left, note) => `<figure class="hud-fig"><figcaption>${title}</figcaption>
  <div class="hud-ground"><div id="token-hud" class="placeable-hud themed theme-dark hud-mock"><div class="col left">${core("fa-layer-group", "Level")}${core("fa-bring-forward", "Sort")}${left}</div>
  <div class="col middle"><img class="hud-token" src="/icons/svg/mystery-man.svg" alt=""></div>
  <div class="col right">${core("fa-eye", "Hide")}${core("fa-face-smile", "Effects")}${right}</div></div></div><p class="hud-note">${note}</p></figure>`;
const before = hud("BEFORE: div.control-icon, title only", old("fa-hand-holding", L("SDE.loot.itemDrops.pickUpTip", { name: "Longsword" })) + old("fa-scale-balanced", L("SDE.quickAdjust.hudTooltip")), old("fa-rotate-left", L("SDE.crawlStrip.movement.rollbackTip")), "Not focusable, no accessible name, inline font-size.");
const after = hud("AFTER: button.control-icon.sde-hud-btn, core 32px", neu("fa-hand-holding", L("SDE.loot.itemDrops.pickUpTip", { name: "Longsword" }), "sde-pickup") + neu("fa-scale-balanced", L("SDE.quickAdjust.hudTooltip"), "sde-quick-adjust"), neu("fa-rotate-left", L("SDE.crawlStrip.movement.rollbackTip"), "sde-rollback"), "Focusable, named, same data-action; same 32px box as before and as core's own buttons.");
const pray = `<figure class="hud-fig"><figcaption>Prayer roll icon (system character sheet header)</figcaption><div class="pray-mock"><span class="pray-label">Deity</span> <span class="pray-name">Saint Terragnis</span><button type="button" class="sde-prayer-roll" title="${L("SDE.prayerRoll.title", { deity: "Saint Terragnis" })}" aria-label="${L("SDE.prayerRoll.title", { deity: "Saint Terragnis" })}"><img src="/modules/shadowdark-enhancer/icons/game-icons/prayer.svg" alt=""></button></div><p class="hud-note">A class instead of inline cssText; hover and focus by CSS; localized label (the old alt was the literal word Pray).</p></figure>`;
const css = fs.readFileSync(path.join(ROOT, "tools/design-harness/proposed/css/token-hud.css"), "utf8") + `
.hud-stack{display:flex;flex-direction:column;gap:20px;font:13px sans-serif;color:#ddd;padding:14px;background:#2b2b2b;border-radius:6px}
.hud-pair{display:grid;grid-template-columns:repeat(2,240px);gap:16px;align-items:start}
.hud-fig{margin:0;width:240px}.hud-fig figcaption{color:#ddd!important;height:34px;font-weight:700;margin:0 0 6px}.hud-note{height:48px;margin:6px 0 0;color:#aaa!important;font-size:12px}
.hud-ground{width:240px;height:200px;box-sizing:border-box;padding:16px;background:#222;border-radius:6px}
.hud-mock{position:relative!important;inset:auto!important;transform:none!important;display:grid!important;grid-template-columns:32px 64px 32px;column-gap:12px;justify-content:center;width:auto!important;height:auto!important;margin:0;padding:0;background:none}
.hud-mock .col{position:static!important;inset:auto!important;transform:none!important;width:32px!important;display:grid!important;grid-auto-rows:32px;row-gap:8px;align-content:start;justify-items:stretch}
.hud-mock .col.middle{width:64px!important}
.hud-mock .control-icon{box-sizing:border-box;width:32px!important;height:32px!important}
.hud-token{width:64px;height:64px;border:1px solid #666;border-radius:50%;background:#444}
.pray-mock{background:#e8e0cc;color:#222;padding:10px 12px;border-radius:4px;font:14px sans-serif;display:flex;align-items:center;gap:6px}.pray-label{font-weight:700;text-transform:uppercase;font-size:12px}`;
export default { previewHeight: 700, title: "proposed token HUD", width: 560, html: `<div class="hud-stack"><div class="hud-pair">${before}${after}</div>${pray}</div>`, css, strings: {} };
