/**
 * Shadowdark Enhancer — the route on the hex map (#257, the demo's click-to-travel).
 *
 * While travelling on a hex map with the travel token selected, the
 * cheapest route from it to the hex under the cursor is drawn: a line through
 * the hexes, each outlined with what it costs, and a tooltip with the hexes,
 * the miles, the points and the hours, or why there's no way. A click on a
 * hex then walks the party there one hex at a time. Each hex is a move of the
 * travel token, priced, charged and clocked as a drag is (overland.mjs
 * preMoveToken/moveToken), so the walk stops where a drag would: an
 * encounter, a bounce, the end of the day's points. A player sees the cost
 * only of hexes the fog has shown them (unknownTo).
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { CrawlState } from "../crawl-strip/crawl-state.mjs";
import { isHexMapScene, hexReader } from "../encounter/encounter-terrain.mjs";
import { cheapestRoute } from "./overland-state-core.mjs";
import { overlandState, travelStepCost, travelSettled, fastTravel, chainLeadMs, makeCamp, autoStartDay, travelBlocked, OVERLAND_CHANGED, setAutoGoal, travelParty } from "./overland.mjs";
import { campOf } from "../camping/camping.mjs";
import { AUTO_BLOCKED } from "../camping/camping-core.mjs";
import { ownsHexFog, hexDisclosure } from "../hex-map/hex-fog.mjs";
import { readPass } from "../hex-map/hex-records.mjs";
import { esc } from "../shared/esc.mjs";
import { L as t } from "../shared/i18n.mjs";

const offsetKey = (o) => `${o.i},${o.j}`;

let _graphics = null;
let _labels = null;
let _tip = null;
let _hovered = null;
let _armed = null;
let _press = null;
/** This tab's one walk, or a journey getting ready to walk (claimWalk): while set, nothing else starts one. */
let _walking = false;
/** The automatic journey this client is running: its token, destination and the clock Resume clock must reach. */
let _journey = null;
let _journeyTimer = null;
/** This tab's journey, kept so a reload during an encounter or a camp can pick it up again. */
const JOURNEY_KEY = `${MODULE_ID}.autoJourney`;

function rememberJourney() {
  try {
    if (_journey) {
      const { tokenUuid, goal, waitUntil } = _journey;
      sessionStorage.setItem(JOURNEY_KEY, JSON.stringify({ tokenUuid, goal, waitUntil, world: game.world.id, user: game.user.id }));
    }
    else sessionStorage.removeItem(JOURNEY_KEY);
  } catch { /* storage can be disabled; the world's autoGoal still offers Resume auto */ }
}

function forgetJourney() {
  _journey = null;
  rememberJourney();
}

function restoreJourney() {
  if (_journey) return;
  try {
    const saved = JSON.parse(sessionStorage.getItem(JOURNEY_KEY) ?? "null");
    if (!saved || saved.world !== game.world.id || saved.user !== game.user.id) return;
    const state = overlandState();
    if (!state.auto || !state.autoGoal || JSON.stringify(state.autoGoal) !== JSON.stringify(saved.goal)) {
      sessionStorage.removeItem(JOURNEY_KEY);
      return;
    }
    _journey = { tokenUuid: saved.tokenUuid, goal: saved.goal, waitUntil: saved.waitUntil ?? null };
  } catch { /* a malformed entry is no journey */ }
}

/** Held at least this long, a press is core's ping, not a click. */
const LONG_PRESS = foundry.canvas?.interaction?.MouseInteractionManager?.LONG_PRESS_DURATION_MS ?? 500;

/** The travel token, when this user has it selected on a hex map while travelling. */
function travelToken() {
  const s = overlandState();
  if (!CrawlState.isOverland || !isHexMapScene() || !s.tokenUuid) return null;
  return canvas.tokens.controlled.find((tok) => tok.document.uuid === s.tokenUuid) ?? null;
}

/**
 * Which hexes a player can't know the cost of: the native fog when Enhancer owns
 * it; otherwise Extras' hex fog (its api.hex.isPositionRevealed). The GM knows
 * every hex, and so does a player on a map with neither fog. ponytail: with
 * Extras on but without that API yet (Extras #185), a player knows none.
 * @returns {(o:{i:number, j:number}) => boolean}
 */
export function unknownTo(grid) {
  if (game.user.isGM) return () => false;
  if (ownsHexFog(canvas.scene)) {
    const pass = readPass(canvas.scene);
    return o => !hexDisclosure(canvas.scene, o, "terrain", {}, pass);
  }
  const extras = game.modules.get("shadowdark-extras");
  if (!extras?.active) return () => false;
  const revealed = extras.api?.hex?.isPositionRevealed;
  if (typeof revealed !== "function") return () => true;
  return (o) => {
    try { return revealed(canvas.scene, grid.getCenterPoint(o)) === false; } catch { return true; }
  };
}

/**
 * The cheapest route from the token's hex to `goal`, each step with its cost.
 * A hex this user can't know is priced 1 and its cost left unsaid: the party
 * finds out by moving (the move is priced on the active GM as a drag is).
 */
function routeTo(token, goal, avoid = null) {
  const grid = canvas.grid;
  const read = hexReader(canvas);
  if (!read) return null;
  const costOf = travelStepCost();
  const unknown = unknownTo(grid);
  const cells = new Map();
  const hex = (o) => {
    const k = offsetKey(o);
    if (!cells.has(k)) cells.set(k, read(o));
    return cells.get(k);
  };
  // Off the numbered map (the scene's padding): nothing to search for.
  if (!hex(goal)) return { blocked: null, offMap: true };
  const hidden = new Set();
  const cost = (from, to) => {
    if (unknown(to)) { hidden.add(offsetKey(to)); return 1; }
    return costOf(hex(to), hex(from)) ?? 1;
  };
  // `avoid`: a hex a move was refused on (a river without a boat, a closed pass); route round it.
  const blocked = (o) => avoid?.has(offsetKey(o)) === true;
  const route = cheapestRoute({
    start: grid.getOffset(token.center), goal, key: offsetKey,
    neighbours: (o) => grid.getAdjacentOffsets(o).filter((n) => hex(n) && !blocked(n)),
    cost,
    distance: (a, b) => {
      const A = grid.getCube(a), B = grid.getCube(b);
      return Math.max(Math.abs(A.q - B.q), Math.abs(A.r - B.r), Math.abs(A.s - B.s));
    },
  });
  if (!route) {
    // The hex itself is closed only when no side of it can be entered; else the way to it is cut off.
    const closed = grid.getAdjacentOffsets(goal).every((n) => !hex(n) || !Number.isFinite(cost(n, goal)));
    return { blocked: closed ? hex(goal) : null };
  }
  const costs = route.path.slice(1).map((o, i) => (hidden.has(offsetKey(o)) ? null : cost(route.path[i], o)));
  return { ...route, costs, unknown: costs.includes(null) };
}

function clear() {
  _graphics?.clear();
  for (const child of _labels?.removeChildren() ?? []) child.destroy();
  if (_tip) _tip.hidden = true;
}

/** The route drawn on the map: a white line through the hex centres. A short route labels every hex's cost;
 * a long one only outlines its destination and puts the total there, so seventeen hexes are a line rather
 * than a row of black badges. */
function draw(route) {
  clear();
  if (!route?.path || route.path.length < 2) return;
  const grid = canvas.grid;
  const w = Math.max(2, grid.size / 45);
  const g = _graphics;
  const centres = route.path.map((o) => grid.getCenterPoint(o));
  const steps = route.path.length - 1;
  const long = steps > 8;
  // White with a black edge, so the route reads on the black-on-white print
  // and on a painted map alike.
  const line = (width, colour, alpha) => {
    g.lineStyle(width, colour, alpha);
    g.moveTo(centres[0].x, centres[0].y);
    for (const p of centres.slice(1)) g.lineTo(p.x, p.y);
  };
  line(w * 3.4, 0x000000, 0.85);
  line(w * 1.6, 0xffffff, 0.95);
  route.path.slice(1).forEach((o, i) => {
    const last = i === steps - 1;
    if (long && !last) return;
    const c = centres[i + 1];
    const poly = grid.getVertices(o).flatMap((p) => [c.x + (p.x - c.x) * 0.9, c.y + (p.y - c.y) * 0.9]);
    g.lineStyle(w * 2.4, 0x000000, 0.6);
    g.drawPolygon(poly);
    g.lineStyle(w, 0xffffff, 0.9);
    g.beginFill(0xffffff, 0.12);
    g.drawPolygon(poly);
    g.endFill();
    const r = grid.size * (last && long ? 0.16 : 0.11), by = c.y + grid.size * (last && long ? 0.26 : 0.3);
    g.lineStyle(w * 0.6, 0xc9c9c9, 1);
    g.beginFill(0x000000, 1);
    g.drawCircle(c.x, by, r);
    g.endFill();
    const c0 = last && long ? route.cost : route.costs[i];
    const label = new PIXI.Text(c0 === null || c0 === undefined ? "?" : Number.isFinite(c0) ? String(c0) : "✕", {
      fontFamily: "Montserrat-Bold", fontSize: Math.round(r * 1.25), fill: 0xffffff,
    });
    label.anchor.set(0.5);
    label.position.set(c.x, by);
    _labels.addChild(label);
  });
}

/** Rough days for the route: today counts while it still has points, then the day's budget for each more day. */
function routeDays(route, s) {
  const cost = route?.cost;
  if (!Number.isFinite(cost) || cost <= 0) return null;
  const left = Math.max(0, (s.budget || 0) - (s.spent || 0));
  const perDay = Math.max(1, s.budget || s.base || 4);
  if (left >= cost) return 1;
  if (left > 0) return 1 + Math.ceil((cost - left) / perDay);
  return Math.ceil(cost / perDay);
}

/** The three-line route card: where and how far, what it costs and how long, and the small hints. */
const tipHtml = (main, sub, hint) => `<div class="sde-route-tip-main">${esc(main)}</div>`
  + (sub ? `<div class="sde-route-tip-sub">${esc(sub)}</div>` : "")
  + (hint ? `<div class="sde-route-tip-hint">${esc(hint)}</div>` : "");

/** The tooltip at the cursor: the route's hexes, miles, points and hours, or why there's no way. */
function showTip(event, route) {
  if (!_tip) {
    _tip = document.createElement("div");
    _tip.id = "sde-route-tip";
    document.body.append(_tip);
  }
  const s = overlandState();
  const left = Math.max(0, s.budget - s.spent);
  const hint = [game.user.isGM && route && !route.offMap ? t("SDE.route.fastHint") : "", s.auto ? t("SDE.route.autoHint") : ""]
    .filter(Boolean).join(" · ");
  let html;
  if (!route?.path) {
    const text = route?.blocked?.terrain
      ? t("SDE.route.closed", { terrain: route.blocked.terrain.replace(/_/g, " ") })
      : t("SDE.route.none");
    html = tipHtml(text, "", hint);
  } else {
    const hexes = route.path.length - 1;
    const dist = canvas.scene.grid.distance ?? 6, units = canvas.scene.grid.units ?? "";
    const days = game.time.calendar?.days;
    const hourSeconds = (days?.secondsPerMinute ?? 60) * (days?.minutesPerHour ?? 60);
    const hours = Math.round((route.cost * (s.pointSeconds || 0) * 10) / hourSeconds) / 10;
    const miles = hexes * dist;
    if (route.unknown) {
      html = tipHtml(t(hexes === 1 ? "SDE.route.tipOneUnknown" : "SDE.route.tipUnknown", { hexes, miles, units }), "", hint);
    } else {
      const head = t(hexes === 1 ? "SDE.route.tipMainOne" : "SDE.route.tipMain", { hexes, miles, units });
      const bits = [];
      if (Number.isFinite(route.cost)) bits.push(t(route.cost === 1 ? "SDE.route.tipCostOne" : "SDE.route.tipCost", { cost: route.cost }));
      if (hours > 0) bits.push(t(hours === 1 ? "SDE.route.tipHoursOne" : "SDE.route.tipHours", { hours }));
      const d = routeDays(route, s);
      if (d) bits.push(t(d === 1 ? "SDE.route.dayOne" : "SDE.route.days", { days: d }));
      if (s.budget > 0) bits.push(t("SDE.route.tipLeft", { left }));
      html = tipHtml(head, bits.join(" · "), hint);
    }
  }
  // All text came through tipHtml, which escapes every value; the tags are static.
  _tip.innerHTML = html;
  _tip.hidden = false;
  moveTip(event);
}

function moveTip(event) {
  if (!_tip || _tip.hidden) return;
  const x = event.client?.x ?? event.clientX ?? 0, y = event.client?.y ?? event.clientY ?? 0;
  const box = _tip.getBoundingClientRect();
  _tip.style.left = `${Math.max(8, Math.min(x + 14, window.innerWidth - box.width - 8))}px`;
  _tip.style.top = `${Math.max(8, Math.min(y + 14, window.innerHeight - box.height - 8))}px`;
}

/** Drops the preview and what a click would walk. */
function forget() {
  if (_armed || _hovered) { _armed = null; _hovered = null; clear(); }
}

/** A pointer event over the map itself, not over the HTML UI above it (Foundry's own hover test). */
const overMap = (event) => !event.nativeEvent || event.nativeEvent.target === canvas.app.view;

function onMove(event) {
  // A drag or a pan: no routing under it.
  if (event.buttons) return;
  if (!overMap(event)) return forget();
  hover(event);
}

/** Route from the token's hex to the hex under the pointer, unless that's what is shown. */
function hover(event) {
  if (_walking) return;
  const token = travelToken();
  if (!token) return forget();
  const start = canvas.grid.getOffset(token.center);
  const goal = canvas.grid.getOffset(event.getLocalPosition(canvas.stage));
  // Keyed on both ends: the token moving under a still pointer routes again.
  const k = `${offsetKey(start)}>${offsetKey(goal)}`;
  if (k === _hovered) return moveTip(event);
  _hovered = k;
  if (offsetKey(goal) === offsetKey(start)) { _armed = null; return clear(); }
  const route = routeTo(token, goal);
  // A closed way is still armed with the destination itself, so a click on it is an order to go (over Auto
  // travel, which ends the days until the way opens); a plain walk is refused by the move itself.
  _armed = route?.path ? { token, route } : route?.blocked ? { token, route: { ...route, path: [start, goal] } } : null;
  draw(route);
  showTip(event, route);
}

/**
 * The GM's Shift-click on any mapped hex, with or without a way there: fast travel
 * prices nothing, so water with no boat or a closed terrain is still a place to jump to.
 */
function fastArm(event) {
  if (!event.shiftKey || !game.user.isGM) return null;
  const token = travelToken();
  if (!token) return null;
  const goal = canvas.grid.getOffset(event.getLocalPosition(canvas.stage));
  if (offsetKey(goal) === offsetKey(canvas.grid.getOffset(token.center)) || !hexReader(canvas)?.(goal)) return null;
  return { token, route: { path: [goal] } };
}

/** A press only arms: the walk waits for the release, so a box-select drag or a ping isn't a click. */
function onDown(event) {
  _press = null;
  if (event.button !== 0 || _walking || !overMap(event)) return;
  // A click on a token, a note or a control is theirs, not a destination.
  if (event.target && event.target !== canvas.stage && event.target.document) return;
  // Routes again when the shown route is stale, and for a touch tap, which has no move first.
  hover(event);
  const armed = _armed ?? fastArm(event);
  if (armed) _press = { x: event.global.x, y: event.global.y, at: event.timeStamp, key: _hovered, armed };
}

function onUp(event) {
  const p = _press;
  _press = null;
  if (!p || event.button !== 0 || _walking || p.key !== _hovered) return;
  if (Math.hypot(event.global.x - p.x, event.global.y - p.y) > 5) return;
  if (event.timeStamp - p.at >= LONG_PRESS) return;
  // Shift is the GM's fast travel; any other modifier is core's.
  if (event.ctrlKey || event.metaKey || event.altKey || (event.shiftKey && !game.user.isGM)) return;
  const { token, route } = p.armed;
  _armed = null;
  if (moveBlocked(token)) return;
  if (event.shiftKey) { void jump(token, route.path); return; }
  const auto = overlandState().auto === true;
  let going = route.path;
  // A destination whose way is closed today (a storm, ground that cannot be entered) is still an order to
  // go: the automatic journey walks the days out. A plain walk has nothing to give it but the refusal.
  // Nothing to go to at all (a hex off the numbered map): the tooltip said why already.
  if (!(going?.length > 1)) return;
  const costs = route.costs ?? going.slice(1).map(() => 1);
  if (!auto) { void walk(token, { ...route, path: going, costs }, false); return; }
  void claimWalk(async () => {
    // Ground that never opens is said at once; a storm or today's weather is waited out by the walk.
    if (route.blocked && (await travelBlocked(going.at(-1))) === "terrain") {
      ui.notifications?.warn(t("SDE.route.autoPermanent"));
      return null;
    }
    ui.notifications?.info(t("SDE.route.autoStart", { hexes: going.length - 1 }));
    return { walk: { token, route: { ...route, path: going, costs } } };
  });
}

/**
 * What core refuses a mover in its UI, which a walk's document moves go around:
 * a player moving while the game is paused, and a locked token. Warns as core does.
 */
function moveBlocked(token) {
  if (!game.user.isGM && !token.document.actor?.testUserPermission(game.user, "OWNER")) {
    ui.notifications.warn(t("SDE.overland.notify.notPartyOwner", { name: game.user.name }));
    return true;
  }
  if (game.paused && !game.user.isGM) {
    ui.notifications.warn("GAME.PausedWarning", { localize: true });
    return true;
  }
  if (token.document.locked) {
    ui.notifications.warn(game.i18n.format("CONTROLS.ObjectIsLocked", { type: game.i18n.localize("DOCUMENT.Token") }));
    return true;
  }
  return false;
}

/** Why an automatic journey stopped, for the GM's whisper. Keys in full, for the i18n scan. */
const STOP_REASON = {
  encounter: "SDE.route.stopReason.encounter",
  camp: "SDE.route.stopReason.camp",
  campDecision: "SDE.route.stopReason.campDecision",
  paused: "SDE.route.stopReason.paused",
  autoOff: "SDE.route.stopReason.autoOff",
  day: "SDE.route.stopReason.day",
  blocked: "SDE.route.stopReason.blocked",
  noRoute: "SDE.route.stopReason.noRoute",
  moved: "SDE.route.stopReason.moved",
  stopped: "SDE.route.stopReason.stopped",
  error: "SDE.route.stopReason.error",
};

/** One GM whisper per automatic stop, so a player's journey does not stall with only that player knowing why. */
let _lastAutoStop = null;
function notifyGmAutoStop(reason, token) {
  try {
    const where = overlandState().hex;
    const key = `${token?.document?.uuid ?? ""}:${reason}:${where?.num ?? ""}:${game.time.worldTime}`;
    if (_lastAutoStop === key) return;
    _lastAutoStop = key;
    const gms = game.users?.filter((u) => u.isGM && u.active).map((u) => u.id) ?? [];
    if (!gms.length) return;
    const party = token?.actor?.name ?? t("SDE.route.gmStopParty");
    const place = (where ? [where.region, String(where.terrain ?? "").replace(/_/g, " ")].filter(Boolean).join(" · ") : "") || t("SDE.route.gmStopWhere");
    const reasonText = t(STOP_REASON[reason] ?? STOP_REASON.stopped);
    const content = `<p>${esc(t("SDE.route.gmStop", { party, reason: reasonText, where: place }))}</p>`;
    void ChatMessage.create({ content, whisper: gms, speaker: ChatMessage.getSpeaker({ alias: t("SDE.route.autoTravel") }) })
      .catch((err) => console.warn(`${MODULE_ID} | auto stop notice`, err));
  } catch (err) { console.warn(`${MODULE_ID} | auto stop notice`, err); }
}

/**
 * Walk the party along `route.path` (its first hex the one it starts in), one hex a
 * move, until the end, an encounter, a refusal, a pause, or someone else
 * moving the party. With `auto`, the journey crosses days: when the day cannot
 * pay for the next hex the party camps, the dawn opens the next day, and the
 * route is drawn again from where it stands; it stops for an encounter and
 * picks the journey up again when Resume clock clears it. The party never moves
 * while the game is paused.
 */
async function walk(token, route, auto = false) {
  // One walk per tab: a second start (a resume racing a click, two hooks at once) is not a second walk.
  if (_walking) return;
  _walking = true;
  clear();
  if (!auto) forgetJourney();
  const doc = token.document;
  // The token's own scene's grid: the viewer may be pulled to another scene mid-walk.
  const grid = doc.parent.grid;
  // A journey begun on a closed way has the destination as its goal; one already at the goal is there.
  const goal = route.path.at(-1);
  let path = route.path;
  let costs = route.costs ?? path.slice(1).map(() => 1);
  if (auto && path.length < 2) {
    ui.notifications?.info(t("SDE.route.autoArrived"));
    void setAutoGoal(null);
    _walking = false;
    return;
  }
  if (auto) { _journey = { tokenUuid: doc.uuid, goal, waitUntil: null }; rememberJourney(); }
  // Keep the destination in the travel state: a keyed location, a scene or another stop can end this
  // client's walk, and Travel > Resume auto reads the saved goal to pick it up.
  if (auto) {
    try { await setAutoGoal(goal); } catch (err) { console.warn(`${MODULE_ID} | the automatic journey's goal was not saved`, err); }
  }
  const hits = () => overlandState().checks.filter((c) => c.hit).length;
  const before = hits();
  let moved = 0;
  let keep = false;
  let stopReason = null;
  // Hexes a move was already refused on: the walk routes round them instead of stopping (a river, a closed pass).
  const avoid = new Set();
  // When the slides sent so far end on this screen: core chains a move sent while the token still slides.
  let slideEnd = performance.now();
  try {
    for (let n = 1; n < path.length; n++) {
      if (auto) {
        const state = overlandState();
        if (game.paused) { ui.notifications?.info(t("SDE.route.autoPaused")); stopReason = "paused"; keep = true; break; }
        if (!state.auto) { ui.notifications?.info(t("SDE.route.autoOff")); stopReason = "autoOff"; break; }
        if (state.pending || state.encounter) {
          stopReason = "encounter";
          keep = true;
          if (_journey) { _journey.waitUntil = state.pending?.until ?? null; rememberJourney(); }
          break;
        }
        if (state.camp) {
          // An automatic journey can finish a camp that is only waiting for its Night. A camp that
          // truly needs a choice opens its window and names the choice instead of saying "decision".
          if (auto) {
            const camp = await campForJourney();
            if (camp.go) {
              const next = routeTo(token, goal);
              if (!next?.path || next.path.length < 2) { stopReason = "noRoute"; break; }
              path = next.path; costs = next.costs; n = 0; continue;
            }
            if (camp.notice) ui.notifications?.warn(camp.notice);
            stopReason = (overlandState().pending || overlandState().encounter) ? "encounter" : (camp.keep ? "camp" : "campDecision");
            keep = camp.keep;
            break;
          }
          // The camp is part of the journey (an interrupted rest, or a camp made while walking):
          // keep the journey, and pick it up when the camp clears.
          ui.notifications?.info(t("SDE.route.autoCamp"));
          stopReason = "camp";
          keep = true;
          if (_journey) { _journey.waitUntil = state.camp.until ?? null; rememberJourney(); }
          break;
        }
        const cost = costs?.[n - 1] ?? 1;
        // A storm or closed ground is asked about through the game's own day: a storm in a harsh
        // climate closes every hex, wherever the party stands.
        if (state.stormy && state.harsh) {
          const days = await waitOutDays(token, goal, "storm");
          if (!days) { keep = true; break; }
          const next = routeTo(token, goal);
          if (!next?.path) { ui.notifications?.warn(t("SDE.route.autoNoRoute")); break; }
          if (next.path.length < 2) break;
          path = next.path; costs = next.costs; n = 0; continue;
        }
        if (state.day === null) {
          const reply = await autoStartDay();
          if (!reply?.ok) { if (reply?.error) ui.notifications?.warn(reply.error); stopReason = "day"; break; }
          const next = routeTo(token, goal);
          if (!next?.path || next.path.length < 2) { stopReason = "noRoute"; break; }
          path = next.path; costs = next.costs; n = 0; continue;
        }
        // The day cannot pay for the next hex: camp, and go on at dawn.
        const willCamp = state.hexesLeft < cost;
        if (willCamp) {
          const camp = await campForJourney();
          if (!camp.go) {
            if (camp.notice) ui.notifications?.warn(camp.notice);
            stopReason = (overlandState().pending || overlandState().encounter) ? "encounter" : (camp.keep ? "camp" : "campDecision");
            keep = camp.keep; break;
          }
          const next = routeTo(token, goal);
          if (!next?.path || next.path.length < 2) { stopReason = "noRoute"; break; }
          if (overlandState().hexesLeft < (next.costs?.[0] ?? 1)) { ui.notifications?.warn(t("SDE.route.autoShort")); stopReason = "blocked"; break; }
          path = next.path; costs = next.costs; n = 0; continue;
        }
      }
      if (moveBlocked(token)) { stopReason = "blocked"; break; }
      // Someone else moved the party (another owner's walk, a GM's drag): stop here. The
      // stored position, not doc.x/y, which follow the movement animation.
      if (offsetKey(grid.getOffset(doc.getCenterPoint(doc._source))) !== offsetKey(path[n - 1])) { stopReason = "moved"; break; }
      const { x, y } = grid.getTopLeftPoint(path[n]);
      // Resolves once the move is saved; the token is still sliding into the hex.
      // The journey's own moves are tagged, so only they skip the bounce banner a drag gets (overland.onPreMoveToken).
      if (!(await doc.move({ x, y }, auto ? { [MODULE_ID]: { auto: true } } : undefined))) {
        // A bounced move is how a day whose budget is spent looks before the camp: camp and try the hex again.
        const state = overlandState();
        if (auto && state.day !== null && state.hexesLeft < (costs?.[n - 1] ?? 1)) {
          const camp = await campForJourney();
          if (camp.go) {
            const next = routeTo(token, goal);
            if (!next?.path || next.path.length < 2) { stopReason = "noRoute"; break; }
            path = next.path; costs = next.costs; n = 0; continue;
          }
          if (!camp.go) {
            if (camp.notice) ui.notifications?.warn(camp.notice);
            stopReason = (overlandState().pending || overlandState().encounter) ? "encounter" : (camp.keep ? "camp" : "campDecision");
            keep = camp.keep;
          }
        } else if (auto && state.day !== null) {
          // The day could pay, so the hex itself was refused: a river without a boat, a closed pass.
          const way = await refusedHex(token, goal, path[n], avoid);
          if (way.route) { path = way.route.path; costs = way.route.costs; n = 0; continue; }
          stopReason = way.stop ?? "blocked"; keep = !!way.keep;
        }
        stopReason ??= "blocked";
        break;
      }
      moved++;
      slideEnd = Math.max(slideEnd, performance.now()) + (doc.object ? doc.movement?.animation?.duration ?? 0 : 0);
      // After the active GM has priced, charged and clocked this hex, and rolled its checks.
      await travelSettled();
      if (auto && game.paused) { stopReason = "paused"; keep = true; break; }
      const state = overlandState();
      // An encounter: one that holds the clock, or one that hit at the step's very end.
      if (state.pending || state.encounter || hits() > before) {
        keep = true;
        if (_journey) { _journey.waitUntil = state.pending?.until ?? null; rememberJourney(); }
        break;
      }
      // The GM sent the token back: the day could not pay at its price, so camp and try again;
      // if the day could pay, the hex itself was refused, so route round it.
      if (auto && offsetKey(grid.getOffset(doc.getCenterPoint(doc._source))) !== offsetKey(path[n])) {
        if (state.day !== null && state.hexesLeft < (costs?.[n - 1] ?? 1)) {
          const camp = await campForJourney();
          if (camp.go) {
            const next = routeTo(token, goal);
            if (!next?.path || next.path.length < 2) { stopReason = "noRoute"; break; }
            path = next.path; costs = next.costs; n = 0; continue;
          }
          if (!camp.go) {
            if (camp.notice) ui.notifications?.warn(camp.notice);
            stopReason = (overlandState().pending || overlandState().encounter) ? "encounter" : (camp.keep ? "camp" : "campDecision");
            keep = camp.keep;
          }
        } else if (state.day !== null) {
          const way = await refusedHex(token, goal, path[n], avoid);
          if (way.route) { path = way.route.path; costs = way.route.costs; n = 0; continue; }
          stopReason = way.stop ?? "moved"; keep = !!way.keep;
        }
        stopReason ??= "moved";
        break;
      }
      // The next hex goes a beat before this slide ends, so the party walks on without a stop.
      const wait = slideEnd - chainLeadMs() - performance.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    }
    const s = overlandState();
    const there = auto && offsetKey(grid.getOffset(doc.getCenterPoint(doc._source))) === offsetKey(goal);
    if (auto && stopReason) notifyGmAutoStop(stopReason, token);
    else if (auto && !there) notifyGmAutoStop("stopped", token);
    if (there && !keep) {
      ui.notifications?.info(t("SDE.route.autoArrived"));
      void setAutoGoal(null);
    } else if (auto && !keep && s.autoGoal) {
      // A stop that is not the destination: the saved goal stays for Travel > Resume auto.
      ui.notifications?.info(t("SDE.route.autoStopped"));
    }
    if (moved && !s.pending && hits() === before && s.hex && !auto) {
      ui.notifications?.info(t("SDE.route.reached", {
        region: s.hex.region ?? "", terrain: (s.hex.terrain ?? "").replace(/_/g, " "),
        left: Math.max(0, s.budget - s.spent), budget: s.budget,
      }));
    }
  } catch (err) {
    console.error(`${MODULE_ID} | the party's walk stopped`, err);
    if (auto) notifyGmAutoStop("error", token);
  } finally {
    _walking = false;
    _hovered = null;
    if (auto) {
      if (!keep) forgetJourney();
      else rememberJourney();
    }
    if (doc.parent === canvas.scene) token.control?.({ releaseOthers: true });
  }
}

/**
 * A hex the walk was refused on although the day could pay (a river without a boat, a closed pass, a closed
 * destination). A hex on the way is routed round once. A destination that cannot be entered is asked about
 * first: ground that never opens ends the journey and drops its destination; a storm or today's weather is
 * waited out, a day at a time, and the walk goes on when it opens.
 * @returns {Promise<{route?:object, stop?:string, keep?:boolean}>} a new route to walk, or why the walk stops
 *   (no `stop`: the caller's own reason)
 */
async function refusedHex(token, goal, attempted, avoid) {
  if (attempted && offsetKey(attempted) !== offsetKey(goal)) {
    avoid.add(offsetKey(attempted));
    const reroute = routeTo(token, goal, avoid);
    if (reroute?.path && reroute.path.length >= 2) return { route: reroute };
  }
  const blocked = await travelBlocked(goal);
  if (blocked === "terrain") {
    ui.notifications?.warn(t("SDE.route.autoPermanent"));
    try { await setAutoGoal(null); } catch (err) { console.warn(`${MODULE_ID} | the automatic journey's goal was not cleared`, err); }
    return { stop: "blocked" };
  }
  if (!blocked) return attempted && offsetKey(attempted) === offsetKey(goal) ? { stop: "blocked" } : {};
  if (!(await waitOutDays(token, goal, blocked))) return { stop: "blocked", keep: true };
  const next = routeTo(token, goal, avoid);
  if (!next?.path) { ui.notifications?.warn(t("SDE.route.autoNoRoute")); return { stop: "noRoute" }; }
  if (next.path.length < 2) return { stop: "noRoute" };
  return { route: next };
}

/**
 * Walk out a day the party cannot travel on: the day's own camp is made, and if the camp needs a
 * decision (short rations, a forbidden Hunt, an interrupted rest) the window waits for the table —
 * the day is never closed without a camp. Then the next dawn is opened, and the ones after it, until
 * the way opens or a fortnight of days has gone by (the journey then stops and the tab says why).
 * @param {Token} token  the travel token
 * @param {{i:number, j:number}} goal  the destination
 * @param {"storm"|"weather"|"terrain"} block  what closed the day
 * @returns {Promise<boolean>} whether a day is open and the party may walk again
 */
async function waitOutDays(token, goal, block) {
  if (block === "terrain") {
    ui.notifications?.warn(t("SDE.route.autoPermanent"));
    return false;
  }
  const reason = t(block === "storm" ? "SDE.route.autoStorm" : "SDE.route.autoTerrain");
  let days = 0;
  for (;;) {
    if (game.paused) { ui.notifications?.info(t("SDE.route.autoPaused")); return false; }
    days++;
    const state = overlandState();
    if (state.day !== null) {
      // A storm day still ends in a camp. Short rations, or a task the storm forbids, open the camp
      // window for the table; they never close the day without the party camping.
      const night = await campForJourney();
      if (!night.go) { if (night.notice) ui.notifications?.warn(night.notice); return false; }
      // Camping rolls the night's checks: a creature met during one is the GM's to run, and the journey waits for it.
      if (overlandState().pending || overlandState().encounter) return false;
    }
    const reply = await autoStartDay();
    if (!reply?.ok) { if (reply?.error) ui.notifications?.warn(reply.error); return false; }
    // The day's catch-up check can draw the very creature the closed way is waiting out: the GM runs it first.
    if (reply.encounter) return false;
    const now = await travelBlocked(goal);
    if (now === "terrain") {
      game.socket?.emit(`module.${MODULE_ID}`, { type: "autoDays", days, halted: "terrain" });
      ui.notifications?.warn(t("SDE.route.autoPermanent"));
      return false;
    }
    if (!now) {
      game.socket?.emit(`module.${MODULE_ID}`, { type: "autoDays", days, halted: null });
      ui.notifications?.info(t("SDE.route.autoDays", { days, reason }));
      const route = routeTo(token, goal);
      return !!route?.path && route.path.length >= 2;
    }
    if (days >= 14) {
      game.socket?.emit(`module.${MODULE_ID}`, { type: "autoDays", days, halted: block });
      ui.notifications?.warn(t("SDE.route.autoNoWalk", { days, reason }));
      return false;
    }
  }
}

/**
 * Why a camp stopped the journey, in the player's terms: the camp window's own blocker. There is no
 * generic "decision" left for the player to guess at.
 * @returns {string} a localized notice naming the choice the camp is waiting for
 */
function campStopNotice() {
  try {
    const now = overlandState();
    if (now.pending || now.encounter) return t("SDE.overland.notify.pending");
    const party = now.camp?.party ? fromUuidSync(now.camp.party) : travelParty();
    const camp = party ? campOf(party) : null;
    if (!camp) return t("SDE.route.autoCamp");
    if (AUTO_BLOCKED[camp.autoBlocked]) return t(AUTO_BLOCKED[camp.autoBlocked]);
    if (camp.shortageWarning) return t("SDE.route.autoCampRations");
    if (camp.fuelShort !== undefined && camp.fuelShort !== null) return t("SDE.route.autoCampTorches", { have: camp.fuelShort });
    if (camp.phase === "awaitingRest") return t("SDE.route.autoCampNight");
    return t("SDE.route.autoCampChoose");
  } catch { return t("SDE.route.autoCamp"); }
}

/**
 * One automatic camp, then its dawn.
 * @returns {Promise<{go:boolean, keep:boolean, notice?:string}>} `go`: a new day is open and the journey can move;
 *   `keep`: an encounter stopped it, so the journey waits for Resume clock
 */
async function campForJourney() {
  if (game.paused) { ui.notifications?.info(t("SDE.route.autoPaused")); return { go: false, keep: true }; }
  const reply = await makeCamp();
  // The caller shows the notice, once.
  if (!reply?.ok) return { go: false, keep: false, notice: reply?.error };
  // The camp opened its window for a decision (rations, torches, a task with no target): stop here,
  // and say which decision instead of the old generic "the camp needs a decision".
  if (reply.setup) return { go: false, keep: false, notice: campStopNotice() };
  const state = overlandState();
  if (reply.stopped || state.pending || state.encounter) {
    if (_journey) { _journey.waitUntil = state.pending?.until ?? null; rememberJourney(); }
    return { go: false, keep: true, notice: campStopNotice() };
  }
  // A camp that is still recorded after makeCamp did not finish: name what it is waiting for.
  if (state.camp) return { go: false, keep: false, notice: campStopNotice() };
  return { go: state.auto && state.day !== null, keep: false };
}

/** Pick the journey up after its encounter, camp or scene settles; never while the game is paused. */
function maybeResumeJourney() {
  _journeyTimer = null;
  void runJourneyStep();
}

/** One attempt at the journey, with nothing thrown out of it: an error stops this tab's journey and says so. */
function runJourneyStep() {
  return journeyStep().catch((err) => {
    console.error(`${MODULE_ID} | the automatic journey`, err);
    ui.notifications?.warn(t("SDE.route.autoError", { reason: String(err?.message ?? err) }));
    forgetJourney();
  });
}

/**
 * Hold this tab's one walk across the awaits before it starts (a day to open, a camp to finish, a closed
 * destination to ask about), so a second resume, hook or click meanwhile is refused rather than starting a
 * second walk. `work` answers with `{ walk: { token, route } }` to start the journey's walk, or with a reply.
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
async function claimWalk(work) {
  if (_walking) return { ok: false, error: t("SDE.route.autoBusy") };
  _walking = true;
  let reply;
  try { reply = await work(); } finally { _walking = false; }
  // Nothing awaits between the release and the walk's own claim, so nothing can start in between.
  if (reply?.walk) { void walk(reply.walk.token, reply.walk.route, true); return { ok: true }; }
  return reply ?? { ok: false };
}

function journeyStep() {
  if (!_journey || _walking) return Promise.resolve();
  return claimWalk(journeyStart);
}

/** What the journey does next on this tab, inside claimWalk: a walk to start, or nothing yet. */
async function journeyStart() {
  if (!_journey) return null;
  const state = overlandState();
  if (!state.auto) { forgetJourney(); return null; }
  if (!CrawlState.isOverland || game.paused || state.pending || state.encounter || state.camp) return null;
  // Rescheduled once this claim is released, or the timer would find this tab still busy.
  if (_journey.waitUntil !== null && game.time.worldTime < _journey.waitUntil) { setTimeout(scheduleJourneyResume, 0); return null; }
  const token = canvas?.tokens?.placeables?.find((p) => p.document.uuid === _journey.tokenUuid);
  if (!token) {
    // A scene change (an encounter, a battle map) leaves the token in its own scene: wait for that
    // canvas rather than dropping the journey. Only a token that no longer exists ends it.
    let doc = null;
    try { doc = fromUuidSync(_journey.tokenUuid); } catch { /* not a document */ }
    if (doc) return null;
    forgetJourney();
    return null;
  }
  if (token.document.parent !== canvas.scene) return null;
  // The way may be open and the day closed (a storm walked out, a day ended by a stop): the day comes first.
  if (overlandState().day === null) {
    const started = await autoStartDay();
    if (!started?.ok) { ui.notifications?.warn(started?.error ?? t("SDE.route.autoNoRoute")); return null; }
    // Auto turned off, or the journey dropped, while the day opened.
    if (!_journey) return null;
  }
  const goal = _journey.goal;
  const route = routeTo(token, goal);
  if (route?.path) {
    if (route.path.length < 2) {
      void setAutoGoal(null);
      ui.notifications?.info(t("SDE.route.autoArrived"));
      forgetJourney();
      return null;
    }
    _journey.waitUntil = null;
    rememberJourney();
    return { walk: { token, route } };
  }
  // No route is not always the end: a storm, or the weather closing the destination today, is a day that has
  // to end and come round again. The walk ends those days. Ground that never opens ends the journey.
  const waiting = route?.blocked ? await travelBlocked(goal) : null;
  if (!_journey) return null;
  if (waiting === "terrain") {
    ui.notifications?.warn(t("SDE.route.autoPermanent"));
    void setAutoGoal(null);
    forgetJourney();
    return null;
  }
  if (!waiting) {
    ui.notifications?.warn(t("SDE.route.autoNoRoute"));
    forgetJourney();
    return null;
  }
  _journey.waitUntil = null;
  rememberJourney();
  // The token's own hex leads so the walk has a step to take; the goal is all it is going to.
  return { walk: { token, route: { path: [canvas.grid.getOffset(token.center), goal], costs: [1] } } };
}

/** Resume a stopped journey after this client's state settles (Resume clock's advance runs first). */
function scheduleJourneyResume() {
  if (_walking) return;
  if (!_journey) restoreJourney();
  if (!_journey) return;
  clearTimeout(_journeyTimer);
  _journeyTimer = setTimeout(maybeResumeJourney, _journey.waitUntil === null ? 0 : 1200);
}

/** Fast travel (GM): the party arrives at the end of `path` at once, nothing priced (overland.fastTravel). */
async function jump(token, path) {
  _walking = true;
  forgetJourney();
  clear();
  try {
    const reply = await fastTravel(path.at(-1));
    if (!reply?.ok) ui.notifications?.warn(reply?.error ?? t("SDE.overland.notify.fastNowhere"));
    else {
      const hex = overlandState().hex;
      ui.notifications?.info(t("SDE.route.fastReached", { region: hex?.region ?? "", terrain: (hex?.terrain ?? "").replace(/_/g, " ") }));
    }
  } catch (err) {
    console.error(`${MODULE_ID} | the party's fast travel failed`, err);
  } finally {
    _walking = false;
    _hovered = null;
    if (token.document.parent === canvas.scene) token.control?.({ releaseOthers: true });
  }
}

/**
 * Pick up the automatic journey at its saved destination (GM, or the travel-panel button): route
 * from the party's current hex to `overlandState().autoGoal` and walk it. This is how a stop at a
 * keyed location, a scene, a camp decision or any other interruption is resumed after the
 * in-memory walk ended.
 * @returns {Promise<{ok:boolean, error?:string}>}
 */
export async function resumeAutoTravel() {
  const state = overlandState();
  if (!state.auto) return { ok: false, error: t("SDE.overland.notify.autoOff") };
  if (!state.autoGoal) return { ok: false, error: t("SDE.overland.notify.autoNoGoal") };
  if (!CrawlState.isOverland) return { ok: false, error: t("SDE.overland.notify.notTravelling") };
  if (_walking) return { ok: false, error: t("SDE.route.autoBusy") };
  if (game.paused) { ui.notifications?.info(t("SDE.route.autoPaused")); return { ok: false, error: t("SDE.route.autoPaused") }; }
  if (state.pending || state.encounter) return { ok: false, error: t("SDE.overland.notify.pending") };
  return claimWalk(() => resumeStart(state));
}

/** Resume auto's checks and its day, inside claimWalk: the walk to start, or why not. */
async function resumeStart(state) {
  // A camp left for its Night is not a choice: finish it here, exactly as an automatic camp does.
  // A camp with a real choice opens its window and returns that choice's own message.
  if (state.camp) {
    const camp = await campForJourney();
    if (!camp.go) return { ok: false, error: camp.notice ?? t("SDE.overland.notify.campPending") };
    state = overlandState();
  }
  if (!isHexMapScene()) return { ok: false, error: t("SDE.route.autoMap") };
  let doc = null;
  try { doc = state.tokenUuid ? fromUuidSync(state.tokenUuid) : null; } catch { /* not a document */ }
  if (!doc || doc.parent !== canvas.scene) return { ok: false, error: t("SDE.route.autoToken") };
  if (!game.user.isGM && !doc.actor?.testUserPermission(game.user, "OWNER")) return { ok: false, error: t("SDE.overland.notify.notPartyOwner", { name: game.user.name }) };
  const token = canvas.tokens.placeables.find((tok) => tok.document.uuid === doc.uuid);
  if (!token) return { ok: false, error: t("SDE.route.autoToken") };
  // The day comes first: with the way closed, the days are ended inside the walk, which needs one to camp in.
  if (state.day === null) {
    const started = await autoStartDay();
    if (!started?.ok) return { ok: false, error: started?.error ?? t("SDE.overland.notify.notTravelling") };
  }
  const goal = overlandState().autoGoal ?? state.autoGoal;
  const route = routeTo(token, goal);
  if (!route?.path) {
    // A storm, or the weather closing the destination today, is not a dead end: the walk ends those days and
    // tries each dawn until the way opens. Ground that never opens drops the destination; one with no way
    // there at all stays saved.
    const waiting = route?.blocked ? await travelBlocked(goal) : null;
    if (waiting === "terrain") {
      void setAutoGoal(null);
      return { ok: false, error: t("SDE.route.autoPermanent") };
    }
    if (!waiting) return { ok: false, error: t("SDE.route.autoNoRoute") };
    return { walk: { token, route: { path: [canvas.grid.getOffset(token.center), goal], costs: [1] } } };
  }
  if (route.path.length < 2) {
    void setAutoGoal(null);
    ui.notifications?.info(t("SDE.route.autoArrived"));
    return { ok: true };
  }
  return { walk: { token, route } };
}

/** Whether this user has the Resume auto button: a GM, or an owner of the travel token's actor. */
function mayResume(state) {
  if (game.user.isGM) return true;
  try { return !!fromUuidSync(state.tokenUuid ?? "")?.actor?.testUserPermission(game.user, "OWNER"); } catch { return false; }
}

/** The route layer and its pointer listeners, on each canvas. Call in init. */
export function registerRoute() {
  Hooks.on("canvasReady", () => {
    _graphics = new PIXI.Graphics();
    _labels = new PIXI.Container();
    const box = new PIXI.Container();
    box.eventMode = "none";
    box.addChild(_graphics, _labels);
    canvas.interface.addChild(box);
    canvas.stage.on("pointermove", onMove);
    canvas.stage.on("pointerdown", onDown);
    canvas.stage.on("pointerup", onUp);
    _armed = null;
    _hovered = null;
    _press = null;
  });
  Hooks.on("canvasTearDown", () => {
    canvas.stage?.off("pointermove", onMove);
    canvas.stage?.off("pointerdown", onDown);
    canvas.stage?.off("pointerup", onUp);
    _press = null;
    clear();
    _graphics = null;
    _labels = null;
  });
  // Deselecting the party clears the route.
  Hooks.on("controlToken", (token, controlled) => {
    if (!controlled && !_walking && token.document.uuid === overlandState().tokenUuid) { _armed = null; _hovered = null; clear(); }
  });
  // An automatic journey waits out an encounter, a battle or a pause, then goes on by itself.
  Hooks.on(OVERLAND_CHANGED, (state) => {
    if (state?.auto !== true) { forgetJourney(); return; }
    scheduleJourneyResume();
  });
  Hooks.on(CrawlState.HOOK_CHANGED, scheduleJourneyResume);
  Hooks.on("pauseGame", (paused) => {
    if (paused) return;
    // A journey wins the pause; without one, say where a saved journey is picked up.
    restoreJourney();
    const state = overlandState();
    if (!_journey && state.auto && state.autoGoal && !state.pending && !state.encounter && !state.camp && mayResume(state)) {
      ui.notifications?.info(t("SDE.route.autoResumeHint"));
    }
    scheduleJourneyResume();
  });
  Hooks.on("canvasReady", scheduleJourneyResume);
  // A move the party did not make on its journey (a GM's drag, another owner's walk) ends the journey.
  // While an encounter or camp holds it, the move is that scene's, not a new travel order: keep the journey.
  Hooks.on("moveToken", (doc) => {
    if (_walking || !_journey || doc.uuid !== _journey.tokenUuid) return;
    const state = overlandState();
    if (state.pending || state.encounter || state.camp) return;
    forgetJourney();
  });
}
