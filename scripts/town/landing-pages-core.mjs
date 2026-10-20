/**
 * Shadowdark Enhancer — Town: making a landing page in one click, and the list of them (pure).
 *
 * "Make a landing page" asks four things, each with a default (name "Market", a Town, the Town picture or the
 * Western Reaches player map when the import made one, every game ticked), and the page it makes has the Quests,
 * Journals, Party and Map tiles on, Downtime too in a Town or bigger, Carouse and Rumors off, one merchant whose
 * shelf is rolled for the settlement's size, and the games ticked. Everything stays editable with the pencil.
 *
 * The toolbar's list shows the world's landing pages, and in the Western Reaches every settlement the hex import
 * knows, each made into a page the first time the GM opens it (`SETTLEMENT_FLAG` on its scene says which hex).
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { SIZES } from "../merchant/stock-generator.mjs";
import { TABLE_GAMES } from "./games-core.mjs";
import { DEFAULTS, LANDING_FLAG, PLACE_IDS, normalizeLanding } from "./town-core.mjs";

/** Marks a scene made for a Western Reaches settlement: `{ num }`, the hex it stands on. */
export const SETTLEMENT_FLAG = "landingSettlement";
/** The world setting holding the Western Reaches player map's path, once the import has cut it from the GM's book. */
export const PLAYER_MAP_SETTING = "landingPlayerMap";
/** The merchant every made page gets: the whole settlement's goods on one list. */
export const MADE_KIND = "outfitter";

const PLACES = `modules/${MODULE_ID}/assets/scenes/places`;
/** The shipped pictures (2-Minute Tabletop, CC BY-NC, credited in CREDITS.md), with their small copies for the chooser. */
export const PICTURES = [["town", "SDE.town.make.picture.town"], ["market", "SDE.town.make.picture.market"], ["tavern", "SDE.town.make.picture.tavern"]]
  .map(([id, labelKey]) => ({ id, src: `${PLACES}/${id}.webp`, thumb: `${PLACES}/thumbs/${id}.webp`, labelKey }));
export const PLAYER_MAP = "playerMap";

/** The pictures a GM can choose: the player map first when the world has one (it is then the default), then the shipped ones. */
export function pictureChoices(playerMapSrc) {
  const map = playerMapSrc ? [{ id: PLAYER_MAP, src: playerMapSrc, thumb: playerMapSrc, labelKey: "SDE.town.make.picture.playerMap" }] : [];
  return [...map, ...PICTURES];
}

/** The tiles a made page has on: Quests, Journals, Party and Map, plus Downtime in a Town or bigger. */
export const placesFor = (size) => PLACE_IDS.filter((id) => ["quests", "journals", "party", "map"].includes(id) || (id === "downtime" && size !== "village"));

/**
 * The Make form as asked: `fields` is the form as a flat object (`name`, `size`, `picture`, a `game.<id>` box per game).
 * Anything missing or unknown takes its default; `pictures` are the choices offered (pictureChoices).
 */
export function readMakeForm(fields, pictures, defaultName) {
  const size = SIZES.some((z) => z.id === fields.size) ? fields.size : "town";
  const picture = pictures.find((p) => p.id === fields.picture) ?? pictures[0];
  const games = TABLE_GAMES.filter((id) => fields[`game.${id}`] === "on" || fields[`game.${id}`] === true);
  return { name: String(fields.name ?? "").trim().slice(0, 80) || defaultName, size, src: picture.src, games };
}

/** The landing page a made scene starts with: one rolled merchant (`merchantId` names it, `actorId` is its NPC). */
export function madeLanding({ name, size, games, merchantId, actorId, role, tagline = "" }) {
  return normalizeLanding({
    title: name, tagline, size, places: placesFor(size), games: { list: games },
    merchants: actorId ? [{ ...DEFAULTS, id: merchantId, actorId, role, stock: { kind: MADE_KIND, size } }] : [],
    shown: true,
  });
}

/** The scene data of a made page: the picture as its background at its own size, no grid, nothing hidden by fog. */
export function madeSceneData({ name, src, width, height, landing, folder = null, settlement = null }) {
  const flags = { [MODULE_ID]: { [LANDING_FLAG]: landing, ...(settlement ? { [SETTLEMENT_FLAG]: settlement } : {}) } };
  return {
    name, width, height, padding: 0, folder, navigation: false,
    grid: { type: 0 }, tokenVision: false, fog: { exploration: false },
    levels: [{ name, background: { src }, textures: { fit: "fill", scaleX: 1, scaleY: 1, anchorX: 0.5, anchorY: 0.5 } }],
    flags,
  };
}

/**
 * Where Return goes once everyone moves from `from` (the active scene) to `to`: the scene they were on, or, when they
 * were already on a landing page, where that page returns to (so Return leads back to the adventure, not to the last
 * page). Going to the page they are already on keeps its own.
 */
export function returnFor(to, from, landingOfScene) {
  if (!from || from.id === to.id) return landingOfScene(to)?.returnTo ?? null;
  return landingOfScene(from) ? landingOfScene(from).returnTo ?? null : from.id;
}

/** The toolbar list's rows: every scene with a landing page, A to Z, marked where the table is and whether it is up. */
export function pageRows(scenes, activeId, landingOfScene) {
  return [...scenes].filter((s) => landingOfScene(s)).map((s) => {
    const page = landingOfScene(s);
    return { sceneId: s.id, name: page.title || s.name, size: page.size, here: s.id === activeId, shown: page.shown, settlement: s.flags?.[MODULE_ID]?.[SETTLEMENT_FLAG]?.num ?? null };
  }).sort((a, b) => a.name.localeCompare(b.name));
}

/** The hex import's settlements (keyed rows `{ num, name, feature }`), biggest first then A to Z, each with its page's scene when made. */
export function settlementRows(keyed, scenes) {
  const order = SIZES.map((z) => z.id), made = new Map();
  for (const s of scenes) { const num = s.flags?.[MODULE_ID]?.[SETTLEMENT_FLAG]?.num; if (Number.isInteger(num)) made.set(num, s.id); }
  const seen = new Set(), rows = [];
  for (const r of keyed ?? []) {
    const num = Number.parseInt(r?.num, 10);
    if (!order.includes(r?.feature) || !Number.isInteger(num) || seen.has(num) || !String(r.name ?? "").trim()) continue;
    seen.add(num);
    rows.push({ num, name: String(r.name).trim(), size: r.feature, sceneId: made.get(num) ?? null });
  }
  return rows.sort((a, b) => order.indexOf(b.size) - order.indexOf(a.size) || a.name.localeCompare(b.name));
}
