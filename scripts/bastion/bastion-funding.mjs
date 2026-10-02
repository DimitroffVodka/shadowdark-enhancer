/**
 * Shadowdark Enhancer — Bastions: the party link and paying into the treasury (pure).
 *
 * A bastion can name the party that owns it (`system.party`, an actor UUID). The
 * party is only a way to find the people who pay: gold moves between a
 * character's purse (`system.coins`) and the bastion's treasury.
 *
 * Extras keeps a party's own coins as flags in ITS namespace (flags.shadowdark-extras.coins)
 * and offers no way to write them, so nothing here touches them: a member pays from their
 * own purse. Reads of Extras' flags go straight to `actor.flags`, because
 * `Document#getFlag` throws for the scope of a module that isn't active.
 */

import { canAfford, spendFromPurse, addToPurse, toCopper } from "../shared/coins.mjs";
import { MODULE_ID } from "../shared/module-id.mjs";

const EXTRAS_ID = "shadowdark-extras";

/** Is this actor a party: Extras' (`isParty`) or the Enhancer's own? */
export function isPartyActor(actor) {
  return actor?.flags?.[EXTRAS_ID]?.isParty === true || !!actor?.flags?.[MODULE_ID]?.party;
}

/**
 * The people who can pay for a bastion: the linked party's members when Extras lists any,
 * otherwise every player character. `resolve(id)` turns a member id or UUID into an actor, or null.
 * Only an actor with a purse can pay.
 */
export function fundingActors({ party, resolve, players }) {
  const ids = party?.flags?.[EXTRAS_ID]?.members;
  const members = Array.isArray(ids) ? ids.map((id) => resolve(id)).filter((a) => a?.system?.coins) : [];
  return members.length ? members : players.filter((a) => a?.system?.coins);
}

const wholeGp = (gp) => (Number.isInteger(gp) && gp > 0 ? gp : null);

/** A character pays `gp` into the treasury: their purse after, or `error` ("amount" | "broke"). */
export function planDeposit(coins, gp) {
  if (!wholeGp(gp)) return { ok: false, error: "amount" };
  if (!canAfford(coins, { gp })) return { ok: false, error: "broke" };
  const spent = spendFromPurse(coins, toCopper({ gp }));
  return { ok: true, coins: spent, error: null };
}

/** The treasury pays `gp` out to a character: their purse after, or `error` ("amount"). */
export function planWithdraw(coins, gp) {
  if (!wholeGp(gp)) return { ok: false, error: "amount" };
  return { ok: true, coins: addToPurse(coins, { gp }), error: null };
}

/** A purse as the three fields an update writes. */
export const purseUpdate = (coins) => ({ "system.coins.gp": coins.gp, "system.coins.sp": coins.sp, "system.coins.cp": coins.cp });

/** The same purse, read back from an actor, for comparing with what was meant to be written. */
export const purseOf = (actor) => ({ gp: actor?.system?.coins?.gp ?? 0, sp: actor?.system?.coins?.sp ?? 0, cp: actor?.system?.coins?.cp ?? 0 });
