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
 * encounter, a bounce, the end of the day's points.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { isActiveGM } from "../shared/gm-relay.mjs";
import { CrawlState } from "../crawl-strip/crawl-state.mjs";
import { isHexMapScene, hexReader } from "../encounter/encounter-terrain.mjs";
import { cheapestRoute } from "./overland-state-core.mjs";
import { overlandState, travelStepCost, travelSettled, OVERLAND_CHANGED } from "./overland.mjs";

const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const offsetKey = (o) => `${o.i},${o.j}`;

let _graphics = null;
let _labels = null;
let _tip = null;
let _hovered = null;
let _armed = null;
let _walking = false;

/** The travel token, when this user has it selected on a tagged hex map while travelling. */
function travelToken() {
  const s = overlandState();
  if (!CrawlState.isOverland || !isHexMapScene() || !s.tokenUuid) return null;
  return canvas.tokens.controlled.find((tok) => tok.document.uuid === s.tokenUuid) ?? null;
}

/** The cheapest route from the token's hex to `goal`, each step with its cost. */
function routeTo(token, goal) {
  const grid = canvas.grid;
  const read = hexReader(canvas);
  if (!read) return null;
  const costOf = travelStepCost();
  const cells = new Map();
  const hex = (o) => {
    const k = offsetKey(o);
    if (!cells.has(k)) cells.set(k, read(o));
    return cells.get(k);
  };
  const cost = (from, to) => costOf(hex(to), hex(from)) ?? 1;
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
  return { ...route, costs: route.path.slice(1).map((o, i) => cost(route.path[i], o)) };
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
    const label = new PIXI.Text(Number.isFinite(route.costs[i]) ? String(route.costs[i]) : "✕", {
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
    const hours = Math.round((route.cost * (s.pointSeconds || 0)) / 360) / 10;
    text = t(hexes === 1 ? "SDE.route.tipOne" : "SDE.route.tip", { hexes, miles: hexes * dist, units, cost: route.cost, hours });
    if (route.cost > left) text += t("SDE.route.over", { left });
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

function onMove(event) {
  if (_walking) return;
  const token = travelToken();
  if (!token) { if (_armed || _hovered) { _armed = null; _hovered = null; clear(); } return; }
  const goal = canvas.grid.getOffset(event.getLocalPosition(canvas.stage));
  const k = offsetKey(goal);
  if (k === _hovered) return moveTip(event);
  _hovered = k;
  if (k === offsetKey(canvas.grid.getOffset(token.center))) { _armed = null; return clear(); }
  const route = routeTo(token, goal);
  _armed = route?.path ? { token, route } : null;
  draw(route);
  showTip(event, route);
}

function onDown(event) {
  if (event.button !== 0 || _walking || !_armed) return;
  // A click on a token, a note or a control is theirs, not a destination.
  if (event.target && event.target !== canvas.stage && event.target.document) return;
  const { token, route } = _armed;
  _armed = null;
  void walk(token, route.path.slice(1));
}

/** The next overland change, or `ms`, whichever comes first: what a GM who isn't the active GM waits on. */
const changeOrTimeout = (ms) => new Promise((resolve) => {
  const id = Hooks.once(OVERLAND_CHANGED, () => { clearTimeout(timer); resolve(); });
  const timer = setTimeout(() => { Hooks.off(OVERLAND_CHANGED, id); resolve(); }, ms);
});

/** Walk the party along `steps`, one hex a move, until the end, an encounter or a refusal. */
async function walk(token, steps) {
  _walking = true;
  clear();
  try {
    for (const o of steps) {
      const { x, y } = canvas.grid.getTopLeftPoint(o);
      const moved = await token.document.move({ x, y });
      if (!moved) break;
      if (isActiveGM()) await travelSettled();
      else await changeOrTimeout(1500);
      if (overlandState().pending) break;
    }
    const s = overlandState();
    if (!s.pending && s.hex) {
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
    if (token.document?.parent === canvas.scene) token.control?.({ releaseOthers: true });
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
    _armed = null;
    _hovered = null;
  });
  Hooks.on("canvasTearDown", () => {
    canvas.stage?.off("pointermove", onMove);
    canvas.stage?.off("pointerdown", onDown);
    clear();
    _graphics = null;
    _labels = null;
  });
  // Deselecting the party clears the route.
  Hooks.on("controlToken", (token, controlled) => {
    if (!controlled && !_walking && token.document.uuid === overlandState().tokenUuid) { _armed = null; _hovered = null; clear(); }
  });
}

