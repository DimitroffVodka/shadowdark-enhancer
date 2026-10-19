// The clock HUD with its sky dial open: the bar, the season plate (with today's weather) and the half-disc dial.
// The dial is the module's own markup (scripts/overland/hud-core.mjs dialMarkup) and the look is the module's own stylesheet;
// the bar and plate are stills of what overland-bar.mjs builds, so a change to _bar() or _seasonBand() needs the still changed too.
// One state per button at the bottom left: a day, a night, a long place name, and the ways of travelling (pushed, mounted, by boat).
import { dialMarkup, dialModel, dialSize, plateSize } from "../../../scripts/overland/hud-core.mjs";

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const hhmm = (h) => `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;
const SUMMER = { sunrise: 6.4, sunset: 19.1, season: "Summer", date: "Tuesday, 4 June", time: "10:12", hour: 10.2, moon: 0.4, word: "Fair", region: "Greywater Reach", terrain: "plains" };
// `hexes`: [left, budget]. The mounted and boat budgets are placeholders; the real ones come from the rules table and the boat's speed.
const STATES = {
  day: { hour: 15.38, moon: 0.26, sunrise: 8.2, sunset: 16.67, word: "Fair", region: "Sablewood", terrain: "forest", date: "Wednesday, 17 January", time: "15:23", season: "Winter", hexes: [0, 4], method: "walking" },
  night: { hour: 23.17, moon: 0.5, sunrise: 8.2, sunset: 16.67, word: "Stormy", region: "Sablewood", terrain: "forest", date: "Thursday, 18 January", time: "23:10", season: "Winter", hexes: [2, 4], method: "walking" },
  long: { hour: 9.5, moon: 0.08, sunrise: 6.4, sunset: 19.1, word: "Excellent", region: "The Sundered Marches of Karthak", terrain: "mountain forest", date: "Friday, 26 September", time: "09:30", season: "Autumn", hexes: [3, 4], method: "walking" },
  pushed: { ...SUMMER, hexes: [5, 6], method: "walking", pushed: true },
  mounted: { ...SUMMER, hexes: [6, 8], method: "mounted" },
  // The plate's other states: a held encounter (the GM's, with Stopped by the time), no day open yet, and not travelling at all.
  encounter: { ...SUMMER, plate: "encounter" },
  noday: { ...SUMMER, plate: "noday" },
  start: { ...SUMMER, plate: "start" },
  boat: { ...SUMMER, region: "Lake Varn", terrain: "lake", hexes: [7, 10], method: "sailing" },
};
const ICON = { walking: "fa-person-walking", mounted: "fa-horse", sailing: "fa-sailboat" };
const WORD = { walking: "walking", mounted: "mounted", sailing: "sailing" };

// What _bar() builds on the left, beside the tools: the day's counter, a word, or the GM's Start travel button.
const dayCell = (s, tip) => {
  // A held encounter is the one thing the GM must act on, so its plate is lit; no day open is quiet and dashed.
  if (s.plate === "encounter") return '<button type="button" class="sde-hud-plate sde-hud-count sde-hud-alert" data-tooltip="An encounter stopped the travel clock. Run it, then press Continue to finish the move."><i class="fa-solid fa-triangle-exclamation"></i> Encounter</button>';
  if (s.plate === "noday") return '<button type="button" class="sde-hud-plate sde-hud-count sde-hud-idle" data-tooltip="No travel day is open. Start one in the Travel panel."><i class="fa-solid fa-sun"></i> No day</button>';
  if (s.plate === "start") return '<button type="button" class="sde-hud-go"><i class="fa-solid fa-hexagon"></i> Start travel</button>';
  return `<button type="button" class="sde-hud-plate sde-hud-count" data-tooltip="${tip}"><i class="fa-solid ${ICON[s.method]} sde-hud-how"></i><b>${s.hexes[0]}</b>/${s.hexes[1]}${s.pushed ? '<i class="fa-solid fa-angles-up sde-hud-push"></i>' : ""}</button>`;
};

// What _bar() builds on the right: finding the party and opening its sheet, then the travel panel while a day is open.
const partyCells = (s) => {
  const users = '<button type="button" class="sde-hud-ib" data-tooltip="Find the party on the map"><i class="fa-solid fa-location-crosshairs"></i></button><button type="button" class="sde-hud-ib" data-tooltip="Open the party sheet"><i class="fa-solid fa-shield-halved"></i></button>';
  return s.plate === "start" ? users : `${users}<button type="button" class="sde-hud-ib"><i class="fa-solid fa-users"></i></button>`;
};

// What _seasonBand() builds: the plate's own SVG (fill and the closed border) under the season and today's weather.
const seasonPlate = (s) => {
  const p = plateSize();
  return `<div class="sde-hud-season" style="width:${p.w}px"><svg class="sde-hud-season-shape" viewBox="0 0 ${p.w} ${p.h}" preserveAspectRatio="none" aria-hidden="true"><path class="sde-hud-season-fill" d="M0 0 H${p.w} L${p.w - p.flare} ${p.h} H${p.flare} Z"/><path class="sde-hud-season-edge" stroke-width="${p.stroke}" d="M${p.stroke / 2} ${p.stroke / 2} H${p.w - p.stroke / 2} L${p.w - p.flare - p.stroke / 2} ${p.h - p.stroke / 2} H${p.flare + p.stroke / 2} Z"/></svg><span>${esc(s.season)}</span><i class="sde-hud-wx-dot"></i><span class="sde-hud-wx">${esc(s.word)}</span></div>`;
};

const hud = (s) => {
  const d = dialModel({ hour: s.hour, sunrise: s.sunrise, sunset: s.sunset, moonFraction: s.moon });
  const dial = dialMarkup({ d, region: s.region, terrain: s.terrain, label: "Sky", tip: `${s.region} · ${s.terrain}`,
    riseTip: `sun rises ${hhmm(s.sunrise)}`, setTip: `sun sets ${hhmm(s.sunset)}`, nowTip: `Now: ${s.time}` });
  const tip = !s.hexes ? "" : `${s.hexes[0]} of ${s.hexes[1]} movement points left today, ${WORD[s.method]}${s.pushed ? ", pushing" : ""}`;
  return `<div id="shadowdark-enhancer-travel" class="sde-hud-visible"><div class="sde-hud-col">
  <div class="sde-hud-bar sde-hud-bar-3">
    <div class="sde-hud-side">
      <button type="button" class="sde-hud-ib"><i class="fa-solid fa-backward"></i></button>
      <button type="button" class="sde-hud-ib"><i class="fa-solid fa-calendar-days"></i></button>
      <button type="button" class="sde-hud-ib sde-hud-cloud" aria-pressed="true" data-tooltip="Hide weather effects on this device"><i class="fa-solid fa-cloud-rain"></i></button>
      <button type="button" class="sde-hud-ib"><i class="fa-solid fa-sliders"></i></button>
      ${dayCell(s, tip)}
    </div>
    <span class="sde-hud-date sde-hud-date-mid"><span class="sde-hud-d">${esc(s.date)}</span><span class="sde-hud-t">${esc(s.time)}</span>
      <button type="button" class="sde-hud-ib sde-hud-chev" aria-pressed="true" data-tooltip="Hide the sky"><i class="fa-solid fa-chevron-up"></i></button></span>
    <div class="sde-hud-side sde-hud-side-r">
      ${partyCells(s)}
      <button type="button" class="sde-hud-ib"><i class="fa-solid fa-forward"></i></button>
    </div>
  </div>
  <div class="sde-hud-drop" style="--sde-dial-w:${dialSize().w}px">${seasonPlate(s)}${dial}</div>
</div></div>
<div style="position:fixed;left:8px;bottom:8px;display:flex;gap:6px;z-index:99;font:12px sans-serif">${Object.keys(STATES).map((k) => `<button type="button" data-action="${k}" style="padding:4px 10px">${k}</button>`).join("")}</div>`;
};

export default {
  title: "Clock HUD", width: 1300, previewHeight: 330, initial: "day",
  build: (st) => ({ html: hud(STATES[st]), css: "" }),
  actions: Object.fromEntries(Object.keys(STATES).map((k) => [k, { state: k }])),
};
