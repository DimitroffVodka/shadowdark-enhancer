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
 *   { id, actorId, role, pitch, open, rev, buyMultiplier, sellRatio, restockDays, restockedDay, haggle, stock }
 *
 * `id` names the merchant in each buyer's stock ledger, so it never changes after it is made. `rev` is the restock
 * counter: raising it puts the whole shelf back without writing to any player. `restockDays` is how many days pass
 * between automatic restocks (0 = by hand) and `restockedDay` the world day (absolute) of the last restock, or null
 * when the clock has not started; `haggle` says whether this merchant lets a buyer bargain (on unless switched off).
 * `stock` is `{ kind, size }` for a merchant the module made: its shelf is rolled by rarity for that settlement size,
 * and rolled again at each restock (town-stock.mjs); null for an NPC the GM stocks by hand.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { STOCK_TYPES } from "../merchant/shop-core.mjs";
import { KINDS, SIZES } from "../merchant/stock-generator.mjs";

export const LANDING_FLAG = "landing";
/** Every tile a page may carry, in the order they show (the editor lists these). Carouse and Rumors make a tavern. */
export const PLACE_IDS = ["quests", "journals", "party", "downtime", "carouse", "rumors"];
/** The tiles a page gets when it has no list yet: the town's four, never the tavern's. */
export const DEFAULT_PLACE_IDS = ["quests", "journals", "party", "downtime"];
/** `games` is an entry too, but a separate switch (the GM turns the table on), so it is not one of the tiles above. */
export const PLACE_LABEL_KEYS = { quests: "SDE.town.place.quests", journals: "SDE.town.place.journals", party: "SDE.town.place.party", downtime: "SDE.town.place.downtime", carouse: "SDE.town.place.carouse", rumors: "SDE.town.place.rumors", games: "SDE.town.place.games" };
export const LIMITS = { buyMultiplier: [10, 500], sellRatio: [0, 100], maxBet: [1, 1000], edge: [0, 50], restockDays: [0, 365] };
export const DEFAULTS = { open: true, rev: 0, buyMultiplier: 100, sellRatio: 50, restockDays: 0, restockedDay: null, haggle: true };
export const GAME_DEFAULTS = { on: false, maxBet: 10, edge: 5 };

const text = (value, max) => String(value ?? "").trim().slice(0, max);
const whole = (value, [lo, hi], fallback) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : fallback;
};
/** An id becomes a flag key in every buyer's ledger, and a dot or a space would split or break the path. */
export const idOk = (id) => typeof id === "string" && id !== "" && !/[.\s]/.test(id);
const on = (value) => value === true || value === "on" || value === "true";
/** A rolled merchant's kind and settlement size, or null when either is not one this module knows. */
const stockOf = (raw) => (KINDS.some((k) => k.id === raw?.kind) && SIZES.some((z) => z.id === raw?.size) ? { kind: raw.kind, size: raw.size } : null);

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
    restockDays: whole(raw.restockDays, LIMITS.restockDays, DEFAULTS.restockDays),
    restockedDay: raw.restockedDay === null || raw.restockedDay === undefined || raw.restockedDay === "" || !Number.isFinite(Number(raw.restockedDay)) ? null : Math.floor(Number(raw.restockedDay)),
    haggle: raw.haggle === undefined ? DEFAULTS.haggle : on(raw.haggle),
    stock: stockOf(raw.stock),
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
/**
 * Put one merchant's whole shelf back (its revision goes up). Given the world's current `day`, the restock clock is
 * stamped with it, so an automatic restock counts its days from this one.
 */
export const restockMerchant = (landing, id, day) => change(landing, id, (m) => restocked(m, day));
export const restockAll = (landing, day) => normalizeLanding({ ...landing, merchants: normalizeLanding(landing).merchants.map((m) => restocked(m, day)) });
const restocked = (m, day) => ({ ...m, rev: m.rev + 1, restockedDay: Number.isFinite(day) ? day : m.restockedDay });

/**
 * The automatic restock, for the world's current `day`: `{ landing, changed }`. A merchant that restocks every N days
 * starts its clock the first time it is seen (no restock then); once N days have passed since `restockedDay` its
 * revision goes up exactly once, however many days were skipped; a clock set back to before the last restock is
 * restamped. A merchant at 0 days is never touched.
 */
export function autoRestock(landing, day) {
  const page = normalizeLanding(landing);
  let changed = false;
  const merchants = page.merchants.map((m) => {
    if (!m.restockDays) return m;
    if (m.restockedDay === null || day < m.restockedDay) { changed = true; return { ...m, restockedDay: day }; }
    if (day - m.restockedDay >= m.restockDays) { changed = true; return { ...m, rev: m.rev + 1, restockedDay: day }; }
    return m;
  });
  return { landing: changed ? { ...page, merchants } : page, changed };
}

/**
 * Fold the editor's form into a landing page. `fields` is the whole form as a flat object: `title`, `tagline`,
 * `blurb`, a `place.<id>` checkbox per tile, `games.on` / `games.maxBet` / `games.edge` for the games table (`on` is a
 * checkbox, so absent means off), and `m.<merchantId>.<field>` for each merchant (`open` and `haggle` are checkboxes too). A
 * merchant, or the games table, that the form does not mention is left as it was.
 */
export function applyForm(landing, fields) {
  const page = normalizeLanding(landing);
  const merchants = page.merchants.map((m) => {
    if (!Object.keys(fields).some((k) => k.startsWith(`m.${m.id}.`))) return m;
    const f = (name) => fields[`m.${m.id}.${name}`];
    return { ...m, role: f("role") ?? m.role, pitch: f("pitch") ?? m.pitch, open: on(f("open")), buyMultiplier: f("buyMultiplier") ?? m.buyMultiplier, sellRatio: f("sellRatio") ?? m.sellRatio, restockDays: f("restockDays") ?? m.restockDays, haggle: on(f("haggle")) };
  });
  const games = Object.keys(fields).some((k) => k.startsWith("games."))
    ? { on: on(fields["games.on"]), maxBet: fields["games.maxBet"] ?? page.games.maxBet, edge: fields["games.edge"] ?? page.games.edge }
    : page.games;
  return normalizeLanding({
    title: fields.title ?? page.title, tagline: fields.tagline ?? page.tagline, blurb: fields.blurb ?? page.blurb,
    places: PLACE_IDS.filter((p) => on(fields[`place.${p}`])), merchants, games, shown: page.shown,
  });
}

/**
 * What Save writes: the editor's `draft` laid over the page as it is live right now, so a restock (or the table's
 * switch) that landed while the window was open is not undone. `opened` is the page the editor started from; `day` is
 * the world's current day. Per merchant the draft's revision INCREASE (a Restock pressed in the editor) is added to
 * the live revision. The restock clock is the live one unless the draft itself restocked, and it starts at `day` when
 * the interval is newly turned on (from 0) or the clock was never started, so the first automatic restock is
 * `restockDays` days from the save. `shown` is always the live switch.
 */
export function mergeSave(live, draft, opened, day) {
  const now = new Map(normalizeLanding(live).merchants.map((m) => [m.id, m]));
  const was = new Map(normalizeLanding(opened).merchants.map((m) => [m.id, m]));
  const page = normalizeLanding(draft);
  const merchants = page.merchants.map((m) => {
    const cur = now.get(m.id), before = was.get(m.id);
    const raised = Math.max(0, m.rev - (before?.rev ?? m.rev));
    const out = cur ? { ...m, rev: cur.rev + raised, restockedDay: raised ? m.restockedDay : cur.restockedDay } : m;
    if (out.restockDays > 0 && Number.isFinite(day) && (out.restockedDay === null || !before?.restockDays)) out.restockedDay = day;
    return out;
  });
  return normalizeLanding({ ...page, merchants, shown: live ? normalizeLanding(live).shown : page.shown });
}
