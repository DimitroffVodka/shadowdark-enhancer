/**
 * Shadowdark Enhancer — Recruit a warband, the pure rules (#205, PGWR p.249).
 *
 * A downtime activity that isn't a slot of a book: the character picks a
 * warband of their level or lower, rolls CHA against 10 + its level, and on a
 * success it is created under their command. What a settlement can supply
 * (village 2, town 4, city 6, city-state 10) is the rules data's recruiting
 * table (rules-data-core.mjs); nothing here ships a number from the book.
 *
 * Pure: no Foundry globals except the i18n lookup the other downtime cores use.
 */

import { hexNum } from "../importer/hex/hex-dataset.mjs";
import { SETTLEMENT_KINDS } from "../rules-data/rules-data-core.mjs";
import { L } from "../shared/i18n.mjs";


/**
 * A pick, roll and result name their activity by `slotKey`. Recruiting's is
 * `recruit:<id of the warband to copy>`: an actor id, from the world or the
 * actors pack, so it holds no dot and reaches no flag key.
 */
const RECRUIT_KEY = /^recruit:([A-Za-z0-9]{16})$/;

/** The slot key for recruiting the warband with this id. */
export const recruitKey = (id) => `recruit:${id}`;

/** The warband id a slot key names, or null when the key isn't a recruiting one. */
export const recruitIdOf = (slotKey) => (typeof slotKey === "string" ? RECRUIT_KEY.exec(slotKey)?.[1] ?? null : null);

/** The activity as the downtime checks read one: a CHA check. Its name is a string of the language file. */
export const recruitActivity = () => ({
  key: "recruitWarband", name: L("SDE.downtime.recruit.name"), check: { kind: "ability", abilities: ["cha"] },
});

/** The check's DC: 10 plus the warband's level (PGWR p.249). */
export const recruitDC = (level) => 10 + (Number(level) || 0);

/** The slot a pick on this warband stands for: the fields the downtime flow reads off any slot. */
export const recruitSlot = ({ id, name, level }) => ({
  key: recruitKey(id), label: L("SDE.downtime.recruit.slotLabel", { name }), dc: recruitDC(level), paid: false,
});

/**
 * The settlement the party is in: the GM's choice when there is one, else the
 * party's hex. "none" is the GM saying they are in no settlement. Same rule
 * as carousing in Shadowdark Extras.
 * @param {string} override  the setting: "" (from the map), a settlement kind or "none"
 * @param {{kind:string, name:string}|null} fromMap
 * @returns {{kind:string, name:string, chosen:boolean}}
 */
export function settlementNow(override, fromMap) {
  const chosen = SETTLEMENT_KINDS.includes(override) || override === "none";
  if (chosen) return { kind: override, name: "", chosen: true };
  return { kind: fromMap?.kind ?? "none", name: fromMap?.name ?? "", chosen: false };
}

/**
 * The settlement in a hex, from the crawl entries' keyed rows (the book's
 * settlement digit, hex-summary.mjs): first row for this number that is one.
 * @param {Array<{flags?:object}>} entries  crawl entries, or their index rows with the hex flag
 * @param {number|string} num  the published hex number
 * @param {string} moduleId
 * @returns {{kind:string, name:string}|null}
 */
export function settlementKindAt(entries, num, moduleId = "shadowdark-enhancer") {
  const want = hexNum(num);
  if (want === null) return null;
  for (const entry of entries ?? []) {
    for (const row of entry?.flags?.[moduleId]?.hex?.keyed ?? []) {
      if (hexNum(row?.num) === want && SETTLEMENT_KINDS.includes(row.feature)) return { kind: row.feature, name: String(row.name ?? "") };
    }
  }
  return null;
}

/**
 * The most a settlement can supply: its recruiting limit, or no limit outside
 * a settlement and while the table isn't filled in (a limit of `null`).
 * @param {string} kind  a settlement kind or "none"
 * @param {(kind:string) => number|null} limitOf  rules.recruitingLimit
 * @returns {number}  Infinity for no limit
 */
export function settlementLimit(kind, limitOf) {
  if (!SETTLEMENT_KINDS.includes(kind)) return Infinity;
  const limit = limitOf(kind);
  return typeof limit === "number" && limit >= 0 ? limit : Infinity;
}

/**
 * What the character may try: warbands of their level or lower, and no higher
 * than the settlement supplies; lowest first, then by name.
 * @param {Array<{id:string, name:string, level:number}>} warbands
 * @param {{level:number, limit:number}} who  the character's level, the settlement's limit
 */
export function recruitOffers(warbands, { level, limit }) {
  const cap = Math.min(Number(level) || 0, limit);
  return (warbands ?? [])
    .filter((w) => Number.isFinite(w.level) && w.level <= cap)
    .sort((a, b) => a.level - b.level || String(a.name).localeCompare(String(b.name)))
    .map((w) => ({ ...w, dc: recruitDC(w.level) }));
}

/**
 * Why a warband isn't on offer, in words for the player: too high a level for
 * the character, too high for the settlement, or not a warband to recruit.
 * Null when it is.
 * @returns {string|null}
 */
export function recruitRefusal(warband, { level, limit, settlementLabel }) {
  if (!warband) return L("SDE.downtime.recruit.gone");
  if (warband.level > (Number(level) || 0)) return L("SDE.downtime.recruit.aboveYou", { name: warband.name, level });
  if (warband.level > limit) return L("SDE.downtime.recruit.aboveSettlement", { name: warband.name, place: settlementLabel, limit });
  return null;
}
