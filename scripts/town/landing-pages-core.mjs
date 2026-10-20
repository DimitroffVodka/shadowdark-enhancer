/**
 * Shadowdark Enhancer — Town: the one landing page, made by the module (pure).
 *
 * There is one landing page for everything: a table the party sits at (landing-table-core.mjs). The first time the
 * GM takes everyone there, the module makes it: its scene, one merchant whose goods are rolled for the settlement's
 * size, Quests, Journals, Session recaps, Party, Map and Carouse on (Downtime too in a Town or bigger), every game offered. The
 * market's size follows the settlement the party is in when the hex data knows it, else a Town; the GM can change it
 * on the page. Everything stays editable with the pencil.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { TABLE_GAMES } from "./games-core.mjs";
import { DEFAULTS, LANDING_FLAG, PLACE_IDS, normalizeLanding } from "./town-core.mjs";

/** Marks the scene that is the table. */
export const TABLE_FLAG = "landingTable";
/** The merchant the table gets: the whole settlement's goods on one list. */
export const MADE_KIND = "outfitter";

/** The tiles the table has on: Quests, Journals, Session recaps, Party, Map and Carouse, plus Downtime in a Town or bigger. */
export const placesFor = (size) => PLACE_IDS.filter((id) => ["quests", "journals", "recaps", "party", "map", "carouse"].includes(id) || (id === "downtime" && size !== "village"));

/** The table's page as it starts: one rolled merchant (`merchantId` names it, `actorId` is its NPC), every game. */
export function madeLanding({ name, size, merchantId, actorId, role }) {
  return normalizeLanding({
    title: name, size, places: placesFor(size), games: { list: TABLE_GAMES },
    merchants: actorId ? [{ ...DEFAULTS, id: merchantId, actorId, role, stock: { kind: MADE_KIND, size } }] : [],
    shown: true,
  });
}

/** The table's scene: its picture at its own size, no grid, nothing hidden by fog, out of the navigation bar. */
export function madeSceneData({ name, src, width, height, landing, folder = null }) {
  return {
    name, width, height, padding: 0, folder, navigation: false,
    grid: { type: 0 }, tokenVision: false, fog: { exploration: false },
    levels: [{ name, background: { src }, textures: { fit: "fill", scaleX: 1, scaleY: 1, anchorX: 0.5, anchorY: 0.5 } }],
    flags: { [MODULE_ID]: { [LANDING_FLAG]: landing, [TABLE_FLAG]: true } },
  };
}

/**
 * Where Return goes once everyone moves from `from` (the active scene) to `to`: the scene they were on, or, when they
 * were already on a landing page, where that page returns to. Going to the page they are already on keeps its own.
 */
export function returnFor(to, from, landingOfScene) {
  if (!from || from.id === to.id) return landingOfScene(to)?.returnTo ?? null;
  return landingOfScene(from) ? landingOfScene(from).returnTo ?? null : from.id;
}

/**
 * The page at a new settlement size: its size, Downtime off in a Village and back on when it grows, and every rolled
 * merchant restocked for that size (its revision goes up, so the writer rolls its shelf again). Unchanged when the
 * size is the same.
 */
export function resized(page, size) {
  const p = normalizeLanding(page);
  if (p.size === size) return p;
  let places = p.places;
  if (size === "village") places = places.filter((id) => id !== "downtime");
  else if (p.size === "village") places = PLACE_IDS.filter((id) => places.includes(id) || id === "downtime");
  const merchants = p.merchants.map((m) => (m.stock ? { ...m, stock: { ...m.stock, size }, rev: m.rev + 1 } : m));
  return normalizeLanding({ ...p, size, places, merchants });
}
