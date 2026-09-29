/**
 * Shadowdark Enhancer — Recruit a warband, in the world (#205, PGWR p.249).
 *
 * The rules are downtime-recruit-core.mjs. This is what reads the world for
 * them and writes the result:
 *   - the settlement the party is in: the GM's choice (a setting), else the
 *     keyed hex the party stands in, as Shadowdark Extras' carousing does;
 *   - the warbands on offer: the stock ones in the actors pack and any
 *     uncommanded warband the GM made in the world;
 *   - the commander's allowance, through the checks the warband unit has;
 *   - the recruiting itself: a copy of the warband, under the character's
 *     command, made on the one warband queue.
 *
 * GM-side: the downtime session calls checkRecruit and recruitWarband, and
 * answers a player's window with recruitView. Retraining is the warband
 * sheet's (a week after its upgrades change); commandedWarbands only points
 * at it.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { findSuitePack } from "../shared/compendium-suite.mjs";
import { rulesApi, SETTLEMENT_KINDS } from "../rules-data/rules-data-core.mjs";
import { format as formatTime } from "../time/time.mjs";
import { allowanceFor, commandRefusal } from "../actors/warband-core.mjs";
import { WARBAND_FLAG, commandedBy, commanderTier, warbandState } from "../actors/warband-npc-sheet.mjs";
import { warbandWrites } from "../actors/warband-upgrades.mjs";
import {
  recruitDC, recruitOffers, recruitRefusal, settlementKindAt, settlementLimit, settlementNow,
} from "./downtime-recruit-core.mjs";

/** The GM's settlement choice: "" (the party's hex), a settlement kind, or "none". */
export const SETTLEMENT_SETTING = "downtimeSettlement";

const WARBAND_TYPE = `${MODULE_ID}.warband`;
const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const levelOf = (actor) => Number(actor?.system?.level?.value ?? 0);
const KIND_KEYS = Object.fromEntries(SETTLEMENT_KINDS.map((k) => [k, `SDE.rulesData.settlement.${k}`]));

/** The settlement of the hex the party stands in, or null (no map, no party token, no settlement keyed there). */
async function settlementFromMap() {
  try {
    const { partyHex } = await import("../encounter/encounter-terrain.mjs");
    const hex = partyHex();
    const pack = hex ? findSuitePack("journal") : null;
    if (!pack) return null;
    // The keyed rows sit in the crawl entries' hex flag: the index carries it, so no entry or page is loaded.
    const index = await pack.getIndex({ fields: [`flags.${MODULE_ID}.hex`] });
    return settlementKindAt([...index], hex.num, MODULE_ID);
  } catch (err) {
    console.warn(`${MODULE_ID} | recruit: the party's settlement`, err);
    return null;
  }
}

/** Where the party is and what it can supply: `{ kind, name, chosen, limit (Infinity: none), place, line }`. */
export async function settlementInfo() {
  const override = game.settings.get(MODULE_ID, SETTLEMENT_SETTING) ?? "";
  const chosen = SETTLEMENT_KINDS.includes(override) || override === "none";
  const here = settlementNow(override, chosen ? null : await settlementFromMap());
  const rules = rulesApi(() => game.settings.get(MODULE_ID, "rulesData"));
  const limit = settlementLimit(here.kind, (k) => rules.recruitingLimit(k));
  const place = here.kind === "none" ? t("SDE.downtime.recruit.noSettlement")
    : [here.name, t(KIND_KEYS[here.kind])].filter(Boolean).join(", ");
  const line = Number.isFinite(limit) ? t("SDE.downtime.recruit.limit", { place, limit }) : t("SDE.downtime.recruit.noLimit", { place });
  return { ...here, limit, place, line };
}

/**
 * The warbands that can be recruited: the stock and imported ones in the actors
 * pack, and a warband in the world that no one commands (a GM-made one; a
 * routed or deserted one isn't on offer).
 * @returns {Promise<Array<{id:string, name:string, level:number, upgrades:number, pack:string|null}>>}
 */
export async function warbandTemplates() {
  const out = [];
  for (const a of game.actors) {
    const state = a.type === WARBAND_TYPE ? warbandState(a) : null;
    if (state && !state.commander && !state.routed && !state.deserted) {
      out.push({ id: a.id, name: a.name, level: levelOf(a), upgrades: state.upgrades.length, pack: null });
    }
  }
  const pack = findSuitePack("actors");
  if (pack) {
    const index = await pack.getIndex({ fields: ["type", "system.level.value"] });
    for (const e of index) {
      if (e.type === WARBAND_TYPE) out.push({ id: e._id, name: e.name, level: Number(e.system?.level?.value ?? 0), upgrades: 0, pack: pack.collection });
    }
  }
  return out;
}

/** Why this character can't take one more warband (with this many upgrades), in words; null when they can. */
async function allowanceRefusal(pc, upgrades) {
  const allowance = allowanceFor(await commanderTier(pc));
  const refusal = commandRefusal(allowance, { ...commandedBy(pc.uuid, { type: WARBAND_TYPE }), upgrades });
  const key = { warbands: "SDE.warband.notify.tooManyWarbands", upgrades: "SDE.warband.notify.tooManyUpgrades" }[refusal];
  return key ? t(key, { name: pc.name, max: allowance[refusal] }) : null;
}

/**
 * What the character's window shows: the settlement, and each warband on offer
 * (their level or lower, and no higher than the settlement supplies) with the
 * reason it can't be taken, if any. Plain data, so it goes over a query.
 * @returns {Promise<{level:number, settlement:{kind:string, name:string, chosen:boolean, line:string},
 *   blocked:string|null, offers:Array<{id:string, name:string, level:number, dc:number, reason:string|null}>}>}
 */
export async function recruitView(pc) {
  const here = await settlementInfo();
  const { limit } = here;
  const level = levelOf(pc);
  // At the allowance already: nothing can be taken, whatever it carries.
  const blocked = await allowanceRefusal(pc, 0);
  const offers = [];
  for (const w of recruitOffers(await warbandTemplates(), { level, limit })) {
    offers.push({ id: w.id, name: w.name, level: w.level, dc: w.dc, reason: blocked ?? await allowanceRefusal(pc, w.upgrades) });
  }
  return { level, settlement: { kind: here.kind, name: here.name, chosen: here.chosen, line: here.line }, blocked, offers };
}

/**
 * The authoritative check, made again when a pick is taken, when a roll is
 * settled and when the warband is made: the warband is one on offer to this
 * character here and now, and they can take it.
 * @param {string} id  the warband's actor id, from a payload: only looked up, never trusted
 * @returns {Promise<{ok:true, offer:{id:string, name:string, level:number, dc:number}, template:object}|{ok:false, error:string}>}
 */
export async function checkRecruit(pc, id) {
  const { limit, place } = await settlementInfo();
  const template = (await warbandTemplates()).find((w) => w.id === id);
  const level = levelOf(pc);
  const refusal = recruitRefusal(template, { level, limit, settlementLabel: place })
    ?? await allowanceRefusal(pc, template?.upgrades ?? 0);
  if (refusal) return { ok: false, error: refusal };
  return { ok: true, offer: { id, name: template.name, level: template.level, dc: recruitDC(template.level) }, template };
}

/**
 * Recruit: check again, then make a copy of the warband under the character's
 * command. The check and the copy are one turn of the warband queue, so two
 * recruits (or a commander change) can't both take the last place. Nothing is
 * made when the check fails; a copy whose commander couldn't be written is
 * deleted again.
 * @returns {Promise<{ok:boolean, summary?:string, error?:string, actor?:Actor}>}
 */
export function recruitWarband(pc, id) {
  return warbandWrites(async () => {
    const check = await checkRecruit(pc, id);
    if (!check.ok) return check;
    const { template } = check;
    const source = template.pack ? await game.packs.get(template.pack)?.getDocument(id) : game.actors.get(id);
    if (!source) return { ok: false, error: t("SDE.downtime.recruit.gone") };
    const data = source.toObject();
    delete data._id;
    data.folder = null;
    // The character's owners own it, so they can open its sheet (and retrain it).
    data.ownership = foundry.utils.deepClone(pc.toObject().ownership ?? {});
    const actor = await Actor.implementation.create(data);
    try {
      await replaceModuleFlag(actor, WARBAND_FLAG, { ...warbandState(actor), commander: pc.uuid });
    } catch (err) {
      await actor.delete().catch(() => {});
      throw err;
    }
    return { ok: true, actor, summary: t("SDE.downtime.recruit.recruited", { warband: actor.name, name: pc.name }) };
  });
}

/**
 * The warbands this character commands, for the window's link to their sheets,
 * where retraining lives. Only those this client can see.
 * @returns {Array<{id:string, name:string, level:number, retraining:string|null}>}
 */
export function commandedWarbands(pc) {
  const now = game.time.worldTime;
  return game.actors.filter((a) => a.type === WARBAND_TYPE && warbandState(a).commander === pc.uuid && !warbandState(a).routed)
    .map((a) => {
      const until = warbandState(a).retrainingUntil;
      return {
        id: a.id, name: a.name, level: levelOf(a),
        retraining: until > now ? t("SDE.downtime.recruit.retrainingUntil", { date: formatTime(until) }) : null,
      };
    });
}
