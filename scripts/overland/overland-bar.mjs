/**
 * Shadowdark Enhancer — the clock HUD at the top of the screen (#253, #257,
 * Overland O8; the look is the demo Patrick signed up for, docs/plans/overland.md §4).
 *
 * Always on (the `clockBar` setting says for whom; nobody during a combat):
 * the date with its year, the time, and a chevron for the sky, which hangs
 * the season band and the dial under the bar: a disc turning a 24th of a turn
 * an hour, with now at the bottom, the day's light, the twilight hatched, the
 * weather on its plate and the moon on the outer track. A GM also gets the
 * rewind and advance columns (a day, 8 hours, an hour, 10 minutes, a round),
 * the Time panel (jump to the next dawn, noon, dusk or midnight; set a date;
 * the real-time clock) and every day of the Month view as a jump. On a tagged
 * hex map the bar carries the travel plate: the hexes left while travelling,
 * or Start travel for a GM, and the Travel panel.
 *
 * Moves: a step or a jump goes through Overland's clock action, so while
 * travelling the day's checks it passes roll at their hours; a date set or
 * picked in the month view goes forward off duty (torches don't burn through a
 * calendar jump), and any move backwards just sets the clock back.
 *
 * Mounted like the Crawl Strip: a click-transparent wrapper in #interface
 * whose column takes clicks. The Crawl Strip moves down under the bar while it
 * shows (body.sde-clock-on).
 */

import { CrawlState } from "../crawl-strip/crawl-state.mjs";
import { isHexMapScene } from "../encounter/encounter-terrain.mjs";
import { esc } from "../shared/esc.mjs";
import { MODULE_ID } from "../shared/module-id.mjs";
import {
  dateParts, hourOfDay, nextSeasonChange, nextTimeOfDay, secondsPerDay, season as seasonAt, startOfDay, sun as sunAt,
} from "../time/time-core.mjs";
import {
  overlandState, weatherNow, weatherName, methodName, rollWeather, askDay, startDay, makeCamp,
  endOverland, resume, forage, startOverland, advanceClock, OVERLAND_CHANGED,
} from "./overland.mjs";
import { barModel, itemTouchesBar, redrawStamp } from "./overland-bar-core.mjs";
import { DIAL, DIAL_STARS, clockShown, clockSteps, dateToTime, dialModel, monthGrid, seasonHatch, starPoint } from "./hud-core.mjs";

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
const MOON_MARK = { new: "SDE.clock.moon.new", q1: "SDE.clock.moon.firstQuarter", full: "SDE.clock.moon.full", q3: "SDE.clock.moon.lastQuarter" };
const JUMPS = { dawn: "SDE.clock.jump.dawn", noon: "SDE.clock.jump.noon", dusk: "SDE.clock.jump.dusk", midnight: "SDE.clock.jump.midnight" };

/** "19:10" from hours with a fraction. */
const hhmm = (hours) => {
  const minutes = Math.round(hours * 60);
  return `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
};

/** An icon button on the bar; `pressed` marks the panel or column it opened. */
const ib = (action, icon, label, { id = "", pressed = null } = {}) =>
  `<button type="button" class="sde-hud-ib" data-action="${action}"${id ? ` data-id="${id}"` : ""} aria-label="${esc(label)}" data-tooltip="${esc(label)}"${
    pressed === null ? "" : ` aria-pressed="${pressed}"`}><i class="fa-solid ${icon}"></i></button>`;

/** A key: the framed button of the panels. */
const key = (action, label, { id = "", hint = "", cls = "" } = {}) =>
  `<button type="button" class="sde-hud-key ${cls}" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ""}${
    hint ? ` data-tooltip="${esc(hint)}"` : ""}>${esc(label)}</button>`;

export const TravelBar = {
  _el: null,
  /** The open panel: "time", "month", "travel" or null. */
  _open: null,
  /** The rewind or advance column: "rew", "adv" or null. */
  _stack: null,
  /** Whether the season band and the dial hang under the bar. */
  _sky: true,
  _monthOffset: 0,
  /** The imported holidays, read when the month view opens. */
  _holidays: [],
  _drawn: "",
  _sceneKind: null,
  /** The Time panel's date, as the GM is typing it: kept across redraws. */
  _when: null,
  /** A move in flight: a second click waits for it rather than stacking on a stale clock. */
  _moving: false,

  init() {
    this.mount();
    const queue = () => this.render();
    Hooks.on(OVERLAND_CHANGED, queue);
    Hooks.on(CrawlState.HOOK_CHANGED, queue);
    Hooks.on(`${MODULE_ID}.clockBarChanged`, queue);
    for (const hook of ["createCombat", "updateCombat", "deleteCombat"]) Hooks.on(hook, queue);
    Hooks.on("pauseGame", () => { if (this._open === "time") this.render(); });
    Hooks.on("canvasReady", () => {
      // A new kind of scene starts the view afresh: the sky shows on a hex map, not in a dungeon.
      const kind = isHexMapScene() ? "hex" : "other";
      if (kind !== this._sceneKind) {
        this._sceneKind = kind;
        this._sky = kind === "hex";
        this._open = null;
        this._stack = null;
      }
      this.render();
    });
    // Real-time light tracking moves the clock every second: redraw on the
    // minute, but not under a GM typing a date (it catches up after).
    Hooks.on("updateWorldTime", () => {
      if (document.activeElement?.id === "sde-hud-when") return;
      if (this._stamp() !== this._drawn) this.render();
    });
    // A member's rations change when they forage, buy, trade or eat.
    const onItem = (item) => {
      if (this._open === "travel" && itemTouchesBar(item, overlandState().members)) this.render();
    };
    for (const hook of ["createItem", "updateItem", "deleteItem"]) Hooks.on(hook, onItem);
  },

  mount() {
    if (document.getElementById(BAR_ID)) { this._el = document.getElementById(BAR_ID); return; }
    const el = document.createElement("div");
    el.id = BAR_ID;
    (document.getElementById("interface") ?? document.body).prepend(el);
    el.addEventListener("click", (event) => this._onClick(event));
    el.addEventListener("change", (event) => this._onChange(event));
    el.addEventListener("input", (event) => { if (event.target.id === "sde-hud-when") this._when = event.target.value; });
    this._el = el;
    this._sceneKind = isHexMapScene() ? "hex" : "other";
    this._sky = this._sceneKind === "hex";
    this.render();
    // Centred over #ui-middle, the canvas between the left and right UI columns.
    const bounds = () => {
      const iface = document.getElementById("interface");
      const middle = document.getElementById("ui-middle");
      if (!iface || !middle || !this._el) return;
      const box = iface.getBoundingClientRect(), mid = middle.getBoundingClientRect();
      this._el.style.left = `${mid.left - box.left}px`;
      this._el.style.width = `${mid.width}px`;
    };
    window.addEventListener("resize", bounds);
    for (const hook of ["collapseSidebar", "renderSidebar", "renderSceneNavigation"]) Hooks.on(hook, () => setTimeout(bounds, 350));
    bounds();
  },

  /** What a redraw on the clock depends on: the minute, the weather, and the pending encounter. */
  _stamp() {
    return redrawStamp(game.time.worldTime, game.time.calendar?.days?.secondsPerMinute, weatherNow(),
      CrawlState.isOverland ? overlandState().pending : null);
  },

  _shown() {
    let setting = "all";
    try { setting = game.settings.get(MODULE_ID, "clockBar"); } catch { /* not registered yet */ }
    const combat = CrawlState.mode === "combat" || !!game.combat?.started;
    return clockShown({ setting, isGM: !!game.user?.isGM, combat });
  },

  render() {
    if (!this._el) return;
    const shown = this._shown();
    this._el.classList.toggle("sde-hud-visible", shown);
    document.body.classList.toggle("sde-clock-on", shown);
    if (!shown) { this._el.innerHTML = ""; return; }
    this._drawn = this._stamp();
    const gm = !!game.user.isGM;
    if (!gm) this._stack = null;
    if ((this._open === "time" && !gm) || (this._open === "travel" && !CrawlState.isOverland)) this._open = null;
    this._el.innerHTML = `<div class="sde-hud-col">${this._bar()}${this._stacks()}<div class="sde-hud-drop">${this._drop()}</div></div>`;
  },

  /** The time and sky as the HUD reads them. */
  _now() {
    const now = game.time.worldTime;
    const cal = game.time.calendar;
    const api = game.shadowdarkEnhancer?.time;
    return {
      now, cal,
      parts: dateParts(cal, now),
      hour: hourOfDay(cal, now),
      sun: sunAt(cal, now),
      moon: api.moonPhase(now),
      hoursPerDay: cal.days?.hoursPerDay ?? 24,
    };
  },

  _bar() {
    const gm = game.user.isGM;
    const { parts } = this._now();
    const state = overlandState();
    const date = t("SDE.clock.date", { weekday: t(parts.weekday), day: parts.day, month: t(parts.month), year: parts.year });
    const stopped = gm && state.pending && CrawlState.isOverland ? `<span class="sde-hud-stopped">${esc(t("SDE.clock.stopped"))}</span>` : "";
    let travel = "";
    if (isHexMapScene()) {
      const cell = CrawlState.isOverland
        ? `<button type="button" class="sde-hud-plate" data-action="open" data-id="travel"><i class="fa-solid fa-hexagon"></i> ${this._plateText(state)}</button>`
        : gm && CrawlState.mode === "off" ? `<button type="button" class="sde-hud-go" data-action="startTravel"><i class="fa-solid fa-hexagon"></i> ${esc(t("SDE.overland.startTravel"))}</button>` : "";
      travel = `<span class="sde-hud-sep"></span>${cell}${CrawlState.isOverland
        ? ib("open", "fa-users", t("SDE.clock.travel"), { id: "travel", pressed: this._open === "travel" }) : ""}`;
    }
    return `<div class="sde-hud-bar">
      ${gm ? ib("stack", "fa-backward", t("SDE.clock.rewind"), { id: "rew", pressed: this._stack === "rew" }) : ""}
      ${ib("open", "fa-calendar-days", t("SDE.clock.month"), { id: "month", pressed: this._open === "month" })}
      ${gm ? ib("open", "fa-sliders", t("SDE.clock.time"), { id: "time", pressed: this._open === "time" }) : ""}
      <span class="sde-hud-sep"></span>
      <span class="sde-hud-date"><span class="sde-hud-d">${esc(date)}</span><span class="sde-hud-t">${esc(parts.time)}</span>${stopped}</span>
      ${ib("sky", this._sky ? "fa-chevron-up" : "fa-chevron-down", t(this._sky ? "SDE.clock.skyHide" : "SDE.clock.skyShow"), { pressed: this._sky })}
      ${travel}
      ${gm ? ib("stack", "fa-forward", t("SDE.clock.advance"), { id: "adv", pressed: this._stack === "adv" }) : ""}
    </div>`;
  },

  /** The travel plate's words, by where the day stands. */
  _plateText(state) {
    const m = this._model();
    if (state.pending) return esc(t("SDE.clock.plate.encounter"));   // only drawn while travelling
    if (!m.dayOpen) return esc(t("SDE.clock.plate.noDay"));
    return t("SDE.clock.plate.hexes", { left: `<b>${m.hexesLeft}</b>`, budget: `<b>${m.budget}</b>` })
      + (m.pushed ? esc(t("SDE.clock.plate.pushed")) : "");
  },

  _stacks() {
    if (!game.user.isGM || !this._stack) return "";
    const back = this._stack === "rew";
    const buttons = clockSteps(game.time.calendar, CONFIG.time?.roundTime || 6)
      .map((s) => `<button type="button" data-action="step" data-id="${back ? -s.seconds : s.seconds}">${esc(t(back ? "SDE.clock.back" : "SDE.clock.forward", { step: t(s.key) }))}</button>`);
    return `<div class="sde-hud-stack ${back ? "sde-hud-left" : "sde-hud-right"}">${buttons.join("")}</div>`;
  },

  _drop() {
    if (this._open === "time") return this._timePanel();
    if (this._open === "month") return this._monthPanel();
    if (this._open === "travel") return this._travelPanel();
    return this._sky ? `${this._seasonBand()}${this._dial()}` : "";
  },

  _seasonBand() {
    const { now, cal } = this._now();
    const here = seasonAt(cal, now);
    const change = nextSeasonChange(cal, now);
    const name = here.name ? t(here.name) : "";
    if (change === null) return `<div class="sde-hud-season">${esc(name)}</div>`;
    const daysLeft = Math.max(0, Math.ceil((change - now) / secondsPerDay(cal)));
    const hatch = seasonHatch(daysLeft);
    const tip = t(daysLeft === 1 ? "SDE.clock.seasonNextOne" : "SDE.clock.seasonNext", { season: t(seasonAt(cal, change).name ?? ""), n: daysLeft });
    return `<div class="sde-hud-season" data-tooltip="${esc(tip)}">${esc(name)}${hatch ? `<span class="sde-hud-next" style="width:${hatch}%"></span>` : ""}</div>`;
  },

  /** The sky dial: the mockup's, driven by the time API. */
  _dial() {
    const { now, cal, hour, sun, moon, hoursPerDay } = this._now();
    const d = dialModel({ hour, sunrise: sun.sunrise, sunset: sun.sunset, moonFraction: moon.fraction, hoursPerDay });
    const w = weatherNow();
    const word = w ? weatherName(w) : t("SDE.clock.unrolled");
    const plateW = Math.max(70, word.length * 11 + 22);
    const tomorrow = sunAt(cal, startOfDay(cal, now) + secondsPerDay(cal));
    const sunLine = d.next.kind === "sets"
      ? t("SDE.clock.sunSets", { time: hhmm(d.next.hour) })
      : t("SDE.clock.sunRises", { time: hhmm(d.next.hour ?? tomorrow.sunrise) });
    const state = overlandState();
    const region = CrawlState.isOverland && isHexMapScene() ? [state.hex?.region, state.hex?.terrain].filter(Boolean).join(" · ") : "";
    const ink = d.isDay ? "sde-hud-ink-day" : "sde-hud-ink-night";
    const { cx, cy } = DIAL;
    const stars = DIAL_STARS.map((s) => { const [x, y] = starPoint(s, hoursPerDay); return `<circle cx="${x}" cy="${y}" r="1.1" class="sde-hud-star"/>`; }).join("");
    const label = t("SDE.clock.dialLabel", { weather: word, sun: sunLine, moon: t(MOON_NAME[moon.key]) });
    return `<svg class="sde-hud-dial ${ink}" width="260" height="140" viewBox="0 0 260 140" role="img" aria-label="${esc(label)}">
      <defs>
        <pattern id="sde-hud-hatch" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="5" height="5" fill="#0b0b0b"/><line x1="0" y1="0" x2="0" y2="5" stroke="#c9c9c9" stroke-width="1"/></pattern>
        <linearGradient id="sde-hud-dayg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ececec"/><stop offset="1" stop-color="#b8b8b8"/></linearGradient>
        <clipPath id="sde-hud-disc"><circle cx="${cx}" cy="${cy}" r="${DIAL.disc}"/></clipPath>
        <clipPath id="sde-hud-moonc"><circle cx="${d.moon.x}" cy="${d.moon.y}" r="${d.moon.r}"/></clipPath>
      </defs>
      <circle cx="${cx}" cy="${cy}" r="${DIAL.moonTrack}" class="sde-hud-track"/>
      <g clip-path="url(#sde-hud-disc)"><g transform="rotate(${d.rotate} ${cx} ${cy})">
        <circle cx="${cx}" cy="${cy}" r="${DIAL.disc}" fill="#0b0b0b"/>${stars}
        <path d="${d.day}" fill="url(#sde-hud-dayg)"/><path d="${d.dusk}" fill="url(#sde-hud-hatch)"/><path d="${d.dawn}" fill="url(#sde-hud-hatch)"/>
      </g></g>
      <circle cx="${cx}" cy="${cy}" r="${DIAL.disc}" fill="none" stroke="#c9c9c9" stroke-width="1"/>
      <circle cx="${cx}" cy="${cy}" r="91" fill="none" stroke="#000" stroke-width="9"/>
      <circle cx="${cx}" cy="${cy}" r="96" fill="none" stroke="#c9c9c9" stroke-width="2"/>
      <circle cx="${cx}" cy="${cy}" r="99" fill="none" stroke="#555555" stroke-width="1"/>
      <rect x="${cx - plateW / 2}" y="27" width="${plateW}" height="27" rx="3" fill="#000" stroke="#c9c9c9" stroke-width="1.5"/>
      <rect x="${cx + 3 - plateW / 2}" y="30" width="${plateW - 6}" height="21" rx="2" fill="none" stroke="rgba(201,201,201,.25)"/>
      <text x="${cx}" y="47" text-anchor="middle" class="sde-hud-word">${esc(word)}</text>
      ${region ? `<text x="${cx}" y="68" text-anchor="middle" class="sde-hud-region"${
        // A long region and terrain are squeezed to the disc rather than spilling over its rim.
        region.length > 18 ? ` textLength="120" lengthAdjust="spacingAndGlyphs"` : ""}>${esc(region.toUpperCase())}</text>` : ""}
      <text x="${cx}" y="${region ? 82 : 72}" text-anchor="middle" class="sde-hud-sunline">${esc(sunLine)}</text>
      <path transform="translate(${cx} 105)" d="M0 -9 L2.2 -2.2 L9 0 L2.2 2.2 L0 9 L-2.2 2.2 L-9 0 L-2.2 -2.2 Z" fill="#ffffff" stroke="#000" stroke-width="1"/>
      <g clip-path="url(#sde-hud-moonc)"><circle cx="${d.moon.x}" cy="${d.moon.y}" r="${d.moon.r}" fill="#f0f0f0"/><circle cx="${+(d.moon.x + d.moon.shadow).toFixed(1)}" cy="${d.moon.y}" r="${d.moon.r}" fill="#000"/></g>
      <circle cx="${d.moon.x}" cy="${d.moon.y}" r="${d.moon.r}" fill="none" stroke="#000" stroke-width="1"/>
    </svg>`;
  },

  _timePanel() {
    const { now, cal, parts } = this._now();
    const c = cal.timeToComponents(now);
    const pad = (n) => String(n).padStart(2, "0");
    const value = `${String(parts.year).padStart(4, "0")}-${pad(c.month + 1)}-${pad(parts.day)}T${parts.time}`;
    let realtime = false, tracking = true;
    try { realtime = !!game.settings.get("shadowdark", "realtimeLightTracking"); } catch { /* not the Shadowdark system */ }
    try { tracking = game.settings.get("shadowdark", "trackLightSources") !== false; } catch { /* idem */ }
    // The system's own test: Foundry's pause stops its clock when pauseLightTrackingWithGame says so.
    const paused = realtime && (game.shadowdark?.lightSourceTracker?.realTime?.isPaused?.() ?? game.paused);
    const jumps = Object.entries(JUMPS).map(([id, k]) => key("jump", t(k), { id, cls: "sde-hud-sm" })).join("");
    return `<div class="sde-hud-panel sde-hud-narrow">
      <div class="sde-hud-ph"><span class="sde-hud-ttl">${esc(t("SDE.clock.time"))}</span>
        <span class="sde-hud-cap">${esc(t("SDE.clock.date", { weekday: t(parts.weekday), day: parts.day, month: t(parts.month), year: parts.year }))} · <b>${esc(parts.time)}</b></span></div>
      <div class="sde-hud-pb">
        <span class="sde-hud-cap">${esc(t("SDE.clock.jumpTo"))}</span>
        <div class="sde-hud-grid4">${jumps}</div>
        <label class="sde-hud-cap" for="sde-hud-when">${esc(t("SDE.clock.setDate"))}</label>
        <div class="sde-hud-row"><input class="sde-hud-field" id="sde-hud-when" type="text" spellcheck="false"
          placeholder="YYYY-MM-DDTHH:MM" value="${esc(this._when ?? value)}" data-tooltip="${esc(t("SDE.clock.dateFormat"))}">${key("setTime", t("SDE.clock.set"), { cls: "sde-hud-sm" })}</div>
        <label class="sde-hud-check"><input type="checkbox" data-action="realtime" ${realtime ? "checked" : ""} ${tracking ? "" : "disabled"}>
          <span>${esc(t("SDE.clock.realtime"))}</span><span class="sde-hud-cap">${esc(t(paused ? "SDE.clock.paused" : "SDE.clock.lightTracking"))}</span></label>
        <span class="sde-hud-fl">${esc(t("SDE.clock.timeNote"))}</span>
      </div>
    </div>`;
  },

  _monthPanel() {
    const { now, cal } = this._now();
    const gm = game.user.isGM;
    let epoch = 0;
    try { epoch = Number(game.settings.get(MODULE_ID, "moonEpoch")) || 0; } catch { /* default */ }
    const holidaysOn = (date) => this._holidays.filter((h) => this._whenMatches?.(h.when, date)).map((h) => h.name);
    const g = monthGrid(cal, now, { offset: this._monthOffset, epoch, holidaysOn });
    const heads = g.weekdays.map((w) => `<div class="sde-hud-dow">${esc(t(w))}</div>`).join("");
    const cells = g.cells.map((cell) => {
      if (cell.out) return `<div class="sde-hud-day sde-hud-out">${cell.day}</div>`;
      const mark = cell.moon ? `<span class="sde-hud-m sde-hud-m-${cell.moon}" data-tooltip="${esc(t(MOON_MARK[cell.moon]))}"></span>` : "";
      const hol = cell.holidays.length ? `<span class="sde-hud-h">${esc(cell.holidays.join(", "))}</span>` : "";
      const cls = `sde-hud-day${cell.today ? " sde-hud-today" : ""}`;
      return gm
        ? `<button type="button" class="${cls}" data-action="goto" data-id="${cell.at}" aria-label="${esc(t("SDE.clock.goTo", { day: cell.day, month: t(g.month) }))}">${cell.day}${mark}${hol}</button>`
        : `<div class="${cls}">${cell.day}${mark}${hol}</div>`;
    }).join("");
    const season = cal.seasons?.values?.[g.season]?.name;
    const notes = [
      g.fullMoon ? t("SDE.clock.fullMoonOn", { day: g.fullMoon }) : "",
      gm ? t("SDE.clock.clickDay") : "",
      this._holidays.length ? "" : t("SDE.clock.noHolidays"),
    ].filter(Boolean).join(" ");
    return `<div class="sde-hud-panel sde-hud-wide">
      <div class="sde-hud-ph sde-hud-ph-row">
        ${key("month", "‹", { id: "-1", cls: "sde-hud-sm", hint: t("SDE.clock.prevMonth") })}
        <span class="sde-hud-ttl">${esc(`${t(g.month)} ${g.year}`)}</span>${season ? `<span class="sde-hud-cap">${esc(t(season))}</span>` : ""}
        ${key("month", "›", { id: "1", cls: "sde-hud-sm", hint: t("SDE.clock.nextMonth") })}
      </div>
      <div class="sde-hud-pb"><div class="sde-hud-mgrid" style="grid-template-columns:repeat(${g.weekdays.length || 7},minmax(0,1fr))">${heads}${cells}</div>
        <span class="sde-hud-fl">${esc(notes)}</span></div>
    </div>`;
  },

  _model() {
    const state = overlandState();
    const actors = {};
    for (const id of state.members) {
      const a = game.actors.get(id);
      if (a) actors[id] = { name: a.name, rations: a.items.filter((i) => /^rations?$/i.test(i.name)).reduce((n, i) => n + (Number(i.system?.quantity) || 0), 0) };
    }
    return barModel({ state, actors, isGM: !!game.user.isGM, owns: (id) => !!game.actors.get(id)?.isOwner });
  },

  /** The day as it stands. The eight steps of the book's procedure come next (#257). */
  _travelPanel() {
    const { now, cal } = this._now();
    const m = this._model();
    const gm = game.user.isGM;
    const row = (label, value) => `<div class="sde-hud-trow"><span class="sde-hud-cap">${esc(label)}</span><span>${value}</span></div>`;
    const climate = [t(seasonAt(cal, now).name ?? ""), m.climate, m.harsh ? t("SDE.overland.bar.harsh") : ""].filter(Boolean).join(" · ");
    const method = [methodName(m.method), m.pushed ? t("SDE.overland.bar.pushed") : ""].filter(Boolean).join(", ");
    const members = m.members.map((p) => `<div class="sde-hud-member"><span class="sde-hud-n">${esc(p.name)}</span>
      <span>${esc(t("SDE.overland.bar.rations", { n: p.rations }))}</span>${p.foraged ? `<span class="sde-hud-chip">${esc(t("SDE.overland.bar.foraged"))}</span>` : ""}
      ${p.canForage ? key("forage", t("SDE.overland.forage.button"), { id: p.id, hint: t("SDE.overland.forage.buttonHint"), cls: "sde-hud-sm" }) : ""}</div>`).join("");
    const checks = m.checks.map((c) => {
      const result = !c.rolled ? t("SDE.overland.bar.checkDue") : c.hit ? t("SDE.overland.bar.checkHit") : t("SDE.overland.bar.checkMiss");
      const label = t(c.half === "night" ? "SDE.overland.check.night" : "SDE.overland.check.day", { time: dateParts(cal, c.at).time });
      return `<div class="sde-hud-checkrow"><span class="sde-hud-dot ${c.rolled ? (c.hit ? "sde-hud-hit" : "sde-hud-miss") : ""}"></span>${esc(label)}: ${esc(result)}</div>`;
    }).join("");
    const weather = weatherNow();
    return `<div class="sde-hud-panel sde-hud-travel">
      <div class="sde-hud-ph"><span class="sde-hud-ttl">${esc(t("SDE.clock.travel"))}</span>
        <span class="sde-hud-cap">${esc([overlandState().hex?.region, climate].filter(Boolean).join(" · "))}</span></div>
      <div class="sde-hud-pb">
        ${row(t("SDE.overland.bar.weather"), `${esc(weather ? weatherName(weather) : t("SDE.overland.bar.noWeather"))}${gm
          ? ` ${key("rollWeather", t("SDE.overland.bar.roll"), { hint: t("SDE.overland.rollWeatherHint"), cls: "sde-hud-sm" })} ${
            key("reroll", t("SDE.overland.bar.reroll"), { hint: t("SDE.overland.bar.rerollHint"), cls: "sde-hud-sm" })}` : ""}`)}
        ${row(t("SDE.overland.bar.method"), esc(m.dayOpen ? method : t("SDE.overland.bar.noDay")))}
        ${m.dayOpen ? row(t("SDE.overland.bar.budget"), `<span class="sde-hud-meter" role="img" aria-label="${
          esc(t("SDE.overland.bar.hexes", { left: m.hexesLeft, budget: m.budget }))}"><span style="width:${Math.round(m.leftShare * 100)}%"></span></span> ${
          esc(t("SDE.overland.bar.hexes", { left: m.hexesLeft, budget: m.budget }))}`) : ""}
        <span class="sde-hud-cap">${esc(t("SDE.overland.bar.party"))}${m.mounts ? ` · ${esc(t("SDE.overland.bar.mounts", { n: m.mounts }))}` : ""}</span>
        ${members}
        ${gm && checks ? `<span class="sde-hud-cap">${esc(t("SDE.overland.bar.checks"))}</span>${checks}` : ""}
      </div>
      ${gm ? `<div class="sde-hud-pf">${m.pending ? key("resume", t("SDE.overland.resume"), { hint: t("SDE.overland.resumeHint"), cls: "sde-hud-primary" }) : ""}${[
        key("startDay", t("SDE.overland.startDay"), { hint: t("SDE.overland.startDayHint") }),
        key("makeCamp", t("SDE.overland.makeCamp"), { hint: t("SDE.overland.makeCampHint") }),
        `<span class="sde-hud-grow"></span>`,
        key("endTravel", t("SDE.overland.endTravel"), { hint: t("SDE.overland.endTravelHint"), cls: "sde-hud-ghost" }),
      ].join("")}</div>` : ""}
    </div>`;
  },

  /**
   * Move the clock: a step by `seconds`, or a jump `to` a worldTime, through
   * Overland's clock action. A calendar jump forward goes off duty: all of it
   * when not travelling (off duty warns for itself); while travelling the
   * lights go out first, and the day's checks still roll on the way.
   */
  async _move(seconds, { to = null, calendar = false } = {}) {
    if (this._moving) return;
    this._moving = true;
    try {
      const ahead = to !== null ? to - game.time.worldTime : seconds;
      if (!ahead) return;
      if (calendar && ahead > 0) {
        const offDuty = game.shadowdarkEnhancer.time.advanceOffDuty;
        if (!CrawlState.isOverland) { await offDuty(ahead, { reason: "calendar" }); return; }
        if (!(await offDuty(0, { reason: "calendar" }))?.ok) return;
      }
      const reply = to !== null ? await advanceClock(null, { to }) : await advanceClock(seconds);
      if (!reply?.ok && reply?.error) ui.notifications.warn(reply.error);
    } finally {
      this._moving = false;
    }
  },

  async _onClick(event) {
    const el = event.target.closest("[data-action]");
    if (!el || !this._el.contains(el) || el.matches("input")) return;
    const id = el.dataset.id;
    const warn = (reply) => { if (!reply?.ok && reply?.error) ui.notifications.warn(reply.error); };
    switch (el.dataset.action) {
      case "open":
        this._open = this._open === id ? null : id;
        this._when = null;
        if (this._open === "month") {
          this._monthOffset = 0;
          await this._loadHolidays();
        }
        return this.render();
      case "stack": this._stack = this._stack === id ? null : id; return this.render();
      case "sky": this._sky = !this._sky; this._open = null; return this.render();
      case "month": this._monthOffset += Number(id) || 0; return this.render();
      case "step": return this._move(Number(id));
      case "jump": return this._move(null, { to: nextTimeOfDay(game.time.calendar, game.time.worldTime, id) });
      case "goto": {
        const cal = game.time.calendar, now = game.time.worldTime;
        return this._move(null, { to: Number(id) + (now - startOfDay(cal, now)), calendar: true });
      }
      case "setTime": {
        const target = this._parseWhen(this._el.querySelector("#sde-hud-when")?.value);
        if (target === null) return ui.notifications.warn(t("SDE.clock.badDate"));
        this._when = null;
        return this._move(null, { to: target, calendar: true });
      }
      case "startTravel": {
        const started = await startOverland();
        if (started) this._open = "travel";
        if (started && !Number.isFinite(overlandState().day)) {
          const options = await askDay();
          if (options) warn(await startDay(options));
        }
        return this.render();
      }
      case "forage": return forage(id);
      case "resume": return warn(await resume());
      case "rollWeather": return warn(await rollWeather());
      case "reroll": return warn(await rollWeather({ reroll: true }));
      case "startDay": { const options = await askDay(); if (options) warn(await startDay(options)); return; }
      case "makeCamp": return warn(await makeCamp());
      case "endTravel": this._open = null; return endOverland();
      default: return undefined;
    }
  },

  async _onChange(event) {
    const el = event.target;
    if (el?.dataset?.action !== "realtime" || !game.user.isGM) return;
    await game.settings.set("shadowdark", "realtimeLightTracking", !!el.checked).catch((err) => {
      console.error(`${MODULE_ID} | real-time clock`, err);
      el.checked = !el.checked;
    });
    this.render();
  },

  /** "YYYY-MM-DDTHH:MM" (the year as shown; a space for the T is fine) to a worldTime, or null. */
  _parseWhen(value) {
    const m = /^(-?\d{1,6})-(\d{1,2})-(\d{1,2})[T ](\d{1,2}):(\d{2})$/.exec(String(value ?? "").trim());
    if (!m) return null;
    const [, y, mo, d, h, mi] = m.map(Number);
    return dateToTime(game.time.calendar, { year: y, month: mo, day: d, hour: h, minute: mi });
  },

  async _loadHolidays() {
    try {
      const mod = await import("../holidays/holidays.mjs");
      this._whenMatches = mod.whenMatches;
      this._holidays = await mod.listHolidays();
    } catch (err) {
      console.warn(`${MODULE_ID} | clock: holidays not read`, err);
      this._holidays = [];
    }
  },
};
