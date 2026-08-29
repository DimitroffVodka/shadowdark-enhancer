/**
 * Shadowdark Enhancer — reading a Shadowdark attack card
 *
 * Two features now react to attacks — the Duelist's Parry (a hit on you) and
 * Taunt (a miss on you) — and both need the same four answers: was it an attack
 * at all, did it land, who was it aimed at, who swung. Those live here rather
 * than in either feature, because the last time two copies of "who was this
 * aimed at" disagreed, a parry spent its once-a-day use and silently gave back
 * nothing (see the resolver note in parry.mjs).
 *
 * What makes any of this possible: with the system's targeting setting on,
 * `setRollTarget` (dice.mjs) stamps `targetUuid` onto the roll config and feeds
 * the target's AC in as the roll's DC — so `RollSD.success` IS "did it hit
 * them", already computed and stored on the message.
 *
 * `rollHit` is pure and node-testable; the two resolvers need Foundry.
 */

/**
 * Did this attack roll land?
 *
 * `RollSD.success` is `total >= options.dc` and returns null when there is no
 * DC at all — an untargeted swing, which has no defender to hit or miss. Crits
 * settle it either way regardless of AC.
 *
 * @param {{success: ?boolean, criticalSuccess: ?boolean, criticalFailure: ?boolean}} roll
 * @returns {boolean}
 */
export function rollHit({ success = null, criticalSuccess = false, criticalFailure = false } = {}) {
  if (criticalFailure) return false;
  if (criticalSuccess) return true;
  return success === true;
}

/** The card's main roll, however the system labelled it. */
export function mainRollOf(message) {
  return message?.getRoll?.("main") ?? message?.rolls?.[0] ?? null;
}

/**
 * Is this card a weapon attack at all?
 *
 * MUST be asked before `cardHit`, and it is the reason this file exists rather
 * than two copies of the same reading. `setRollTarget` stamps `targetUuid` onto
 * ANY roll made with a token targeted — a spell cast goes through it too
 * (PlayerSD.castSpell, NpcSD.castNPCSpell). But a spell's `success` is the
 * CASTING CHECK against the spell's own DC: `_generateSpellConfig` assigns
 * `mainRoll.dc = spell.system.dc` outright, overwriting the target AC that
 * `setRollTarget` left there. Read as an attack, a fumbled Magic Missile is a
 * miss that arms Taunt and a successful one is a hit that offers Parry.
 *
 * The system labels the roll for us — `config.type` is set by the config
 * generators and is one of "attack", "spell", "check" or "ability" (PlayerSD
 * 408/431, NpcSD 214/249) — so this is a lookup, not a guess.
 */
export function isAttackCard(message) {
  return message?.flags?.shadowdark?.rollConfig?.type === "attack";
}

/** Did the card's attack land? False for a card with no roll at all. */
export function cardHit(message) {
  const roll = mainRollOf(message);
  if (!roll) return false;
  return rollHit({
    success: roll.success ?? null,
    criticalSuccess: !!roll.criticalSuccess,
    criticalFailure: !!roll.criticalFailure,
  });
}

/**
 * The actor a uuid points at, whether it names a Token or an Actor.
 *
 * `setRollTarget` stores `target.document.uuid` — a TokenDocument — so `.actor`
 * is the usual path. It is NOT the only one, and an Actor uuid resolves to a
 * document whose `.actor` is undefined. Reaching straight for `.actor` there
 * yields null and the caller quietly does nothing.
 */
export async function actorFromUuid(uuid) {
  if (!uuid) return null;
  const doc = await fromUuid(uuid).catch(() => null);
  return _asActor(doc);
}

/** Synchronous twin, for the pre-roll hooks that cannot await. */
export function actorFromUuidSync(uuid) {
  if (!uuid) return null;
  let doc = null;
  try { doc = fromUuidSync(uuid); } catch { return null; }
  return _asActor(doc);
}

function _asActor(doc) {
  if (!doc) return null;
  if (doc.documentName === "Actor") return doc;
  return doc.actor ?? null;
}

/** Who this attack was aimed at. */
export function targetActorOf(message) {
  return actorFromUuid(message?.flags?.shadowdark?.rollConfig?.targetUuid);
}

/** Who swung. */
export function attackerActorOf(message) {
  return actorFromUuid(message?.flags?.shadowdark?.rollConfig?.actorUuid);
}
