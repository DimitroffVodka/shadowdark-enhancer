/**
 * Shadowdark Enhancer — the travel bar (#234, Overland O8, docs/plans/overland.md §4).
 *
 * Top centre, for everyone, while travelling on a tagged hex map; hidden
 * during a combat and on any other scene, where the Crawl Strip or nothing
 * shows instead. The slim bar is the date and time, the sun or the moon, the
 * weather and the hexes left. A click opens the expanded view: the sky dome,
 * the season and climate, the day's method and budget, the members' rations,
 * who foraged (with a Forage button on each character the viewer owns), and
 * for a GM the day's checks with their hours and the day's buttons. Players
 * never see the check hours (overland-bar-core.mjs leaves them out).
 *
 * Mounted like the Crawl Strip (crawl-strip.mjs mount): a click-transparent
 * wrapper in #interface with a bar that takes clicks.
 */

import { CrawlState } from "../crawl-strip/crawl-state.mjs";
import { isHexMapScene } from "../encounter/encounter-terrain.mjs";
import { esc } from "../shared/esc.mjs";
import { dateParts } from "../time/time-core.mjs";
import {
  overlandState, weatherNow, weatherName, methodName, rollWeather, askDay, startDay, makeCamp,
  endOverland, resume, forage, OVERLAND_CHANGED,
} from "./overland.mjs";
import { DOME, barModel, domePoint, itemTouchesBar, moonShadow, redrawStamp, skyPosition } from "./overland-bar-core.mjs";

const BAR_ID = "shadowdark-enhancer-travel";
const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** Each moon phase's name (literal keys, so i18n-keys can see them). */
const MOON_NAME = {
  new: "SDE.overland.bar.moon.new",
  waxingCrescent: "SDE.overland.bar.moon.waxingCrescent",
  firstQuarter: "SDE.overland.bar.moon.firstQuarter",
  waxingGibbous: "SDE.overland.bar.moon.waxingGibbous",
  full: "SDE.overland.bar.moon.full",
  waningGibbous: "SDE.overland.bar.moon.waningGibbous",
  lastQuarter: "SDE.overland.bar.moon.lastQuarter",
  waningCrescent: "SDE.overland.bar.moon.waningCrescent",
};

/** "19:10" from hours with a fraction. */
const hhmm = (hours) => {
  const minutes = Math.round(hours * 60);
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
};

/** A button: every label from en.json, every value escaped. */
const button = (action, label, { id = "", hint = "", cls = "" } = {}) =>
  `<button type="button" class="sde-bar-btn sde-travel-btn ${cls}" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ""}${
    hint ? ` data-tooltip="${esc(hint)}"` : ""}>${esc(label)}</button>`;

export const TravelBar = {
  _el: null,
  _open: false,
  /** The date, time and weather last drawn: a clock tick redraws only when one changes. */
  _drawn: "",

  init() {
    this.mount();
    const queue = () => this.render();
    Hooks.on(OVERLAND_CHANGED, queue);
    Hooks.on(CrawlState.HOOK_CHANGED, queue);
    Hooks.on("canvasReady", queue);
    // Real-time light tracking moves the clock every second: redraw on the minute.
    Hooks.on("updateWorldTime", () => { if (this._stamp() !== this._drawn) this.render(); });
    // A member's rations change when they forage, buy, trade or eat.
    const onItem = (item) => {
      if (this._el?.classList.contains("sde-travel-visible") && itemTouchesBar(item, overlandState().members)) this.render();
    };
    for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.on(hook, onItem);
  },

  mount() {
    if (document.getElementById(BAR_ID)) { this._el = document.getElementById(BAR_ID); return; }
    const el = document.createElement("div");
    el.id = BAR_ID;
    (document.getElementById("interface") ?? document.body).prepend(el);
    el.addEventListener("click", (event) => this._onClick(event));
    this._el = el;
    this.render();
  },

  /** What a redraw on the clock depends on: the absolute minute, and the weather that holds. */
  _stamp() {
    return redrawStamp(game.time.worldTime, game.time.calendar?.days?.secondsPerMinute, CrawlState.isOverland ? weatherNow() : "");
  },

  render() {
    if (!this._el) return;
    const shown = CrawlState.isOverland && isHexMapScene();
    this._el.classList.toggle("sde-travel-visible", shown);
    if (!shown) { this._el.innerHTML = ""; return; }
    this._drawn = this._stamp();
    this._el.innerHTML = `<div class="sde-travel-bar">${this._slim()}${this._open ? this._panel() : ""}</div>`;
  },

  /** The time, sky and day as the bar reads them. */
  _now() {
    const now = game.time.worldTime;
    const cal = game.time.calendar;
    const api = game.shadowdarkEnhancer?.time;
    const c = cal.timeToComponents(now);
    const sun = api.sun(now);
    return {
      parts: dateParts(cal, now),
      sun,
      sky: skyPosition({ hour: c.hour + c.minute / 60, ...sun, hoursPerDay: cal.days?.hoursPerDay ?? 24 }),
      moon: api.moonPhase(now),
      season: api.season(now)?.name ?? "",
    };
  },

  _model() {
    const state = overlandState();
    const actors = {};
    for (const id of state.members) {
      const a = game.actors.get(id);
      if (a) actors[id] = { name: a.name, rations: a.items.filter((i) => /^rations?$/i.test(i.name)).reduce((n, i) => n + (Number(i.system?.quantity) || 0), 0) };
    }
    return barModel({
      state, actors, isGM: !!game.user.isGM,
      owns: (id) => !!game.actors.get(id)?.isOwner,
    });
  },

  _slim() {
    const { parts, sun, sky, moon } = this._now();
    const m = this._model();
    const date = t("SDE.overland.bar.date", { weekday: t(parts.weekday), day: parts.day, month: t(parts.month) });
    const skyText = sky.isDay
      ? t("SDE.overland.bar.sunSets", { time: hhmm(sun.sunset) })
      : t("SDE.overland.bar.moonUp", { phase: t(MOON_NAME[moon.key]), time: hhmm(sun.sunrise) });
    const weather = weatherNow();
    const cells = [
      `<span class="sde-travel-cell"><strong>${esc(date)}</strong> ${esc(parts.time)}</span>`,
      `<span class="sde-travel-cell"><i class="fas ${sky.isDay ? "fa-sun" : "fa-moon"}"></i> ${esc(skyText)}</span>`,
      `<span class="sde-travel-cell${m.stormy ? " sde-travel-stormy" : ""}">${esc(weather ? weatherName(weather) : t("SDE.overland.bar.noWeather"))}</span>`,
      `<span class="sde-travel-cell">${esc(m.dayOpen ? t("SDE.overland.bar.hexes", { left: m.hexesLeft, budget: m.budget }) : t("SDE.overland.bar.noDay"))}</span>`,
    ];
    return `<div class="sde-travel-slim">
      <button type="button" class="sde-travel-toggle" data-action="toggle" aria-expanded="${this._open}"
        data-tooltip="${esc(t(this._open ? "SDE.overland.bar.collapse" : "SDE.overland.bar.expand"))}">${cells.join("")}
        <i class="fas ${this._open ? "fa-chevron-up" : "fa-chevron-down"}"></i></button>
      ${m.pending ? button("resume", t("SDE.overland.resume"), { hint: t("SDE.overland.resumeHint"), cls: "sde-travel-go" }) : ""}
    </div>`;
  },

  /** The sky dome: the sun on its arc by day, the moon by its phase at night. */
  _dome({ sky, moon }) {
    const { x, y } = domePoint(sky.progress);
    const r = 6;
    const body = sky.isDay
      ? `<circle class="sde-dome-sun" cx="${x}" cy="${y}" r="${r}"/>`
      : `<clipPath id="sde-dome-moon-clip"><circle cx="${x}" cy="${y}" r="${r}"/></clipPath>
         <circle class="sde-dome-moon" cx="${x}" cy="${y}" r="${r}"/>
         <circle class="sde-dome-shadow" cx="${+(x + moonShadow(moon) * r).toFixed(2)}" cy="${y}" r="${r + 0.6}" clip-path="url(#sde-dome-moon-clip)"/>`;
    const { cx, cy, r: R } = DOME;
    return `<svg class="sde-travel-dome" viewBox="0 0 120 60" role="img" aria-label="${esc(t(sky.isDay ? "SDE.overland.bar.domeDay" : "SDE.overland.bar.domeNight"))}">
      <path class="sde-dome-arc" d="M${cx - R},${cy} A${R},${R} 0 0 1 ${cx + R},${cy}"/>
      <line class="sde-dome-horizon" x1="4" y1="${cy}" x2="116" y2="${cy}"/>${body}</svg>`;
  },

  _panel() {
    const now = this._now();
    const m = this._model();
    const gm = game.user.isGM;
    const row = (label, value) => `<div class="sde-travel-row"><span>${esc(label)}</span><span>${value}</span></div>`;
    const climate = [now.season, m.climate, m.harsh ? t("SDE.overland.bar.harsh") : ""].filter(Boolean).join(" · ");
    const method = [methodName(m.method), m.pushed ? t("SDE.overland.bar.pushed") : ""].filter(Boolean).join(", ");
    const members = m.members.map((p) => `<li>${esc(p.name)}: ${esc(t("SDE.overland.bar.rations", { n: p.rations }))}${
      p.foraged ? ` <em>${esc(t("SDE.overland.bar.foraged"))}</em>` : ""}${
      p.canForage ? ` ${button("forage", t("SDE.overland.forage.button"), { id: p.id, hint: t("SDE.overland.forage.buttonHint") })}` : ""}</li>`).join("");
    const checks = m.checks.map((c) => {
      const result = !c.rolled ? t("SDE.overland.bar.checkDue") : c.hit ? t("SDE.overland.bar.checkHit") : t("SDE.overland.bar.checkMiss");
      const label = t(c.half === "night" ? "SDE.overland.check.night" : "SDE.overland.check.day", { time: dateParts(game.time.calendar, c.at).time });
      return `<li>${esc(label)}: ${esc(result)}</li>`;
    }).join("");
    return `<div class="sde-travel-panel">
      ${this._dome(now)}
      <div class="sde-travel-rows">
        ${row(t("SDE.overland.bar.season"), esc(climate))}
        ${row(t("SDE.overland.bar.weather"), `${esc(weatherNow() ? weatherName(weatherNow()) : t("SDE.overland.bar.noWeather"))}${
          gm ? ` ${button("rollWeather", t("SDE.overland.bar.roll"), { hint: t("SDE.overland.rollWeatherHint") })} ${
            button("reroll", t("SDE.overland.bar.reroll"), { hint: t("SDE.overland.bar.rerollHint") })}` : ""}`)}
        ${row(t("SDE.overland.bar.method"), esc(m.dayOpen ? method : t("SDE.overland.bar.noDay")))}
        ${m.dayOpen ? row(t("SDE.overland.bar.budget"), `<span class="sde-travel-budget" role="img" aria-label="${
          esc(t("SDE.overland.bar.hexes", { left: m.hexesLeft, budget: m.budget }))}"><span style="width:${Math.round(m.leftShare * 100)}%"></span></span> ${
          esc(t("SDE.overland.bar.hexes", { left: m.hexesLeft, budget: m.budget }))}`) : ""}
        ${row(t("SDE.overland.bar.party"), `<ul class="sde-travel-list">${members}</ul>${
          m.mounts ? esc(t("SDE.overland.bar.mounts", { n: m.mounts })) : ""}`)}
        ${gm && checks ? row(t("SDE.overland.bar.checks"), `<ul class="sde-travel-list">${checks}</ul>`) : ""}
      </div>
      ${gm ? `<div class="sde-travel-actions">${[
        button("startDay", t("SDE.overland.startDay"), { hint: t("SDE.overland.startDayHint") }),
        button("makeCamp", t("SDE.overland.makeCamp"), { hint: t("SDE.overland.makeCampHint") }),
        button("endTravel", t("SDE.overland.endTravel"), { hint: t("SDE.overland.endTravelHint") }),
      ].join("")}</div>` : ""}
    </div>`;
  },

  async _onClick(event) {
    const el = event.target.closest("[data-action]");
    if (!el || !this._el.contains(el)) return;
    const warn = (reply) => { if (!reply?.ok && reply?.error) ui.notifications.warn(reply.error); };
    switch (el.dataset.action) {
      case "toggle": this._open = !this._open; return this.render();
      case "forage": return forage(el.dataset.id);
      case "resume": return warn(await resume());
      case "rollWeather": return warn(await rollWeather());
      case "reroll": return warn(await rollWeather({ reroll: true }));
      case "startDay": { const options = await askDay(); if (options) warn(await startDay(options)); return; }
      case "makeCamp": return warn(await makeCamp());
      case "endTravel": return endOverland();
      default: return undefined;
    }
  },
};
