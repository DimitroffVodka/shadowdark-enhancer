// The Crawl Bar carrying a battle map's item (#485): the item before Tools in a crawl and on a hex map, and at the end of
// the combat row, with its panel folded and open (staged: the readout, Bring the table; live: the status, Return).
// The item and its panel are the module's own markup (scripts/overland/encounter-panel.mjs battleItem) in the module's own
// stylesheet; the bar around them is the still crawl-bar.mjs and crawl-bar-combat.mjs hold. One state per button at the bottom left.
import fs from "node:fs";
import { ICONS } from "../../../scripts/shared/icons.mjs";
import { battleItem } from "../../../scripts/overland/encounter-panel.mjs";

const en = JSON.parse(fs.readFileSync(new URL("../../../languages/en.json", import.meta.url), "utf8"));
const fmt = (key, data = {}) => String(en[key] ?? key).replace(/\{(\w+)\}/g, (_, k) => data[k] ?? "");
globalThis.game ??= { i18n: { localize: (key) => fmt(key), format: fmt } };

const FOES = { name: "Dire wolf", uuid: "Actor.wolf", count: 4, distanceRoll: 3, activityRoll: 8, reactionRoll: 7, img: "modules/shadowdark-enhancer/icons/game-icons/skull-crossed-bones.svg" };
const battle = (status) => ({
  id: "b1", status, sceneId: "S1", mapId: "forest-woods", label: "Forest Woods", encounter: FOES,
  combat: status === "live" ? { started: true, round: 2 } : null, combatEnded: false,
});
const row = (name, state, pct, loaded = 0, total = 0) => ({ userId: name, name, state, loaded, total, failed: 0, pct });
const rows = [row("Ann", "ready", 1, 40, 40), row("Bob", "loading", 0.5, 20, 40), row("Cy", "waiting", 0), row("Di", "stalled", 0.25, 10, 40)];
const preload = { sceneId: "S1", rows, ready: 1, expected: 4, allReady: false, startedAt: 0 };

const bar = (inner) => `<div id="shadowdark-enhancer-bar" class="shadowdark-enhancer-bar"><div class="sde-bar-inner sde-bar-active">${inner}</div></div>`;
const button = (cls, action, inner) => `<button type="button" class="sde-bar-btn${cls ? ` ${cls}` : ""}" data-action="${action}">${inner}</button>`;
const tools = `<div class="sde-bar-tools"><button type="button" class="sde-bar-btn sde-bar-tools-btn" data-action="tools" aria-expanded="false">${ICONS.tools} Tools ${ICONS.caretUp}</button></div>`;

const ROWS = {
  crawl: (item) => bar(`<span class="sde-bar-phase-badge sde-bar-phase-crawl">${ICONS.startCrawl} Crawl · Round 4</span>${
    button("sde-bar-next-btn", "nextCrawlTurn", `${ICONS.nextTurn} Next Round`)}${button("", "addSelectedTokens", `${ICONS.addTokens} Add Tokens`)}${
    button("sde-bar-combat-btn", "startCombat", `${ICONS.combat} Combat`)}<span class="sde-bar-gap"></span>${item}${tools}${
    button("sde-bar-danger-btn", "endCrawl", `${ICONS.close} End`)}`),
  travel: (item) => bar(`<span class="sde-bar-phase-badge sde-bar-phase-overland">${ICONS.walking} Forest · Fair · 3 of 4 hexes left</span>${
    button("", "makeCamp", `${ICONS.camp} Make camp`)}<span class="sde-bar-gap"></span>${item}${tools}${
    button("sde-bar-danger-btn", "endTravel", `${ICONS.close} End travel`)}`),
  combat: (item) => bar(`${button("sde-bar-danger-btn", "endEncounter", `${ICONS.close} End Encounter`)}${
    button("", "addSelectedTokens", `${ICONS.addTokens} Add Tokens`)}${button("sde-bar-danger-btn", "deleteEncounter", `${ICONS.close} Delete Encounter`)}${item}`),
};

const STATES = {
  "crawl · staged, open": { row: "crawl", status: "staged", open: true },
  "crawl · live, folded": { row: "crawl", status: "live", open: false },
  "crawl · live, open": { row: "crawl", status: "live", open: true },
  "travel · staged, open": { row: "travel", status: "staged", open: true },
  "combat · live, folded": { row: "combat", status: "live", open: false },
  "combat · live, open": { row: "combat", status: "live", open: true },
};

const html = (s) => `${ROWS[s.row](battleItem({ battle: battle(s.status), preload: s.status === "staged" ? preload : null, open: s.open }))}
<div style="position:fixed;left:8px;top:8px;display:flex;gap:6px;flex-wrap:wrap;z-index:99;font:12px sans-serif">${Object.keys(STATES).map((k) =>
  `<button type="button" data-action="${k}" style="padding:4px 10px">${k}</button>`).join("")}</div>`;

export default {
  title: "Crawl bar (battle map)", width: 1009, previewHeight: 820, initial: "crawl · staged, open",
  build: (state) => ({ html: html(STATES[state]), css: "#ui-middle{padding-top:640px}" }),
  actions: Object.fromEntries(Object.keys(STATES).map((k) => [k, { state: k }])),
};
