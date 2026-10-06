// Audit fixture (design audit 2026-10-03): the module's chat cards stacked in a 300px chat-log frame.
// Real templates are compiled here with the module's own en.json; cards that scripts build in JS are copied
// from their source (file noted) with sample data. Not a window: the `html` key renders it bare.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const FOUNDRY = process.env.FOUNDRY_APP ?? path.join(os.homedir(), "FoundryV14", "app");
const Handlebars = createRequire(path.join(FOUNDRY, "x.js"))("handlebars");
const flat = (o, p = "", out = {}) => { for (const [k, v] of Object.entries(o)) (v && typeof v === "object") ? flat(v, `${p}${k}.`, out) : out[`${p}${k}`] = v; return out; };
const S = flat(JSON.parse(fs.readFileSync(path.join(ROOT, "languages/en.json"), "utf8")));
const fmt = (s, d) => String(s).replace(/\{(\w+)\}/g, (m, k) => d?.[k] ?? m);
const L = (k, d) => fmt(S[k] ?? k, d);
const hb = Handlebars.create();
hb.registerHelper("localize", (key, o) => fmt(S[key] ?? key, o?.hash));
const tpl = (f, ctx) => hb.compile(fs.readFileSync(path.join(ROOT, "templates/chat", f), "utf8"))(ctx);
const IMG = "/icons/svg/mystery-man.svg";
const msg = (who, inner, time = "10:42 PM") => `<li class="chat-message message flexcol"><header class="message-header flexrow"><h4 class="message-sender">${who}</h4><span class="message-metadata"><time class="message-timestamp">${time}</time></span></header><div class="message-content">${inner}</div></li>`;

const cards = [
  ["GM", tpl("encounter-check.hbs", { hit: true, flavor: "Encounter check (wilderness, day)", roll: { total: 1 }, where: "Forest, Day 3" })],
  ["GM", tpl("encounter-result.hbs", { via: "Wilderness table: Forest", img: IMG, count: 3, name: "Giant Spider With A Long Name", distanceText: "Near (30 ft)", distanceRoll: "1d6 = 2", activityText: "Hunting", activityRoll: "2d6 = 7", reactionText: "Hostile", reactionBand: "Hostile", reactionRoll: "2d6 = 4", chaMod: -1, renownApplied: true, renownBonus: "+1", renownBonusText: "+1", renownName: "Aldric Stormwind", renownBandLabel: "Notable", reactionDoubleOnes: true })],
  ["GM", tpl("encounter-flavor.hbs", { via: "Wilderness table: Forest", text: "A cold wind carries the smell of wet iron through the pines, and somewhere ahead a bell tolls once." })],
  ["GM", tpl("loot-card.hbs", { tier: "Tier 2", source: "Goblin warren", items: [
    { idx: 0, img: IMG, name: "Longsword", qtyLabel: "", valueLabel: " (15 gp)", featureLabel: "keen", forgeable: true },
    { idx: 1, img: IMG, name: "Potion of Healing Extra Strong", qtyLabel: " x2", valueLabel: " (50 gp)", featureLabel: "", forgeable: false },
    { idx: 2, img: IMG, name: "Silver Ring", qtyLabel: "", valueLabel: "", featureLabel: "", claimedBy: "x", claimedByName: "Aldric" }],
    hasCoins: true, coinsLabel: "120 gp, 40 sp", party: [{ id: "a", name: "Aldric" }, { id: "b", name: "Seraphina the Brave" }], notes: ["One item is cursed."], hasTotals: true, totalGp: 340, totalXp: 3 })],
  ["Item pickup (item-drops.mjs:673)", `<div class="shadowdark-enhancer item-pickup-card" style="display:flex;align-items:center;gap:8px;padding:6px 4px;"><img src="${IMG}" alt="" width="36" height="36" style="border:none;flex:0 0 auto;"><div style="line-height:1.2;">${L("SDE.loot.itemDrops.pickedUpCard", { name: "<strong>Aldric</strong>" })}<br><span>Longsword</span></div></div>`],
  ["Forge (magic-forge-app.mjs:718)", `<div class="shadowdark-enhancer sde-forge-card" style="display:flex;align-items:center;gap:8px;"><img src="${IMG}" alt="" width="36" height="36" style="border:none;flex:0 0 auto;"><div><strong>${L("SDE.magicForge.card.forged")}</strong> Longsword of Flame<br><span style="opacity:0.8;">Weapon, +1</span></div></div>`],
  ["Chaos (chaos.mjs:217)", `<div class="sde-chaos-card"><header>${L("SDE.chaos.header", { round: 2 })}</header><ol><li><strong>Aldric</strong> <span class="sde-chaos-roll">17</span> <span class="sde-chaos-formula">1d20 + 2</span></li><li><strong>Goblin</strong> <span class="sde-chaos-roll">9</span> <span class="sde-chaos-formula">1d20</span></li></ol></div>`],
  ["Pulp (pulp.mjs:68)", `<div class="sde-pulp-card"><header>${L("SDE.pulp.sessionLuck")}</header><ul><li><strong>Aldric</strong> 3</li><li><strong>Seraphina</strong> 1</li></ul></div>`],
  ["Rumors (rumors.mjs:228)", `<div class="sde-rumor-card"><header>${L("SDE.rumors.chat.title")}</header><ul><li>The miller's daughter has not been seen since the harvest festival.</li><li>A caravan went into the Marsh and came out with one fewer cart.</li></ul></div>`],
  ["Rules notice (rules-data-notice.mjs:42)", `<div class="sde-rules-notice"><p>${L("SDE.rulesData.missing.terrain")}</p><button type="button"><i class="fa-solid fa-scroll"></i> ${L("SDE.rulesData.openStep")}</button></div>`],
  ["Parry (parry.mjs:397)", `<div class="sde-parry-card"><i class="fa-solid fa-shield-halved"></i> ${L("SDE.parry.announce", { name: "Aldric" })} <em>${L("SDE.parry.reversed", { hp: 4 })}</em></div>`],
  ["Dying (dying.mjs:127)", `<p class="sde-dying-line">${L("SDE.dying.menuHint")}</p>`],
  ["Pit fight (pit-fighting-app.mjs:958)", `<div class="sde-pit-card"><header class="sde-pit-card-head"><i class="fas fa-bolt"></i> ${L("SDE.pitFighting.card.twist")}</header><div class="sde-pit-card-body">The floor is slick with oil. <em>(1d4: 3)</em></div></div>`],
];
const html = `<div id="sidebar" style="width:300px"><section id="chat" class="chat-sidebar"><ol id="chat-log" class="chat-log" style="list-style:none;margin:0;padding:6px;display:flex;flex-direction:column;gap:6px">${cards.map(([w, i]) => msg(w, i)).join("")}</ol></section></div>`;
export default { previewHeight: 900, title: "audit chat cards", width: 300, html };
