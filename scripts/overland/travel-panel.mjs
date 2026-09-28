/**
 * Shadowdark Enhancer — the Travel panel: the day as the book's travel
 * procedure, in its eight steps (GMWR p.46; #257, the demo's panel).
 *
 * The step list is the day's record: the step the day stands at is marked,
 * and any step can be opened to see what happened in it. Everything read here
 * is Overland's state; the buttons are the clock HUD's (overland-bar.mjs
 * handles their data-action). Parts the demo automates that Overland doesn't
 * yet (the standing pace, the method read from mounts, the camp tasks) say so.
 */

import { esc } from "../shared/esc.mjs";
import { dateParts } from "../time/time-core.mjs";
import { forageDC } from "./overland-state-core.mjs";
import { TRAVEL_STEPS, currentStep, sightParts } from "./hud-core.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

const STEP_NAME = {
  weather: "SDE.travel.step.weather", sight: "SDE.travel.step.sight", method: "SDE.travel.step.method",
  speed: "SDE.travel.step.speed", traveling: "SDE.travel.step.traveling", encounters: "SDE.travel.step.encounters",
  resting: "SDE.travel.step.resting", night: "SDE.travel.step.night",
};
const WEATHER_EFFECT = {
  fair: "SDE.travel.weather.effect.fair", stormy: "SDE.travel.weather.effect.stormy", excellent: "SDE.travel.weather.effect.excellent",
};
const SIGHT_PART = {
  base: "SDE.travel.sight.part.base", darkness: "SDE.travel.sight.part.darkness", stormy: "SDE.travel.sight.part.stormy",
  excellent: "SDE.travel.sight.part.excellent", slight: "SDE.travel.sight.part.slight", high: "SDE.travel.sight.part.high",
};

const key = (action, label, { id = "", cls = "", hint = "" } = {}) =>
  `<button type="button" class="sde-hud-key ${cls}" data-action="${action}"${id ? ` data-id="${esc(id)}"` : ""}${
    hint ? ` data-tooltip="${esc(hint)}"` : ""}>${esc(label)}</button>`;
const signed = (n) => `${n >= 0 ? "+" : "−"}${Math.abs(n)}`;
const gold = (v) => `<span class="sde-hud-gold">${esc(v)}</span>`;

/** "80 minutes" or "2 hours": a travel point in the calendar's minutes and hours. */
function pointTime(seconds, cal) {
  const perMinute = cal?.days?.secondsPerMinute ?? 60, perHour = cal?.days?.minutesPerHour ?? 60;
  const minutes = Math.round((Number(seconds) || 0) / perMinute);
  return (minutes % perHour || !minutes) ? t("SDE.travel.minutes", { n: minutes })
    : t(minutes === perHour ? "SDE.travel.hour" : "SDE.travel.hours", { n: minutes / perHour });
}

/**
 * The panel. `see` is the step the viewer opened, or null for the day's own.
 * `weather` is the weather that holds now (null once it has run out); `extras`
 * is whether Shadowdark Extras, whose hex fog shows what the party sees, is on.
 * `party` is the party as the Method step reads it (overland.mjs partyReading):
 * the method it would travel by, and each member's mount; `nextBase`, that
 * method's hexes a day (0 when nothing says).
 * @param {{state:object, model:object, gm:boolean, see:number|null, cal:object,
 *   night:boolean, rules:object|null, season:string, weather:string|null, extras:boolean,
 *   party:{method:string, ride:Object<string,string>}, nextBase:number,
 *   weatherName:Function, methodName:Function}} v
 */
export function travelPanel(v) {
  const { state, model: m, gm } = v;
  // Only the GM hears of an encounter before it's posted: players' panels don't move for one.
  // One can be held with no clock left to run (it hit as the clock reached its target).
  const pending = gm ? (state.pending ?? (state.encounter ? { reason: "encounter" } : null)) : null;
  const held = pending ? (state.encounter?.half ?? state.checks.findLast((c) => c.rolled && c.hit)?.half ?? null) : null;
  const now = currentStep({ dayOpen: m.dayOpen, pending, heldHalf: held });
  const shown = v.see ?? now;
  const sight = sightParts(v.rules, { terrain: state.hex?.terrain, night: v.night, weather: v.weather ?? null });
  const climate = [m.climate, m.harsh ? t("SDE.overland.bar.harsh") : ""].filter(Boolean).join(", ");
  const subtitle = [state.hex?.region, state.hex?.terrain?.replace(/_/g, " "), climate || v.season,
    sight ? t("SDE.travel.sees", { n: sight.radius }) : ""].filter(Boolean).join(" · ");
  const list = TRAVEL_STEPS.map((step, i) => {
    const n = i + 1;
    let cls = n < now ? "sde-hud-done" : n === now ? "sde-hud-now" : "";
    if (now === 5 && n === 6) cls = "sde-hud-now";     // the checks roll while the party travels
    if (n === shown) cls += " sde-hud-shown";
    return `<li class="${cls}"><button type="button" data-action="see" data-id="${n}"${n === now ? " data-now=\"1\"" : ""}${n === shown ? " aria-current=\"step\"" : ""}><span class="sde-hud-num">${n}</span>${esc(t(STEP_NAME[step]))}</button></li>`;
  }).join("");
  const foot = gm ? `<div class="sde-hud-pf">
      ${pending ? key("resume", t("SDE.overland.resume"), { cls: "sde-hud-primary", hint: t("SDE.overland.resumeHint") }) : ""}
      <span class="sde-hud-fl sde-hud-small">${esc(t("SDE.travel.gm"))}</span>
      ${key("startDay", t("SDE.travel.newDay"), { cls: "sde-hud-sm sde-hud-ghost", hint: t("SDE.overland.startDayHint") })}
      <span class="sde-hud-grow"></span>
      ${key("endTravel", t("SDE.overland.endTravel"), { cls: "sde-hud-sm sde-hud-ghost", hint: t("SDE.overland.endTravelHint") })}
    </div>` : "";
  return `<div class="sde-hud-panel sde-hud-travel">
    <div class="sde-hud-ph"><span class="sde-hud-ttl">${esc(t("SDE.clock.travel"))}</span><span class="sde-hud-cap">${esc(subtitle)}</span></div>
    <div class="sde-hud-tp"><ol class="sde-hud-steps">${list}</ol><div class="sde-hud-sb">${stepBody(shown, v, sight)}</div></div>
    ${foot}
  </div>`;
}

function stepBody(n, v, sight) {
  const { state, model: m, gm } = v;
  const h3 = `<h3>${n} · ${esc(t(STEP_NAME[TRAVEL_STEPS[n - 1]]))}</h3>`;
  const fl = (key, data) => `<p class="sde-hud-fl">${esc(t(key, data))}</p>`;
  const res = (text) => `<p class="sde-hud-res">${esc(text)}</p>`;
  const w = v.weather ?? null;
  switch (n) {
    case 1: {
      let body = h3 + fl("SDE.travel.weather.about");
      if (w) {
        body += `<div class="sde-hud-trow"><span class="sde-hud-bl">${esc(v.weatherName(w))}</span><span class="sde-hud-cap">${
          t(state.weather.advantage ? "SDE.travel.weather.rolledAdvantage" : "SDE.travel.weather.rolled", { roll: gold(state.weather.roll) })}</span></div>`
          + res(t(WEATHER_EFFECT[w] ?? "SDE.travel.weather.effect.fair"));
      } else body += res(t("SDE.travel.weather.none"));
      if (gm) body += `<div class="sde-hud-trow">${m.dayOpen ? "" : key("startDay", t("SDE.overland.startDay"), { cls: "sde-hud-primary", hint: t("SDE.overland.startDayHint") })}${
        key("rollWeather", t("SDE.overland.bar.roll"), { cls: "sde-hud-sm", hint: t("SDE.overland.rollWeatherHint") })}${
        key("reroll", t("SDE.overland.bar.reroll"), { cls: "sde-hud-sm", hint: t("SDE.overland.bar.rerollHint") })}</div>`;
      return body;
    }
    case 2: {
      if (!sight) return h3 + fl("SDE.travel.sight.about") + res(t("SDE.travel.sight.noRules"));
      const parts = sight.parts.map(([k, val]) => `${t(SIGHT_PART[k])} ${signed(val)}`).join(" · ");
      return h3 + fl("SDE.travel.sight.about")
        + `<div class="sde-hud-trow"><span class="sde-hud-bl">${esc(t(sight.radius === 1 ? "SDE.travel.sight.hex" : "SDE.travel.sight.hexes", { n: sight.radius }))}</span><span class="sde-hud-cap">${esc(parts)}</span></div>`
        + fl("SDE.travel.sight.noTokenSight") + (v.extras && v.weather ? fl("SDE.travel.sight.fog") : "");
    }
    case 3: {
      const party = v.party ?? { method: m.method, ride: {} };
      const method = m.dayOpen ? m.method : party.method;
      const base = m.dayOpen ? state.base : v.nextBase;
      const rows = m.members.map((p) => {
        const mount = party.ride?.[p.uuid];
        return `<div class="sde-hud-member"><span class="sde-hud-n">${esc(p.name)}</span><span class="sde-hud-cap">${
          esc(mount ? t("SDE.travel.method.rides", { mount }) : t("SDE.travel.method.onFoot"))}</span></div>`;
      }).join("");
      const next = m.dayOpen && party.method !== m.method
        ? res(t("SDE.travel.method.nextDawn", { method: v.methodName(party.method), n: v.nextBase })) : "";
      return h3 + fl("SDE.travel.method.read")
        + `<div class="sde-hud-trow"><span class="sde-hud-bl">${esc(v.methodName(method))}</span>${
          base ? `<span class="sde-hud-cap">${esc(t("SDE.travel.method.perDay", { n: base }))}</span>` : ""}</div>`
        + rows + next + fl("SDE.travel.method.mounts");
    }
    case 4: {
      const base = m.dayOpen ? state.base : v.nextBase;
      const push = state.pace === "push";
      const seg = gm ? `<span class="sde-hud-seg">${
        [["normal", "SDE.travel.speed.normal"], ["push", "SDE.travel.speed.pushing"]].map(([id, label]) =>
          `<button type="button" data-action="pace" data-id="${id}" aria-pressed="${(id === "push") === push}">${esc(t(label))}</button>`).join("")}</span>`
        : `<span class="sde-hud-bl">${esc(t(push ? "SDE.travel.speed.pushing" : "SDE.travel.speed.normal"))}</span>`;
      const today = m.dayOpen ? `<span class="sde-hud-cap">${esc(t(state.pushed ? "SDE.travel.speed.todayPushing" : "SDE.travel.speed.todayNormal"))}</span>` : "";
      // The standing pace differs from today's: it waits for the next dawn.
      const waits = m.dayOpen && push !== state.pushed ? fl(push ? "SDE.travel.speed.pushNextDawn" : "SDE.travel.speed.normalNextDawn") : "";
      return h3 + fl("SDE.travel.speed.standing")
        + `<div class="sde-hud-trow">${seg}${today}</div>`
        + (base ? res(t("SDE.travel.speed.numbers", { base, push: Math.floor(base * 1.5) })) : "")
        + fl("SDE.travel.speed.about") + waits;
    }
    case 5: {
      if (!m.dayOpen) return h3 + res(t("SDE.travel.noDay"));
      const dc = forageDC(m.harsh);
      const why = state.pushed ? "SDE.travel.forage.pushed" : (m.stormy && m.harsh) ? "SDE.travel.forage.storm" : "SDE.travel.forage.about";
      const rows = m.members.map((p) => `<div class="sde-hud-member"><span class="sde-hud-n">${esc(p.name)}</span>
        <span class="sde-hud-need"><b>${esc(t("SDE.travel.forage.int", { mod: signed(p.int ?? 0) }))}</b> · ${t("SDE.travel.forage.dc", { dc: `<b>${dc}</b>` })}</span>
        ${p.foraged ? `<span class="sde-hud-chip">${esc(t("SDE.overland.bar.foraged"))}</span>` : p.canForage ? key("forage", t("SDE.overland.forage.button"), { id: p.id, cls: "sde-hud-sm" }) : ""}
        <span class="sde-hud-r sde-hud-cap"><b>${p.rations}</b> ${esc(t(p.rations === 1 ? "SDE.travel.ration" : "SDE.travel.rations"))}</span></div>`).join("");
      return h3 + `<div class="sde-hud-trow"><span class="sde-hud-cap"><b>${esc(v.methodName(m.method))}</b>${m.pushed ? esc(t("SDE.clock.plate.pushed")) : ""} · ${esc(t("SDE.travel.perPoint", { time: pointTime(state.pointSeconds, v.cal) }))}</span>
          <span class="sde-hud-meter"><span style="width:${Math.round(m.leftShare * 100)}%"></span></span>
          <span class="sde-hud-cap"><b>${esc(t("SDE.travel.left", { left: m.hexesLeft, budget: m.budget }))}</b></span></div>`
        + fl("SDE.travel.move") + fl(why) + rows
        + (gm ? `<div class="sde-hud-trow">${key("makeCamp", t("SDE.overland.makeCamp"), { cls: "sde-hud-primary", hint: t("SDE.overland.makeCampHint") })}</div>` : "");
    }
    case 6: {
      const chance = state.checks[0]?.chance ?? (state.pushed ? 2 : 1);
      const by = (half) => state.checks.filter((c) => c.half === half).length;
      return h3 + fl("SDE.travel.encounters.about")
        + `<div class="sde-hud-trow"><span class="sde-hud-cap">${t("SDE.travel.encounters.summary", { chance: `<b>${chance}</b>`, day: `<b>${by("day")}</b>`, night: `<b>${by("night")}</b>` })}</span></div>`
        + checks(v, "day");
    }
    case 7:
      return h3 + fl("SDE.travel.resting.about") + fl("SDE.travel.resting.soon")
        + (gm && m.dayOpen ? `<div class="sde-hud-trow">${key("makeCamp", t("SDE.overland.makeCamp"), { cls: "sde-hud-primary", hint: t("SDE.overland.makeCampHint") })}</div>` : "");
    case 8:
      return h3 + fl("SDE.travel.night.about")
        + (gm && state.pending?.reason === "camp" ? res(t("SDE.travel.night.stopped")) : "") + checks(v, "night");
    default:
      return "";
  }
}

/** A half's checks for a GM (dot, hour, what came of it); players hear of one only when something turns up. */
function checks(v, half) {
  if (!v.gm) return `<p class="sde-hud-fl">${esc(t("SDE.travel.encounters.players"))}</p>`;
  const list = v.state.checks.filter((c) => c.half === half);
  if (!list.length) return `<p class="sde-hud-fl">${esc(t("SDE.travel.encounters.none"))}</p>`;
  return list.map((c) => `<div class="sde-hud-checkrow"><span class="sde-hud-dot ${c.rolled ? (c.hit ? "sde-hud-hit" : "sde-hud-miss") : ""}"></span>
    <span class="sde-hud-cap sde-hud-w">${esc(t(half === "day" ? "SDE.travel.encounters.travel" : "SDE.travel.encounters.rest"))}</span>
    <span class="sde-hud-tm">${esc(dateParts(v.cal, c.at).time)}</span>
    <span class="${c.rolled ? "" : "sde-hud-fl"}">${esc(t(!c.rolled ? "SDE.travel.encounters.notYet" : c.hit ? "SDE.travel.encounters.hit" : "SDE.travel.encounters.nothing"))}</span></div>`).join("");
}
