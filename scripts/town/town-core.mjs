/**
 * Shadowdark Enhancer — a town's landing page, as the GM sets it up (pure).
 *
 * A landing page is a small flag on the scene the players arrive in. The scene's own picture is the page (set in the
 * scene's settings); the flag holds the menu drawn over it:
 *
 *   flags[MODULE_ID].landing = { title, tagline, blurb, places: [...], merchants: [...], games: {...}, shown }
 *
 * `games` is the town's table of games of chance: `{ on, maxBet, edge }` (off until the GM turns it on; the largest
 * bet in gp; the share of winnings the house keeps, in %). The games themselves are in games-core.mjs.
 *
 * `shown` is the GM's switch for the whole table: every client follows it, so the page goes up for everyone or away
 * from everyone (town-entry-points.mjs). It is on unless it is switched off.
 *
 * A merchant is a REFERENCE to an NPC actor, never a copy of its wares: the NPC's own items are the stock, and the
 * town shop reads them live (merchant/shop-core.mjs). Everything players need to see rides on this flag, so it stays
 * small: scene flags reach every client in the world, hidden scenes included.
 *
 *   { id, actorId, role, pitch, open, rev, buyMultiplier, sellRatio }
 *
 * `id` names the merchant in each buyer's stock ledger, so it never changes after it is made. `rev` is the restock
 * counter: raising it puts the whole shelf back without writing to any player.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { STOCK_TYPES } from "../merchant/shop-core.mjs";

export const LANDING_FLAG = "landing";
/** Every tile a page may carry, in the order they show (the editor lists these). Carouse and Rumors make a tavern. */
export const PLACE_IDS = ["quests", "journals", "party", "downtime", "carouse", "rumors"];
/** The tiles a page gets when it has no list yet: the town's four, never the tavern's. */
export const DEFAULT_PLACE_IDS = ["quests", "journals", "party", "downtime"];
/** `games` is an entry too, but a separate switch (the GM turns the table on), so it is not one of the tiles above. */
export const PLACE_LABEL_KEYS = { quests: "SDE.town.place.quests", journals: "SDE.town.place.journals", party: "SDE.town.place.party", downtime: "SDE.town.place.downtime", carouse: "SDE.town.place.carouse", rumors: "SDE.town.place.rumors", games: "SDE.town.place.games" };
export const LIMITS = { buyMultiplier: [10, 500], sellRatio: [0, 100], maxBet: [1, 1000], edge: [0, 50] };
export const DEFAULTS = { open: true, rev: 0, buyMultiplier: 100, sellRatio: 50 };
export const GAME_DEFAULTS = { on: false, maxBet: 10, edge: 5 };

const text = (value, max) => String(value ?? "").trim().slice(0, max);
const whole = (value, [lo, hi], fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
/** An id becomes a flag key in every buyer's ledger, and a dot or a space would split or break the path. */
export const idOk = (id) => typeof id === "string" && id !== "" && !/[.\s]/.test(id);
const on = (value) => value === true || value === "on" || value === "true";

/** One merchant reference as stored, or null when it cannot work (no usable id or no NPC). */
export function normalizeMerchant(raw) {
  if (!raw || !idOk(raw.id) || typeof raw.actorId !== "string" || !raw.actorId) return null;
  return {
    id: raw.id, actorId: raw.actorId,
    role: text(raw.role, 60), pitch: text(raw.pitch, 200),
    open: raw.open === undefined ? DEFAULTS.open : on(raw.open),
    rev: Math.max(0, Math.floor(Number(raw.rev) || 0)),
    buyMultiplier: whole(raw.buyMultiplier, LIMITS.buyMultiplier, DEFAULTS.buyMultiplier),
    sellRatio: whole(raw.sellRatio, LIMITS.sellRatio, DEFAULTS.sellRatio),
  };
}

/** The town's games table as stored: off unless on, the largest bet in whole gp and the house's share in whole %, each in range. */
export function normalizeGames(raw) {
  return {
    on: on(raw?.on),
    maxBet: whole(raw?.maxBet, LIMITS.maxBet, GAME_DEFAULTS.maxBet),
    edge: whole(raw?.edge, LIMITS.edge, GAME_DEFAULTS.edge),
  };
}

/** A landing page as stored, with every field present, every value in range, and one reference per NPC. */
export function normalizeLanding(raw) {
  const seen = new Set(), actors = new Set();
  const merchants = [];
  for (const entry of Array.isArray(raw?.merchants) ? raw.merchants : []) {
    const m = normalizeMerchant(entry);
    if (!m || seen.has(m.id) || actors.has(m.actorId)) continue;
    seen.add(m.id); actors.add(m.actorId); merchants.push(m);
  }
  return {
    title: text(raw?.title, 80), tagline: text(raw?.tagline, 120), blurb: text(raw?.blurb, 600),
    places: Array.isArray(raw?.places) ? PLACE_IDS.filter((p) => raw.places.includes(p)) : [...DEFAULT_PLACE_IDS],
    merchants,
    games: normalizeGames(raw?.games),
    shown: raw?.shown !== false,
  };
}

/** The GM's switch for the whole table: whether the page is up for everyone on this scene (a page is up until it is switched off). */
export const setShown = (landing, shown) => normalizeLanding({ ...landing, shown: !!shown });

/** The landing page on a scene (or null when the scene has none). */
export const landingOf = (scene) => (scene?.flags?.[MODULE_ID]?.[LANDING_FLAG] ? normalizeLanding(scene.flags[MODULE_ID][LANDING_FLAG]) : null);

/** The NPC actors a GM can still add: not a party, not already on this page. */
export function linkableNpcs(actors, landing) {
  const taken = new Set((landing?.merchants ?? []).map((m) => m.actorId));
  return [...actors].filter((a) => a.type === "NPC" && !a.flags?.[MODULE_ID]?.party && !a.flags?.["shadowdark-extras"]?.isParty && !taken.has(a.id))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** How many of an NPC's items a town shop would list. */
export const waresCount = (actor) => [...(actor?.items ?? [])].filter((i) => STOCK_TYPES.includes(i.type)).length;

/** Add an NPC as a merchant. Returns the new landing page, unchanged when the NPC is already on it. */
export function addMerchant(landing, actorId, makeId) {
  const page = normalizeLanding(landing);
  if (typeof actorId !== "string" || !actorId || page.merchants.some((m) => m.actorId === actorId)) return page;
  const taken = new Set(page.merchants.map((m) => m.id));
  let id = null;
  for (let i = 0; i < 8 && !id; i++) { const tried = makeId(); if (idOk(tried) && !taken.has(tried)) id = tried; }
  if (!id) throw new Error("town: could not make a merchant id");
  return normalizeLanding({ ...page, merchants: [...page.merchants, { ...DEFAULTS, id, actorId }] });
}

export const removeMerchant = (landing, id) => normalizeLanding({ ...landing, merchants: normalizeLanding(landing).merchants.filter((m) => m.id !== id) });

const change = (landing, id, fn) => normalizeLanding({ ...landing, merchants: normalizeLanding(landing).merchants.map((m) => (m.id === id ? fn(m) : m)) });
/** Put one merchant's whole shelf back (its revision goes up; nothing else moves). */
export const restockMerchant = (landing, id) => change(landing, id, (m) => ({ ...m, rev: m.rev + 1 }));
export const restockAll = (landing) => normalizeLanding({ ...landing, merchants: normalizeLanding(landing).merchants.map((m) => ({ ...m, rev: m.rev + 1 })) });

/**
 * Fold the editor's form into a landing page. `fields` is the whole form as a flat object: `title`, `tagline`,
 * `blurb`, a `place.<id>` checkbox per tile, `games.on` / `games.maxBet` / `games.edge` for the games table (`on` is a
 * checkbox, so absent means off), and `m.<merchantId>.<field>` for each merchant (`open` is a checkbox too). A
 * merchant, or the games table, that the form does not mention is left as it was.
 */
export function applyForm(landing, fields) {
  const page = normalizeLanding(landing);
  const merchants = page.merchants.map((m) => {
    if (!Object.keys(fields).some((k) => k.startsWith(`m.${m.id}.`))) return m;
    const f = (name) => fields[`m.${m.id}.${name}`];
    return { ...m, role: f("role") ?? m.role, pitch: f("pitch") ?? m.pitch, open: on(f("open")), buyMultiplier: f("buyMultiplier") ?? m.buyMultiplier, sellRatio: f("sellRatio") ?? m.sellRatio };
  });
  const games = Object.keys(fields).some((k) => k.startsWith("games."))
    ? { on: on(fields["games.on"]), maxBet: fields["games.maxBet"] ?? page.games.maxBet, edge: fields["games.edge"] ?? page.games.edge }
    : page.games;
  return normalizeLanding({
    title: fields.title ?? page.title, tagline: fields.tagline ?? page.tagline, blurb: fields.blurb ?? page.blurb,
    places: PLACE_IDS.filter((p) => on(fields[`place.${p}`])), merchants, games, shown: page.shown,
  });
}
