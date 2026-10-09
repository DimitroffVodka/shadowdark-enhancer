/**
 * Shadowdark Enhancer — the clock HUD at the top of the screen (#253, #257,
 * Overland O8; the look is the demo Patrick signed up for, docs/plans/overland.md §4).
 *
 * On a hex map only (#298), whatever the scene's tags: the `clockBar` setting
 * says for whom, and nobody sees it during a combat or on a scene with no hex
 * grid. The date with its year, the time, and a chevron for the sky, which hangs
 * the season band and the dial under the bar: a disc turning a 24th of a turn
 * an hour, with now at the bottom, the day's light, the twilight hatched, the
 * weather on its plate and the moon on the outer track. A GM also gets the
 * rewind and advance columns (a day, 8 hours, an hour, 10 minutes, a round),
 * the Time panel (jump to the next dawn, noon, dusk or midnight; set a date;
 * the real-time clock) and every day of the Month view as a jump. The bar
 * carries the travel plate: the hexes left while travelling,
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
  overlandState, weatherNow, weatherName, methodName, rollWeather, startDayFromParty, setTravelPace, partyReading, makeCamp,
  endOverland, resume, forage, startOverland, advanceClock, checkNow, encounterSettings, ENCOUNTER_SETTINGS, OVERLAND_CHANGED,
} from "./overland.mjs";
import { barModel, itemTouchesBar, redrawStamp, hhmm } from "./overland-bar-core.mjs";
import { travelPanel } from "./travel-panel.mjs";
import { encounterCard, encounterPanel, encounterStrip } from "./encounter-panel.mjs";
import { postEncounter } from "../encounter/encounter-draw.mjs";
import { DIAL, DIAL_STARS, clockShown, clockSteps, dateToTime, dialModel, monthGrid, seasonHatch, starPoint } from "./hud-core.mjs";
import { L as t } from "../shared/i18n.mjs";
import { moonEpoch } from "../time/time.mjs";
import { dayEvents, paragraphs } from "../calendar/calendar-core.mjs";
import { holyWindows } from "../holidays/holy-days.mjs";
import { gmOnlyKeys, holidayEffects, setGmOnly } from "../holidays/holidays.mjs";
import { CALENDAR_CHANGED, addCalendarEntry, calendarEntries, removeCalendarEntry } from "../calendar/calendar.mjs";

const BAR_ID = "shadowdark-enhancer-travel";

/** The ids of the fields a GM types in: the clock does not redraw under them. */
const TYPING = /^sde-hud-[de]-/;

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
/** What the month view's agenda calls each sky event and entry kind (literal keys, so i18n-keys can see them). */
const SOLAR_NAME = {
  springEquinox: "SDE.calendar.solar.springEquinox",
  summerSolstice: "SDE.calendar.solar.summerSolstice",
  autumnEquinox: "SDE.calendar.solar.autumnEquinox",
  winterSolstice: "SDE.calendar.solar.winterSolstice",
};
const ECLIPSE_NAME = {
  St: "SDE.calendar.eclipse.solarTotal", Sa: "SDE.calendar.eclipse.solarAnnular", Sp: "SDE.calendar.eclipse.solarPartial",
  Lt: "SDE.calendar.eclipse.lunarTotal", Lp: "SDE.calendar.eclipse.lunarPartial",
};
const KIND_NAME = {
  note: "SDE.calendar.kind.note", quest: "SDE.calendar.kind.quest", travel: "SDE.calendar.kind.travel", encounter: "SDE.calendar.kind.encounter",
};
const SEASON_NAME = {
  spring: "SDE.calendar.season.spring", summer: "SDE.calendar.season.summer", autumn: "SDE.calendar.season.autumn", winter: "SDE.calendar.season.winter",
};
const HOLY_PART = {
  early: "SDE.calendar.holy.part.early", mid: "SDE.calendar.holy.part.mid", late: "SDE.calendar.holy.part.late",
  earlyMid: "SDE.calendar.holy.part.earlyMid", whole: "SDE.calendar.holy.part.whole",
};
const KIND_ICON = { note: "fa-note-sticky", quest: "fa-scroll", travel: "fa-route", encounter: "fa-dragon" };
const JUMPS = { dawn: "SDE.clock.jump.dawn", noon: "SDE.clock.jump.noon", dusk: "SDE.clock.jump.dusk", midnight: "SDE.clock.jump.midnight" };

/** An icon button on the bar; `pressed` marks the panel or column it opened. */
const ib = (action, icon, label, { id = "", pressed = null } = {}) =>
  `<button type="button" class="sde-hud-ib" data-action="${action}"${id ? ` data-id="${id}"` : ""} aria-label="${esc(label)}" data-tooltip="${esc(label)}"${
    pressed === null ? "" : ` aria-pressed="${pressed}"`}><i class="fa-solid ${icon}"></i></button>`;

/** A key: the framed button of the panels. */
const key = (action, label, { id = "", hint = "", cls = "", aria = "" } = {}) =>
  `<button type="button" class="sde-hud-key ${cls}" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ""}${
    aria ? ` aria-label="${esc(aria)}"` : ""}${hint ? ` data-tooltip="${esc(hint)}"` : ""}>${esc(label)}</button>`;

export const TravelBar = {
  _el: null,
  /** The open panel: "time", "month", "travel", "encounter" or null. */
  _open: null,
  /** The hour of the encounter this client last opened the panel for: a new one opens it again. */
  _encAt: null,
  /** The rewind or advance column: "rew", "adv" or null. */
  _stack: null,
  /** Whether the season band and the dial hang under the bar. */
  _sky: true,
  _monthOffset: 0,
  /** The travel step the viewer opened, or null for the day's own. */
  _see: null,
  /** Whether a GM opened the Encounters step's Adjust rows. */
  _adjust: false,
  /** The imported holidays, read when the month view opens. */
  _holidays: [],
  /** The holy days whose deity pages are imported, read with them. */
  _holy: [],
  /** What the month view shows the detail of: `{ at }` a day, or `{ holy }` a holy day's key; null for none. */
  _info: null,
  /** Imported pages read for the detail, by uuid: their paragraphs, or null while they load. */
  _text: new Map(),
  _drawn: "",
  _sceneKind: null,
  /** Whether the month view shows its day, month and year fields (a GM clicked the title). */
  _dateEdit: false,
  /** The month view's new entry, as the GM is typing it: kept across redraws. */
  _draft: null,
  /** A move in flight: a second click waits for it rather than stacking on a stale clock. */
  _moving: false,

  init() {
    // The encounter already held when this client starts isn't new: only a later hit opens the panel.
    this._encAt = overlandState().encounter?.at ?? null;
    this.mount();
    const queue = () => this.render();
    Hooks.on(OVERLAND_CHANGED, (state) => {
      // A check that hit opens its panel for the GMs, over whatever was open.
      const at = state?.encounter?.at ?? null;
      if (at !== this._encAt) {
        this._encAt = at;
        if (at !== null && game.user.isGM) { this._open = "encounter"; this._stack = null; }
      }
      this.render();
    });
    Hooks.on(CrawlState.HOOK_CHANGED, queue);
    Hooks.on(`${MODULE_ID}.clockBarChanged`, queue);
    Hooks.on(CALENDAR_CHANGED, () => { if (this._open === "month") this.render(); });
    // A GM changed what players may see of the holidays: an open month view catches up.
    Hooks.on(`${MODULE_ID}.calendarLoreChanged`, async () => {
      if (this._open !== "month" || game.user.isGM) return;
      await this._loadHolidays();
      this.render();
    });
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
    // minute, but not under a GM typing a date (focusout catches up).
    Hooks.on("updateWorldTime", () => {
      if (TYPING.test(document.activeElement?.id ?? "")) return;
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
    el.addEventListener("input", (event) => {
      const { id, type, checked, value } = event.target;
      if (id?.startsWith("sde-hud-e-")) (this._draft ??= {})[id.slice(10)] = type === "checkbox" ? checked : value;
    });
    // Enter in the date fields sets the date.
    el.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && event.target.id?.startsWith("sde-hud-d-")) this._setDate();
      // A line of the agenda is a button to a keyboard.
      else if ((event.key === "Enter" || event.key === " ") && event.target.matches?.("li[data-action]")) { event.preventDefault(); event.target.click(); }
    });
    // Leaving a field redraws what the minute skipped; not when moving onto its button, mid-click.
    el.addEventListener("focusout", (event) => {
      if (!TYPING.test(event.target.id ?? "") || this._el.contains(event.relatedTarget)) return;
      if (this._stamp() !== this._drawn) this.render();
    });
    this._el = el;
    this._sceneKind = isHexMapScene() ? "hex" : "other";
    this._sky = this._sceneKind === "hex";
    this.render();
    // Centred over the canvas (#ui-middle), and no wider than the room between
    // the scene list and the sidebar either side of that centre, so on a narrow
    // screen it neither covers them nor runs under them (the bar shrinks).
    const bounds = () => {
      const iface = document.getElementById("interface");
      if (!iface || !this._el) return;
      const box = iface.getBoundingClientRect();
      const mid = document.getElementById("ui-middle")?.getBoundingClientRect();
      const centre = (mid ? (mid.left + mid.right) / 2 : (box.left + box.right) / 2) - box.left;
      const lo = (document.getElementById("scene-navigation")?.getBoundingClientRect().right ?? box.left) - box.left;
      const hi = (document.getElementById("sidebar")?.getBoundingClientRect().left ?? box.right) - box.left;
      const half = Math.max(0, Math.min(centre - lo, hi - centre));
      this._el.style.left = `${centre - half}px`;
      this._el.style.width = `${2 * half}px`;
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
    return clockShown({ setting, isGM: !!game.user?.isGM, combat, hex: isHexMapScene() });
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
    if (this._open === "encounter" && !(gm && overlandState().encounter)) this._open = null;
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
        ? `<button type="button" class="sde-hud-plate" data-action="open" data-id="${gm && state.encounter ? "encounter" : "travel"}"><i class="fa-solid fa-hexagon"></i> ${this._plateText()}</button>`
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
  _plateText() {
    const m = this._model();
    // A GM's only (the model's `pending` and `encounter`): a quiet check that hit is the GM's until posted.
    if (m.pending || m.encounter) return esc(t("SDE.clock.plate.encounter"));
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
    const enc = overlandState().encounter;
    if (this._open === "encounter") return encounterPanel({ enc, cal: game.time.calendar });
    // Folded, a held encounter rides under the bar as a strip, above whatever else is open (#257).
    const strip = game.user.isGM && enc && CrawlState.isOverland ? encounterStrip({ enc, cal: game.time.calendar }) : "";
    if (this._open === "time") return strip + this._timePanel();
    if (this._open === "month") return strip + this._monthPanel();
    if (this._open === "travel") return strip + this._travelPanel();
    return strip + (this._sky ? `${this._seasonBand()}${this._dial()}` : "");
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
    const region = CrawlState.isOverland && isHexMapScene() ? [state.hex?.region, state.hex?.terrain?.replace(/_/g, " ")].filter(Boolean).join(" · ") : "";
    const { cx, cy } = DIAL;
    const stars = DIAL_STARS.map((s) => { const [x, y] = starPoint(s, hoursPerDay); return `<circle cx="${x}" cy="${y}" r="1.1" class="sde-hud-star"/>`; }).join("");
    const label = t("SDE.clock.dialLabel", { weather: word, sun: sunLine, moon: t(MOON_NAME[moon.key]) });
    // The lines under the weather sit on their own black plate: near sunrise or
    // sunset the dial's day edge runs right under them, so no one ink reads on both sides.
    const lineW = Math.max(region ? 132 : 0, Math.round(sunLine.length * 6.2) + 18);
    const lineTop = region ? 58 : 61, lineH = region ? 29 : 16;
    return `<svg class="sde-hud-dial" width="260" height="140" viewBox="0 0 260 140" role="img" aria-label="${esc(label)}">
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
      <rect x="${cx - lineW / 2}" y="${lineTop}" width="${lineW}" height="${lineH}" rx="3" class="sde-hud-lineplate"/>
      ${region ? `<text x="${cx}" y="68" text-anchor="middle" class="sde-hud-region"${
        // A long region and terrain are squeezed to the disc rather than spilling over its rim.
        region.length > 18 ? ` textLength="120" lengthAdjust="spacingAndGlyphs"` : ""}>${esc(region.toUpperCase())}</text>` : ""}
      <text x="${cx}" y="${region ? 82 : 73}" text-anchor="middle" class="sde-hud-sunline">${esc(sunLine)}</text>
      <path transform="translate(${cx} 105)" d="M0 -9 L2.2 -2.2 L9 0 L2.2 2.2 L0 9 L-2.2 2.2 L-9 0 L-2.2 -2.2 Z" fill="#ffffff" stroke="#000" stroke-width="1"/>
      <g clip-path="url(#sde-hud-moonc)"><circle cx="${d.moon.x}" cy="${d.moon.y}" r="${d.moon.r}" fill="#f0f0f0"/><circle cx="${+(d.moon.x + d.moon.shadow).toFixed(1)}" cy="${d.moon.y}" r="${d.moon.r}" fill="#000"/></g>
      <circle cx="${d.moon.x}" cy="${d.moon.y}" r="${d.moon.r}" fill="none" stroke="#000" stroke-width="1"/>
    </svg>`;
  },

  _timePanel() {
    const { parts } = this._now();
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
        <label class="sde-hud-check"><input type="checkbox" data-action="realtime" ${realtime ? "checked" : ""} ${tracking ? "" : "disabled"}>
          <span>${esc(t("SDE.clock.realtime"))}</span><span class="sde-hud-cap">${esc(t(paused ? "SDE.clock.paused" : "SDE.clock.lightTracking"))}</span></label>
        <span class="sde-hud-fl">${esc(t("SDE.clock.timeNote"))}</span>
      </div>
    </div>`;
  },

  _monthPanel() {
    const { now, cal, parts } = this._now();
    const gm = game.user.isGM;
    let epoch = 0;
    try { epoch = moonEpoch(); } catch { /* default */ }
    const holidaysOn = (date) => this._holidays.filter((h) => this._whenMatches?.(h.when, date)).map((h) => h.name);
    const g = monthGrid(cal, now, { offset: this._monthOffset, epoch, holidaysOn });
    const spd = secondsPerDay(cal);
    const entries = calendarEntries();
    const events = g.cells.map((cell) => (cell.out ? [] : dayEvents({ cell, year: g.year, month: g.monthNumber, spd, entries, gm, holy: this._holy })));
    const heads = g.weekdays.map((w) => `<div class="sde-hud-dow">${esc(t(w))}</div>`).join("");
    const cells = g.cells.map((cell, i) => {
      if (cell.out) return `<div class="sde-hud-day sde-hud-out">${cell.day}</div>`;
      const mark = cell.moon ? `<span class="sde-hud-m sde-hud-m-${cell.moon}" data-tooltip="${esc(t(MOON_MARK[cell.moon]))}"></span>` : "";
      const hol = cell.holidays.length ? `<span class="sde-hud-h">${esc(cell.holidays.join(", "))}</span>` : "";
      const busy = events[i].some((e) => e.kind !== "holiday") ? '<span class="sde-hud-e"></span>' : "";
      const picked = this._info?.at === cell.at;
      const cls = `sde-hud-day${cell.today ? " sde-hud-today" : ""}${picked ? " sde-hud-picked" : ""}`;
      return `<button type="button" class="${cls}" data-action="pickDay" data-id="${cell.at}" aria-pressed="${picked}" aria-label="${esc(t("SDE.calendar.openDay", { day: cell.day, month: t(g.month) }))}">${cell.day}${mark}${busy}${hol}</button>`;
    }).join("");
    // The holy days that sit in a stretch of the season rather than on a day come first, with no day.
    const stretches = holyWindows(this._holy, g.cells).map((h) => this._eventRow(null, { kind: "holy", holy: h }, cal, gm)).join("");
    const agenda = stretches + g.cells.flatMap((cell, i) => events[i].map((ev) => this._eventRow(cell, ev, cal, gm))).join("");
    const season = cal.seasons?.values?.[g.season]?.name;
    const notes = [
      g.fullMoon ? t("SDE.clock.fullMoonOn", { day: g.fullMoon }) : "",
      t("SDE.clock.clickDay"),
      this._holidays.length ? "" : t("SDE.clock.noHolidays"),
    ].filter(Boolean).join(" ");
    return `<div class="sde-hud-panel sde-hud-wide">
      <div class="sde-hud-ph sde-hud-ph-row">
        ${key("month", "‹", { id: "-1", cls: "sde-hud-sm", hint: t("SDE.clock.prevMonth"), aria: t("SDE.clock.prevMonth") })}
        ${gm ? `<button type="button" class="sde-hud-ttl sde-hud-ttlbtn" data-action="dateEdit" aria-expanded="${this._dateEdit}" data-tooltip="${esc(t("SDE.clock.changeDate"))}">${esc(`${t(g.month)} ${g.year}`)}</button>`
          : `<span class="sde-hud-ttl">${esc(`${t(g.month)} ${g.year}`)}</span>`}${season ? `<span class="sde-hud-cap">${esc(t(season))}</span>` : ""}
        ${key("month", "›", { id: "1", cls: "sde-hud-sm", hint: t("SDE.clock.nextMonth"), aria: t("SDE.clock.nextMonth") })}
      </div>
      <div class="sde-hud-pb">${gm && this._dateEdit ? this._dateRow(cal, parts) : ""}<div class="sde-hud-mgrid" style="grid-template-columns:repeat(${g.weekdays.length || 7},minmax(0,1fr))">${heads}${cells}</div>
        <span class="sde-hud-fl">${esc(notes)}</span>
        ${this._detail(g, events, cal, gm)}
        ${agenda ? `<ul class="sde-hud-agenda">${agenda}</ul>` : `<span class="sde-hud-fl">${esc(t("SDE.calendar.empty"))}</span>`}
        ${gm ? this._entryForm(g, parts) : ""}</div>
    </div>`;
  },

  /** A holy day's second line: its deity, when it falls, and where the book prints it. */
  _holyLine({ deity, page, rule }) {
    const season = t(SEASON_NAME[rule.season]);
    let when;
    if (rule.moon) {
      when = t(rule.first ? "SDE.calendar.holy.firstMoon" : "SDE.calendar.holy.eachMoon", { moon: t(rule.moon === "new" ? "SDE.calendar.holy.new" : "SDE.calendar.holy.full"), season });
    } else if (rule.part === "day") {
      when = rule.to > rule.from ? t("SDE.calendar.holy.week", { season }) : t("SDE.calendar.holy.day", { n: rule.from, season });
    } else {
      when = t(HOLY_PART[rule.part], { season });
    }
    return `${deity} · ${when} · ${t("SDE.calendar.holy.source", { page })}`;
  },

  /** The GM's date fields, on the clock's date: day, month by name, year, and Go. */
  _dateRow(cal, parts) {
    const months = (cal.months?.values ?? []).map((m, i) =>
      `<option value="${i + 1}"${t(m.name) === t(parts.month) ? " selected" : ""}>${esc(t(m.name))}</option>`).join("");
    return `<div class="sde-hud-row sde-hud-dateedit">
      <input class="sde-hud-field" id="sde-hud-d-day" type="number" min="1" value="${parts.day}" aria-label="${esc(t("SDE.clock.day"))}">
      <select class="sde-hud-field" id="sde-hud-d-month" aria-label="${esc(t("SDE.clock.monthName"))}">${months}</select>
      <input class="sde-hud-field" id="sde-hud-d-year" type="number" value="${parts.year}" aria-label="${esc(t("SDE.clock.year"))}">
      ${key("setDate", t("SDE.clock.go"), { cls: "sde-hud-sm" })}
    </div>
    <span class="sde-hud-fl">${esc(t("SDE.clock.dateNote"))}</span>`;
  },

  /** An event's icon, its text and whatever button goes at the end of its line. */
  _eventParts(ev, cal, gm) {
    switch (ev.kind) {
      case "holiday": {
        const hidden = game.user.isGM && gmOnlyKeys().includes(this._holidays.find((h) => h.name === ev.name)?.key);
        return { icon: "fa-masks-theater", html: esc(ev.name) + (hidden ? `<small>${esc(t("SDE.calendar.gmOnly"))}</small>` : "") };
      }
      case "solar": return { icon: "fa-sun", html: esc(t(SOLAR_NAME[ev.key])) };
      case "season": return { icon: "fa-leaf", html: esc(t("SDE.calendar.seasonBegins", { season: t(cal.seasons?.values?.[ev.index]?.name ?? "") })) };
      case "holy": {
        const hidden = game.user.isGM && gmOnlyKeys().includes(ev.holy.key);
        return { icon: "fa-hands-praying", html: `<b>${esc(ev.holy.name)}</b><small>${esc(this._holyLine(ev.holy) + (hidden ? ` · ${t("SDE.calendar.gmOnly")}` : ""))}</small>` };
      }
      case "eclipse": return { icon: "fa-circle-half-stroke",
        html: esc(t("SDE.calendar.eclipse.line", { name: t(ECLIPSE_NAME[ev.body + ev.type]), time: ev.time, percent: ev.percent })) };
      default: {
        const e = ev.entry;
        const kind = t(KIND_NAME[e.kind]) + (e.gm ? ` · ${t("SDE.calendar.gmOnly")}` : "");
        const del = gm ? key("delEntry", "×", { id: e.id, cls: "sde-hud-sm sde-hud-x", hint: t("SDE.calendar.remove"), aria: t("SDE.calendar.remove") }) : "";
        return { icon: KIND_ICON[e.kind], html: `<b>${esc(e.title)}</b><small>${esc(kind)}${e.text ? ` · ${esc(e.text)}` : ""}</small>`, extra: del };
      }
    }
  },

  /**
   * One line of the month's agenda: the day, an icon and what falls on it.
   * Clicking it opens what it is; a holy day that sits in a stretch of the
   * season (no `cell`) opens on its own.
   */
  _eventRow(cell, ev, cal, gm) {
    const { icon, html, extra } = this._eventParts(ev, cal, gm);
    const action = cell ? `data-action="pickDay" data-id="${cell.at}"` : `data-action="pickHoly" data-id="${esc(ev.holy.key)}"`;
    return `<li ${action} role="button" tabindex="0"><span class="sde-hud-ad">${cell ? cell.day : "–"}</span><i class="fa-solid ${icon} sde-hud-ai" aria-hidden="true"></i><span class="sde-hud-at">${html}</span>${extra || "<span></span>"}</li>`;
  },

  /** An imported page's paragraphs, or null while it is read (the bar redraws when it is). */
  _page(uuid) {
    if (!uuid) return [];
    if (this._text.has(uuid)) return this._text.get(uuid);
    this._text.set(uuid, null);
    fromUuid(uuid).then((page) => this._text.set(uuid, paragraphs(page?.text?.content)))
      .catch(() => this._text.set(uuid, []))
      .finally(() => this.render());
    return null;
  },

  /**
   * What a clicked day, or holy day, is about: for a holiday what it does and
   * the book's page; for a holy day its god, when it falls and a line on what it
   * is; the rest as the agenda says them. A GM can go to the day from here.
   */
  _detail(g, events, cal, gm) {
    const info = this._info;
    if (!info) return "";
    let title, items, at = null;
    if (info.holy) {
      const h = this._holy.find((x) => x.key === info.holy);
      if (!h) return "";
      title = h.name;
      items = [{ kind: "holy", holy: h }];
    } else {
      const i = g.cells.findIndex((c) => !c.out && c.at === info.at);
      if (i < 0) return "";
      at = info.at;
      title = `${g.cells[i].day} ${t(g.month)} ${g.year}`;
      items = events[i];
    }
    const open = (uuid) => (uuid ? key("openPage", t("SDE.calendar.openPage"), { id: uuid, cls: "sde-hud-sm" }) : "");
    // A GM can switch a holiday or holy day to GM only: players' calendars then leave it out.
    const hiddenKeys = gmOnlyKeys();
    const toggle = (k) => (game.user.isGM ? key("toggleGmOnly", t(hiddenKeys.includes(k) ? "SDE.calendar.gmOnlyOn" : "SDE.calendar.gmOnlyOff"), { id: k, cls: "sde-hud-sm", hint: t("SDE.calendar.gmOnlyHint") }) : "");
    const block = (ev) => {
      const { icon, html } = this._eventParts(ev, cal, false);
      let more = "";
      if (ev.kind === "holiday") {
        const h = this._holidays.find((x) => x.name === ev.name);
        const effects = holidayEffects(h?.carousing).map((e) => `<li>${esc(e.key === "SDE.calendar.effect.chance" ? t(e.key, { n: e.n, label: e.label }) : t(e.key, { n: e.n }))}</li>`).join("");
        const text = h?.paras ?? this._page(h?.pageUuid);
        more = (effects ? `<ul class="sde-hud-effects">${effects}</ul>` : "")
          + (text === null ? `<span class="sde-hud-fl">${esc(t("SDE.calendar.reading"))}</span>` : text.map((p) => `<p>${esc(p)}</p>`).join(""))
          + open(h?.pageUuid) + toggle(h?.key);
      } else if (ev.kind === "holy") {
        more = `<p>${esc(t(ev.holy.about))}</p>${open(ev.holy.pageUuid)}${toggle(ev.holy.key)}`;
      }
      return `<div class="sde-hud-dblock"><div class="sde-hud-dh"><i class="fa-solid ${icon} sde-hud-ai" aria-hidden="true"></i><span class="sde-hud-at">${html}</span></div>${more}</div>`;
    };
    const goTo = gm && at !== null ? key("goto", t("SDE.calendar.goToDay"), { id: String(at), cls: "sde-hud-sm", hint: t("SDE.calendar.goToDayHint") }) : "";
    return `<div class="sde-hud-detail">
      <div class="sde-hud-row"><span class="sde-hud-ttl2">${esc(title)}</span>${goTo}${key("closeInfo", "×", { cls: "sde-hud-sm sde-hud-x", aria: t("SDE.calendar.close"), hint: t("SDE.calendar.close") })}</div>
      ${items.length ? items.map(block).join("") : `<span class="sde-hud-fl">${esc(t("SDE.calendar.nothingOn"))}</span>`}
    </div>`;
  },

  /** The GM's form for a new entry: a date, a kind, a title, the details, and whether players see it. */
  _entryForm(g, parts) {
    const d = this._draft ?? {};
    const pad = (n) => String(n).padStart(2, "0");
    const month = `${String(g.year).padStart(4, "0")}-${pad(g.monthNumber)}`;
    // The viewed month's first day, or today when it is the month on the clock.
    const date = d.date ?? (this._monthOffset ? `${month}-01` : `${month}-${pad(parts.day)}`);
    const kinds = ["note", "quest"]
      .map((k) => `<option value="${k}"${(d.kind ?? "note") === k ? " selected" : ""}>${esc(t(KIND_NAME[k]))}</option>`).join("");
    return `<div class="sde-hud-add">
      <span class="sde-hud-cap">${esc(t("SDE.calendar.add"))}</span>
      <div class="sde-hud-row">
        <input class="sde-hud-field" id="sde-hud-e-date" type="date" value="${esc(date)}" aria-label="${esc(t("SDE.calendar.date"))}">
        <select class="sde-hud-field" id="sde-hud-e-kind" aria-label="${esc(t("SDE.calendar.type"))}">${kinds}</select>
      </div>
      <input class="sde-hud-field" id="sde-hud-e-title" type="text" maxlength="120" value="${esc(d.title ?? "")}" placeholder="${esc(t("SDE.calendar.title"))}" aria-label="${esc(t("SDE.calendar.title"))}">
      <input class="sde-hud-field" id="sde-hud-e-text" type="text" maxlength="2000" value="${esc(d.text ?? "")}" placeholder="${esc(t("SDE.calendar.details"))}" aria-label="${esc(t("SDE.calendar.details"))}">
      <div class="sde-hud-row">
        <label class="sde-hud-checkrow"><input type="checkbox" id="sde-hud-e-gm"${d.gm ? " checked" : ""}> <span>${esc(t("SDE.calendar.gmOnlyBox"))}</span></label>
        ${key("addEntry", t("SDE.calendar.addKey"), { cls: "sde-hud-sm" })}
      </div>
    </div>`;
  },

  _model() {
    const state = overlandState();
    const actors = {};
    for (const id of state.members) {
      const a = game.actors.get(id);
      if (a) actors[id] = {
        name: a.name, uuid: a.uuid,
        rations: a.items.filter((i) => /^rations?$/i.test(i.name)).reduce((n, i) => n + (Number(i.system?.quantity) || 0), 0),
        int: Number(a.system?.abilities?.int?.mod) || 0,
      };
    }
    return barModel({ state, actors, isGM: !!game.user.isGM, owns: (id) => !!game.actors.get(id)?.isOwner });
  },

  /** The day as the book's eight travel steps (travel-panel.mjs). */
  _travelPanel() {
    const { now, cal } = this._now();
    const state = overlandState();
    let rules = null;
    try { rules = game.shadowdarkEnhancer?.rules?.visibility?.() ?? null; } catch { /* no rules data yet */ }
    return travelPanel({
      state, model: this._model(), gm: !!game.user.isGM, see: this._see, cal,
      night: !!game.shadowdarkEnhancer?.time?.isNight?.(now, { region: state.hex?.region }),
      rules, season: t(seasonAt(cal, now).name ?? ""), weatherName, methodName,
      weather: weatherNow(), extras: !!game.modules.get("shadowdark-extras")?.active,
      frequency: encounterSettings(), adjust: this._adjust,
      ...this._partyFor(),
    });
  },

  /** The party as the Method step reads it, and that method's hexes a day. */
  _partyFor() {
    const party = partyReading();
    const boat = party.method === "sailing" && party.boatUuid ? fromUuidSync(party.boatUuid) : null;
    const nextBase = Number(boat ? boat.system?.speed : game.shadowdarkEnhancer?.rules?.hexesPerDay?.(party.method)) || 0;
    return { party, nextBase };
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
      if (calendar && ahead > 0 && !CrawlState.isOverland) {
        await game.shadowdarkEnhancer.time.advanceOffDuty(ahead, { reason: "calendar" });   // it warns for itself
        return;
      }
      const reply = to !== null ? await advanceClock(null, { to, calendar }) : await advanceClock(seconds);
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
        this._dateEdit = false;
        this._info = null;
        this._see = null;
        this._adjust = false;
        if (this._open === "month") {
          this._monthOffset = 0;
          await this._loadHolidays();
        }
        return this.render();
      case "stack": this._stack = this._stack === id ? null : id; return this.render();
      // The day's own step, or the one already open, goes back to following the day.
      case "see": { const n = Number(id); this._see = (this._see === n || el.dataset.now) ? null : n; return this.render(); }
      case "sky": this._sky = !this._sky; this._open = null; return this.render();
      case "month": this._monthOffset += Number(id) || 0; this._info = null; return this.render();
      case "step": return this._move(Number(id));
      case "jump": return this._move(null, { to: nextTimeOfDay(game.time.calendar, game.time.worldTime, id) });
      case "goto": {
        const cal = game.time.calendar, now = game.time.worldTime;
        return this._move(null, { to: Number(id) + (now - startOfDay(cal, now)), calendar: true });
      }
      case "addEntry": {
        const d = this._draft ?? {};
        const read = (name, dflt = "") => this._el.querySelector(`#sde-hud-e-${name}`)?.value ?? d[name] ?? dflt;
        const cal = game.time.calendar, now = game.time.worldTime;
        const [year, month, day] = read("date").split("-").map(Number);
        const dayStart = dateToTime(cal, { year, month, day });
        if (dayStart === null) return ui.notifications.warn(t("SDE.clock.badDate"));
        if (!read("title").trim()) return ui.notifications.warn(t("SDE.calendar.needTitle"));
        await addCalendarEntry({
          // The clock's hour on that day, so a day's entries stay in the order they were filed.
          at: dayStart + (now - startOfDay(cal, now)), kind: read("kind", "note"),
          title: read("title"), text: read("text"), gm: !!this._el.querySelector("#sde-hud-e-gm")?.checked,
        });
        this._draft = null;
        return this.render();
      }
      case "delEntry": return removeCalendarEntry(id);
      case "pickDay": { const at = Number(id); this._info = this._info?.at === at ? null : { at }; return this.render(); }
      case "pickHoly": this._info = this._info?.holy === id ? null : { holy: id }; return this.render();
      case "toggleGmOnly": await setGmOnly(id, !gmOnlyKeys().includes(id)); return this.render();
      case "closeInfo": this._info = null; return this.render();
      case "openPage": {
        const page = await fromUuid(id);
        return page?.parent?.sheet?.render({ force: true, pageId: page.id });
      }
      case "dateEdit": this._dateEdit = !this._dateEdit; return this.render();
      case "setDate": return this._setDate();
      case "startTravel": {
        const started = await startOverland();
        if (started) { this._open = "travel"; this._see = null; }
        if (started && !Number.isFinite(overlandState().day)) warn(await startDayFromParty());
        return this.render();
      }
      case "forage": return forage(id);
      case "resume": return warn(await resume());
      // The panel's Post is the GM's decision to show it: to everyone, whatever the roller's GM-only setting.
      case "postEncounter": return postEncounter(encounterCard(overlandState().encounter), { gmOnly: false });
      case "openRoller": {
        // The roller opens on the held encounter, for CHA and renown on the reaction, and its tokens.
        const app = await game.shadowdarkEnhancer.encounter.openRoller("tables");
        const enc = overlandState().encounter;
        if (enc && enc.kind !== "empty") app?._setResult?.(enc, { via: enc.via });
        return;
      }
      case "rollWeather": return warn(await rollWeather());
      case "reroll": return warn(await rollWeather({ reroll: true }));
      case "startDay": return warn(await startDayFromParty());
      case "pace": {
        const reply = await setTravelPace(id);
        if (reply?.ok && reply.changed) ui.notifications.info(t(reply.today ? (id === "push" ? "SDE.travel.speed.pushNow" : "SDE.travel.speed.normalNow")
          : (id === "push" ? "SDE.travel.speed.pushNextDawn" : "SDE.travel.speed.normalNextDawn")));
        return warn(reply);
      }
      case "makeCamp": return warn(await makeCamp());
      case "adjust": this._adjust = !this._adjust; return this.render();
      // A GM's number in the Adjust rows is the world setting: every client redraws on its change.
      case "encSet": {
        if (!game.user.isGM || !Object.hasOwn(ENCOUNTER_SETTINGS, id)) return undefined;
        return game.settings.set(MODULE_ID, ENCOUNTER_SETTINGS[id], Number(el.dataset.n))
          .catch((err) => console.error(`${MODULE_ID} | encounter checks setting`, err));
      }
      case "checkNow": {
        // A double click rolls one check, not two.
        if (this._moving) return undefined;
        this._moving = true;
        try {
          const reply = await checkNow();
          if (reply?.ok && !reply.hit) ui.notifications.info(t("SDE.travel.encounters.checkNothing", { chance: reply.chance }));
          return warn(reply);
        } finally {
          this._moving = false;
        }
      }
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

  /** The month view's day, month and year fields: the clock goes to that date at the same hour. */
  async _setDate() {
    const cal = game.time.calendar, now = game.time.worldTime;
    const read = (name) => Number(this._el.querySelector(`#sde-hud-d-${name}`)?.value);
    const dayStart = dateToTime(cal, { year: read("year"), month: read("month"), day: read("day") });
    if (dayStart === null) return ui.notifications.warn(t("SDE.clock.badDate"));
    this._dateEdit = false;
    this._monthOffset = 0;
    await this._move(null, { to: dayStart + (now - startOfDay(cal, now)), calendar: true });
    this.render();
  },

  async _loadHolidays() {
    try {
      const mod = await import("../holidays/holidays.mjs");
      this._whenMatches = mod.whenMatches;
      // A GM reads the pack and keeps the players' copy current; a player reads that copy.
      this._holidays = await mod.calendarHolidays();
      this._holy = await mod.calendarHolyDays();
      if (game.user.isGM) mod.publishLore();
    } catch (err) {
      console.warn(`${MODULE_ID} | clock: holidays not read`, err);
      this._holidays = [];
      this._holy = [];
    }
  },
};
