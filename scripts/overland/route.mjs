/**
 * Shadowdark Enhancer — the route on the hex map (#257, the demo's click-to-travel).
 *
 * While travelling on a tagged hex map with the travel token selected, the
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
import { overlandState, travelStepCost, travelSettled } from "./overland.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const offsetKey = (o) => `${o.i},${o.j}`;

let _graphics = null;
let _labels = null;
let _tip = null;
let _hovered = null;
let _armed = null;
let _press = null;
let _walking = false;

/** Held at least this long, a press is core's ping, not a click. */
const LONG_PRESS = foundry.canvas?.interaction?.MouseInteractionManager?.LONG_PRESS_DURATION_MS ?? 500;

/** The travel token, when this user has it selected on a tagged hex map while travelling. */
function travelToken() {
  const s = overlandState();
  if (!CrawlState.isOverland || !isHexMapScene() || !s.tokenUuid) return null;
  return canvas.tokens.controlled.find((tok) => tok.document.uuid === s.tokenUuid) ?? null;
}

/**
 * Which hexes a player can't know the cost of: those Extras' hex fog hasn't
 * shown them (its api.hex.isPositionRevealed). The GM knows every hex, and so
 * does a player on a map with no hex fog (no Extras). ponytail: with Extras
 * on but without that API yet (Extras #185), a player knows none.
 * @returns {(o:{i:number, j:number}) => boolean}
 */
function unknownTo(grid) {
  if (game.user.isGM) return () => false;
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
function routeTo(token, goal) {
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
  if (!hex(goal)) return { blocked: null };
  const hidden = new Set();
  const cost = (from, to) => {
    if (unknown(to)) { hidden.add(offsetKey(to)); return 1; }
    return costOf(hex(to), hex(from)) ?? 1;
  };
  const route = cheapestRoute({
    start: grid.getOffset(token.center), goal, key: offsetKey,
    neighbours: (o) => grid.getAdjacentOffsets(o).filter((n) => hex(n)),
    cost,
    distance: (a, b) => {
      const A = grid.getCube(a), B = grid.getCube(b);
      return Math.max(Math.abs(A.q - B.q), Math.abs(A.r - B.r), Math.abs(A.s - B.s));
    },
  });
  if (!route) return { blocked: hex(goal) };
  const costs = route.path.slice(1).map((o, i) => (hidden.has(offsetKey(o)) ? null : cost(route.path[i], o)));
  return { ...route, costs, unknown: costs.includes(null) };
}

function clear() {
  _graphics?.clear();
  for (const child of _labels?.removeChildren() ?? []) child.destroy();
  if (_tip) _tip.hidden = true;
}

/** The route drawn on the map: a white line through the hex centres, each hex outlined with its cost. */
function draw(route) {
  clear();
  if (!route?.path || route.path.length < 2) return;
  const grid = canvas.grid;
  const w = Math.max(2, grid.size / 45);
  const g = _graphics;
  const centres = route.path.map((o) => grid.getCenterPoint(o));
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
    const c = centres[i + 1];
    const poly = grid.getVertices(o).flatMap((p) => [c.x + (p.x - c.x) * 0.9, c.y + (p.y - c.y) * 0.9]);
    g.lineStyle(w * 2.4, 0x000000, 0.6);
    g.drawPolygon(poly);
    g.lineStyle(w, 0xffffff, 0.9);
    g.beginFill(0xffffff, 0.12);
    g.drawPolygon(poly);
    g.endFill();
    const r = grid.size * 0.11, by = c.y + grid.size * 0.3;
    g.lineStyle(w * 0.6, 0xc9c9c9, 1);
    g.beginFill(0x000000, 1);
    g.drawCircle(c.x, by, r);
    g.endFill();
    const c0 = route.costs[i];
    const label = new PIXI.Text(c0 === null ? "?" : Number.isFinite(c0) ? String(c0) : "✕", {
      fontFamily: "Montserrat-Bold", fontSize: Math.round(r * 1.25), fill: 0xffffff,
    });
    label.anchor.set(0.5);
    label.position.set(c.x, by);
    _labels.addChild(label);
  });
}

/** The tooltip at the cursor: the route's hexes, miles, points and hours, or why there's no way. */
function showTip(event, route) {
  if (!_tip) {
    _tip = document.createElement("div");
    _tip.id = "sde-route-tip";
    document.body.append(_tip);
  }
  const s = overlandState();
  const left = Math.max(0, s.budget - s.spent);
  let text;
  if (!route?.path) {
    text = route?.blocked?.terrain
      ? t("SDE.route.closed", { terrain: route.blocked.terrain.replace(/_/g, " ") })
      : t("SDE.route.none");
  } else {
    const hexes = route.path.length - 1;
    const dist = canvas.scene.grid.distance ?? 6, units = canvas.scene.grid.units ?? "";
    const days = game.time.calendar?.days;
    const hourSeconds = (days?.secondsPerMinute ?? 60) * (days?.minutesPerHour ?? 60);
    const hours = Math.round((route.cost * (s.pointSeconds || 0) * 10) / hourSeconds) / 10;
    const miles = hexes * dist;
    if (route.unknown) text = t(hexes === 1 ? "SDE.route.tipOneUnknown" : "SDE.route.tipUnknown", { hexes, miles, units });
    else {
      text = t(hexes === 1 ? "SDE.route.tipOne" : "SDE.route.tip", { hexes, miles, units, cost: route.cost, hours });
      if (route.cost > left) text += t("SDE.route.over", { left });
    }
  }
  _tip.textContent = text;
  _tip.hidden = false;
  moveTip(event);
}

function moveTip(event) {
  if (!_tip || _tip.hidden) return;
  const x = event.client?.x ?? event.clientX ?? 0, y = event.client?.y ?? event.clientY ?? 0;
  _tip.style.left = `${x + 14}px`;
  _tip.style.top = `${y}px`;
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
  _armed = route?.path ? { token, route } : null;
  draw(route);
  showTip(event, route);
}

/** A press only arms: the walk waits for the release, so a box-select drag or a ping isn't a click. */
function onDown(event) {
  _press = null;
  if (event.button !== 0 || _walking || !overMap(event)) return;
  // A click on a token, a note or a control is theirs, not a destination.
  if (event.target && event.target !== canvas.stage && event.target.document) return;
  // Routes again when the shown route is stale, and for a touch tap, which has no move first.
  hover(event);
  if (_armed) _press = { x: event.global.x, y: event.global.y, at: event.timeStamp, key: _hovered, armed: _armed };
}

function onUp(event) {
  const p = _press;
  _press = null;
  if (!p || event.button !== 0 || _walking || p.key !== _hovered) return;
  if (Math.hypot(event.global.x - p.x, event.global.y - p.y) > 5) return;
  if (event.timeStamp - p.at >= LONG_PRESS) return;
  if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return;
  const { token, route } = p.armed;
  _armed = null;
  if (moveBlocked(token)) return;
  void walk(token, route.path);
}

/**
 * What core refuses a mover in its UI, which a walk's document moves go around:
 * a player moving while the game is paused, and a locked token. Warns as core does.
 */
function moveBlocked(token) {
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

/**
 * Walk the party along `path` (its first hex the one it starts in), one hex a
 * move, until the end, an encounter, a refusal, a pause, or someone else
 * moving the party.
 */
async function walk(token, path) {
  _walking = true;
  clear();
  const doc = token.document;
  // The token's own scene's grid: the viewer may be pulled to another scene mid-walk.
  const grid = doc.parent.grid;
  const hits = () => overlandState().checks.filter((c) => c.hit).length;
  const before = hits();
  let moved = 0;
  try {
    for (let n = 1; n < path.length; n++) {
      if (moveBlocked(token)) break;
      // Someone else moved the party (another owner's walk, a GM's drag): stop here. The
      // stored position, not doc.x/y, which follow the movement animation.
      if (offsetKey(grid.getOffset(doc.getCenterPoint(doc._source))) !== offsetKey(path[n - 1])) break;
      const { x, y } = grid.getTopLeftPoint(path[n]);
      // Resolves once the move is saved; the token is still sliding into the hex.
      if (!(await doc.move({ x, y }))) break;
      moved++;
      // After the active GM has priced, charged and clocked this hex, and rolled its checks.
      await travelSettled();
      // An encounter: one that holds the clock, or one that hit at the step's very end.
      if (overlandState().pending || hits() > before) break;
      // Hex by hex on screen: the next step starts when this one's slide ends.
      await doc.object?.movementAnimationPromise;
    }
    const s = overlandState();
    if (moved && !s.pending && hits() === before && s.hex) {
      ui.notifications?.info(t("SDE.route.reached", {
        region: s.hex.region ?? "", terrain: (s.hex.terrain ?? "").replace(/_/g, " "),
        left: Math.max(0, s.budget - s.spent), budget: s.budget,
      }));
    }
  } catch (err) {
    console.error(`${MODULE_ID} | the party's walk stopped`, err);
  } finally {
    _walking = false;
    _hovered = null;
    if (doc.parent === canvas.scene) token.control?.({ releaseOthers: true });
  }
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
}
