// Proposed chat cards (design proposal 2026-10-03): every card type stacked in a 300px chat log, on the UI kit
// (proposed/sde-ui.css) plus the card-scale parts (proposed/css/chat-cards.css). Template-backed cards use the proposed
// templates in proposed/templates/chat/; JS-built cards are the markup a ChatMessage.create call would carry.
// Same context as audit-chat-cards.mjs. Strings come from languages/en.json; `NEW` lists the strings a proposal adds.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { UI_CSS } from "./_proposed.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FOUNDRY = process.env.FOUNDRY_APP ?? path.join(os.homedir(), "FoundryV14", "app");
const Handlebars = createRequire(path.join(FOUNDRY, "x.js"))("handlebars");
const flat = (o, p = "", out = {}) => { for (const [k, v] of Object.entries(o)) (v && typeof v === "object") ? flat(v, `${p}${k}.`, out) : out[`${p}${k}`] = v; return out; };
const NEW = { "SDE.loot.card.more": "More actions" };
const S = { ...flat(JSON.parse(fs.readFileSync(path.join(ROOT, "languages/en.json"), "utf8"))), ...NEW };
const fmt = (s, d) => String(s).replace(/\{(\w+)\}/g, (m, k) => d?.[k] ?? m);
const L = (k, d) => fmt(S[k] ?? `[${k}]`, d);
const hb = Handlebars.create();
hb.registerHelper("localize", (key, o) => fmt(S[key] ?? `[${key}]`, o?.hash));
const tpl = (f, ctx) => hb.compile(fs.readFileSync(path.join(ROOT, "tools/design-harness/proposed/templates/chat", f), "utf8"))(ctx);
const IMG = "/icons/svg/mystery-man.svg";
const msg = (who, inner, time = "10:42 PM") => `<li class="chat-message message flexcol"><header class="message-header flexrow"><h4 class="message-sender">${who}</h4><span class="message-metadata"><time class="message-timestamp">${time}</time></span></header><div class="message-content">${inner}</div></li>`;
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");

const cards = [
  ["GM", tpl("encounter-check.hbs", { hit: true, flavor: "Encounter check (wilderness, day)", roll: { total: 1 }, where: "Forest, Day 3" })],
  ["GM", tpl("encounter-check.hbs", { hit: false, flavor: "Encounter check (wilderness, day)", roll: { total: 4 }, where: "Forest, Day 3" })],
  ["GM", tpl("encounter-result.hbs", { via: "Wilderness table: Forest", img: IMG, count: 3, name: "Giant Spider With A Long Name", distanceText: "Near (30 ft)", distanceRoll: "1d6 = 2", activityText: "Hunting", activityRoll: "2d6 = 7", reactionText: "Hostile", reactionBand: "Hostile", reactionRoll: "2d6 = 4", chaMod: -1, renownApplied: true, renownBonus: "+1", renownBonusText: "+1", renownName: "Aldric Stormwind", renownBandLabel: "Notable", reactionDoubleOnes: true })],
  ["GM", tpl("encounter-flavor.hbs", { via: "Wilderness table: Forest", text: "A cold wind carries the smell of wet iron through the pines, and somewhere ahead a bell tolls once." })],
  ["GM", tpl("loot-card.hbs", { tier: "Tier 2", source: "Goblin warren", items: [
    { idx: 0, img: IMG, name: "Longsword", qtyLabel: "", valueLabel: "15 gp", featureLabel: "keen", forgeable: true },
    { idx: 1, img: IMG, name: "Potion of Healing Extra Strong", qtyLabel: " x2", valueLabel: "50 gp", featureLabel: "", forgeable: false },
    { idx: 2, img: IMG, name: "Silver Ring", qtyLabel: "", valueLabel: "", featureLabel: "", claimedBy: "x", claimedByName: "Aldric" }],
    hasCoins: true, coinsLabel: "120 gp, 40 sp", party: [{ id: "a", name: "Aldric" }, { id: "b", name: "Seraphina the Brave" }], notes: ["One item is cursed."], hasTotals: true, totalGp: 340, totalXp: 3 })],
  ["GM (menus open)", tpl("loot-card.hbs", { tier: "Tier 1", items: [{ idx: 0, img: IMG, name: "Longsword", qtyLabel: "", valueLabel: "15 gp", featureLabel: "keen", forgeable: true }], hasCoins: true, coinsLabel: "20 gp", party: [{ id: "a", name: "Aldric" }, { id: "b", name: "Seraphina the Brave" }], hasTotals: false }).replaceAll("<details class=\"cc-more", "<details open class=\"cc-more")],
  ["Chaos initiative", `<div class="sde-ui ui-cc"><header class="cc-head"><i class="fa-solid fa-shuffle"></i><h4 class="cc-title">${esc(L("SDE.chaos.header", { round: 2 }))}</h4></header><ol class="cc-list"><li class="cc-li"><span class="cc-rank">1</span><span class="cc-who">Aldric</span><span class="cc-fine">1d20 + 2</span><span class="cc-num">17</span></li><li class="cc-li"><span class="cc-rank">2</span><span class="cc-who">Goblin Skirmisher</span><span class="cc-fine">1d20</span><span class="cc-num">9</span></li></ol></div>`],
  ["Pulp", `<div class="sde-ui ui-cc"><header class="cc-head"><i class="fa-solid fa-clover"></i><h4 class="cc-title">${esc(L("SDE.pulp.sessionLuck"))}</h4></header><ul class="cc-list"><li class="cc-li"><span class="cc-who">Aldric</span><span class="cc-num">3</span></li><li class="cc-li"><span class="cc-who">Seraphina</span><span class="cc-num">1</span></li></ul></div>`],
  ["Rumors", `<div class="sde-ui ui-cc"><header class="cc-head"><i class="fa-solid fa-ear-listen"></i><h4 class="cc-title">${esc(L("SDE.rumors.chat.title"))}</h4></header><ul class="cc-list"><li class="cc-li quote">The miller's daughter has not been seen since the harvest festival.</li><li class="cc-li quote">A caravan went into the Marsh and came out with one fewer cart.</li></ul></div>`],
  ["Troubles (GM whisper)", `<div class="sde-ui ui-cc warn"><header class="cc-head"><i class="fa-solid fa-triangle-exclamation"></i><h4 class="cc-title">${esc(L("SDE.troubles.title"))}</h4></header><div class="cc-body"><p class="cc-text">${esc(L("SDE.troubles.chat.stage", { settlement: "Marrowgate", stage: "weeks away", symptoms: "Grain prices are climbing and the watch has doubled." }))}</p></div></div>`],
  ["Rules data", `<div class="sde-ui ui-cc warn sde-rules-notice"><div class="cc-body"><p class="cc-text">${esc(L("SDE.rulesData.missing.terrain"))}</p><div><button type="button" class="ui-btn"><i class="fa-solid fa-scroll"></i>${esc(L("SDE.rulesData.openStep"))}</button></div></div></div>`],
  ["Weather", `<div class="sde-ui ui-cc"><header class="cc-head"><i class="fa-solid fa-cloud-showers-heavy"></i><h4 class="cc-title">${esc(L("SDE.overland.weather.title", { weather: "Storm" }))}</h4></header><div class="cc-body"><p class="cc-text">Rain turns normal ground difficult; harsh climates stop travel.</p><p class="cc-fine">${esc(L("SDE.overland.weather.until", { date: "Day 4, evening" }))} ${esc(L("SDE.overland.weather.rolled", { roll: 6 }))}</p></div></div>`],
  ["Downtime", `<div class="sde-ui ui-cc"><header class="cc-head"><i class="fa-solid fa-mug-hot"></i><h4 class="cc-title">${esc(L("SDE.downtime.title"))}</h4></header><div class="cc-body"><p class="cc-text">${esc(L("SDE.downtime.card.announce"))}</p><p class="ui-inline"><span class="ui-chip gold"><i class="fa-solid fa-book"></i>Western Reaches Players Guide</span><span class="ui-chip"><i class="fa-solid fa-hourglass-half"></i>9 days</span></p><div><button type="button" class="ui-btn primary sde-dt-open-btn"><i class="fa-solid fa-mug-hot"></i>${esc(L("SDE.downtime.card.open"))}</button></div></div><footer class="cc-foot"><span class="cc-fine">${esc(L("SDE.downtime.card.noLuck"))}</span></footer></div>`],
  ["Merchant", `<div class="sde-ui ui-cc"><header class="cc-head"><i class="fa-solid fa-store"></i><h4 class="cc-title">${esc(L("SDE.merchant.card.purchased"))}</h4><span class="ui-chip">Aldric</span></header><div class="cc-body"><div class="cc-thing"><img src="${IMG}" alt=""><span class="cc-name">Leather armor<small>${L("SDE.merchant.card.boughtLine", { buyer: "<strong>Aldric</strong>", item: "<strong>Leather armor</strong>", price: "6 gp" })}</small></span></div></div></div>`],
  ["Aldric", `<div class="sde-ui ui-cc compact"><img src="${IMG}" alt=""><span class="cc-main"><span class="cc-text">${L("SDE.loot.itemDrops.pickedUpCard", { name: "<strong>Aldric</strong>" })} <strong>Longsword</strong></span></span></div>`],
  ["Aldric", `<div class="sde-ui ui-cc compact"><img src="${IMG}" alt=""><span class="cc-main"><span class="cc-text"><strong>${esc(L("SDE.magicForge.card.forged"))}</strong> Longsword of Flame</span><span class="cc-aux">Weapon, +1</span></span></div>`],
  ["Aldric", `<div class="sde-ui ui-cc compact good"><i class="fa-solid fa-shield-halved"></i><span class="cc-main"><span class="cc-text">${esc(L("SDE.parry.announce", { name: "Aldric" }))}</span><span class="cc-aux">${esc(L("SDE.parry.reversed", { hp: 4 }))}</span></span></div>`],
  ["Aldric", `<div class="sde-ui ui-cc compact bad"><i class="fa-solid fa-skull"></i><span class="cc-main"><span class="cc-text">${esc(L("SDE.dying.menuHint"))}</span></span></div>`],
  ["Aldric rolls Initiative", `<div class="sde-ui ui-cc compact"><span class="cc-big">14</span><span class="cc-main"><span class="cc-text">${esc(L("SDE.crawlStrip.oocInitFlavor", { name: "Aldric" }))}</span><span class="cc-aux">${esc(L("SDE.crawlStrip.oocTag"))} 1d20 + 2</span></span></div>`],
  ["Warband attack", `<div class="sde-ui ui-cc"><div class="cc-body"><p class="cc-note info sde-warband-note"><i class="fa-solid fa-people-group"></i>${esc(L("SDE.warband.areaNote"))}</p></div></div>`],
  ["Pit fight", `<div class="sde-ui ui-cc"><header class="cc-head"><i class="fa-solid fa-bolt"></i><h4 class="cc-title">${esc(L("SDE.pitFighting.card.twist"))}</h4></header><div class="cc-body"><p class="cc-text">The floor is slick with oil.</p><p class="cc-fine">1d4: 3</p></div></div>`],
];
const html = `<div style="width:300px"><section id="chat" class="chat-sidebar" style="width:100%;max-width:100%;min-width:0"><ol id="chat-log" class="chat-log" style="list-style:none;margin:0;padding:6px;display:flex;flex-direction:column;gap:6px">${cards.map(([w, i]) => msg(w, i)).join("")}</ol></section></div>`;
export default { previewHeight: 900, title: "proposed chat cards", width: 300, html, css: UI_CSS() + "\n" + fs.readFileSync(path.join(ROOT, "tools/design-harness/proposed/css/chat-cards.css"), "utf8"), strings: NEW };
