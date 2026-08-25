/**
 * Shadowdark Enhancer — Taunt (Foundry-bound)
 *
 * "When an enemy misses you with an attack, you have advantage on attacks
 * against that enemy next round."
 *
 * Three moving parts, each on a seam the system already provides:
 *
 *   ARM    `createChatMessage` — an attack card whose target is a Taunt holder
 *          and whose roll MISSED. Same card data Parry reads, opposite outcome.
 *   APPLY  `SD-Player-Attack` — fires with the mutable roll config just before
 *          the dice go, so the advantage is set on `mainRoll.advantage` and the
 *          reason is pushed into `config.messages` where the roll card prints it.
 *   EXPIRE `updateCombat` — `Combat#previous` names the turn that just ended
 *          (core's own way of asking; foundry.mjs:50639). When that turn belongs
 *          to the holder and started after the taunt was armed, it is over.
 *
 * The taunt lives as a flag on the holder's actor, so it survives a reload and
 * every client can read it. Only the active GM writes it — arming happens from a
 * hook that fires on EVERY client, and without that gate each of them would race
 * to write the same flag.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { isActiveGM } from "../shared/gm-relay.mjs";
import { esc } from "../shared/esc.mjs";
import { cardHit, targetActorOf, attackerActorOf, actorFromUuidSync } from "../shared/attack-card.mjs";
import { turnSeq, shouldExpire, mergeAdvantage, armsTaunt, tauntApplies } from "./taunt-core.mjs";

/** Talent name to fall back on when nothing carries the flag (pre-flag worlds). */
const TAUNT_NAME = "taunt";

let _installed = false;

function _enabled() {
  try { return game.settings.get(MODULE_ID, "tauntAutomate") !== false; } catch { return true; }
}

/**
 * The Taunt talent on an actor — by module flag first, by name second, exactly
 * as the Delver's Scavenger and the Duelist's Parry are found.
 */
export function findTauntTalent(actor) {
  const items = actor?.items ?? [];
  return items.find((i) => i.type === "Talent" && i.flags?.[MODULE_ID]?.taunt)
    ?? items.find((i) => i.type === "Talent" && i.name?.toLowerCase() === TAUNT_NAME)
    ?? null;
}

/** The stored taunt on an actor, if any. */
export function tauntOn(actor) {
  return actor?.flags?.[MODULE_ID]?.taunt ?? null;
}

/** Where the given actor's combat currently stands, or null outside combat. */
function _combatPosition(actor) {
  for (const combat of game.combats ?? []) {
    if (!combat.started) continue;
    const inIt = combat.combatants.some((c) => (actor.isToken
      ? c.tokenId === actor.token?.id : c.actorId === actor.id));
    if (inIt) return { combatId: combat.id, seq: turnSeq({ round: combat.round, turn: combat.turn }) };
  }
  return null;
}

export const Taunt = {

  init() {
    if (_installed) return;
    Hooks.on("createChatMessage", (message) => Taunt._onAttackCard(message));
    // Parry turns a hit into a miss, and a miss is what Taunt keys on — so a
    // parried blow arms it too. Parry announces itself rather than reaching in
    // here, which keeps the two features independent.
    Hooks.on(`${MODULE_ID}.parried`, (info) => Taunt._onParried(info));
    Hooks.on("SD-Player-Attack", (config) => { Taunt.applyToRoll(config); return true; });
    Hooks.on("updateCombat", (combat, changed) => Taunt._onTurnChange(combat, changed));
    Hooks.on("deleteCombat", (combat) => Taunt._onCombatEnd(combat));
    _installed = true;
  },

  // ── Arm ───────────────────────────────────────────────────────────────────

  /** An attack card landed in chat: did it miss someone who taunts? */
  async _onAttackCard(message) {
    if (!_enabled() || !isActiveGM()) return;
    try {
      const config = message?.flags?.shadowdark?.rollConfig;
      if (!config?.targetUuid || !config?.actorUuid) return;
      const defender = await targetActorOf(message);
      const attacker = await attackerActorOf(message);
      if (!defender || !attacker) return;
      const verdict = armsTaunt({
        isHit: cardHit(message),
        parried: false,
        defenderHasTaunt: !!findTauntTalent(defender),
        attackerId: attacker.id,
        defenderId: defender.id,
      });
      if (!verdict.ok) return;
      await this.arm(defender, attacker);
    } catch (err) {
      console.warn(`${MODULE_ID} | taunt: could not read that attack card`, err);
    }
  },

  /** A Parry turned a hit into a miss — the rules text says that IS a miss. */
  async _onParried({ actorId, attackerId } = {}) {
    if (!_enabled() || !isActiveGM()) return;
    const defender = game.actors.get(actorId);
    const attacker = attackerId ? game.actors.get(attackerId) : null;
    if (!defender || !attacker) return;
    const verdict = armsTaunt({
      isHit: true, parried: true,
      defenderHasTaunt: !!findTauntTalent(defender),
      attackerId: attacker.id, defenderId: defender.id,
    });
    if (!verdict.ok) return;
    await this.arm(defender, attacker);
  },

  /**
   * Record the advantage and say so in chat.
   *
   * A second miss from the SAME enemy just refreshes the clock. A miss from a
   * different one replaces it: the talent grants advantage against "that
   * enemy", singular.
   */
  async arm(defender, attacker) {
    const pos = _combatPosition(defender);
    await defender.setFlag(MODULE_ID, "taunt", {
      enemyId: attacker.id,
      enemyName: attacker.name,
      combatId: pos?.combatId ?? null,
      armedAt: pos?.seq ?? null,
    });
    await ChatMessage.create({
      speaker: { alias: defender.name },
      content: `<div class="sde-taunt-card"><i class="fa-solid fa-hand-fist"></i> `
        + `${esc(game.i18n.format("SDE.taunt.armed", { name: defender.name, enemy: attacker.name }))}</div>`,
    });
  },

  // ── Apply ─────────────────────────────────────────────────────────────────

  /**
   * Set advantage on an attack against the taunted enemy.
   *
   * MUST be synchronous: `SD-Player-Attack` is a plain `Hooks.call`, so the
   * system does not await handlers — an async one would return long after the
   * dice had gone. Hence `actorFromUuidSync` rather than the awaited resolver.
   *
   * Fires after the roll dialog, so the player does not see it pre-ticked; the
   * line pushed into `config.messages.any` prints on the roll card instead, which
   * says WHY the advantage was there rather than leaving it to be argued about.
   */
  applyToRoll(config) {
    try {
      if (!_enabled()) return;
      if (!config?.mainRoll) return;
      const attacker = actorFromUuidSync(config.actorUuid);
      const taunt = tauntOn(attacker);
      if (!taunt) return;
      const target = actorFromUuidSync(config.targetUuid);
      if (!tauntApplies(taunt, target?.id)) return;

      const before = Number(config.mainRoll.advantage) || 0;
      const next = mergeAdvantage(before);
      config.mainRoll.advantage = next;

      config.messages ??= { any: [], success: [], failure: [], criticalSuccess: [], criticalFailure: [] };
      config.messages.any ??= [];
      // The roll card prints these with a triple-stash, so anything from a
      // document name is escaped before it goes in.
      config.messages.any.push(
        `<em>${esc(game.i18n.format(
          next === 0 ? "SDE.taunt.cancelled" : "SDE.taunt.applied",
          { enemy: taunt.enemyName ?? "" }))}</em>`);
    } catch (err) {
      console.warn(`${MODULE_ID} | taunt: could not apply advantage`, err);
    }
  },

  // ── Expire ────────────────────────────────────────────────────────────────

  /** A turn ended: if it was the holder's, and it started after arming, done. */
  async _onTurnChange(combat, changed) {
    if (!_enabled() || !isActiveGM()) return;
    if (!("turn" in (changed ?? {})) && !("round" in (changed ?? {}))) return;
    try {
      const prev = combat?.previous;
      if (!prev?.combatantId) return;
      const actor = combat.combatants.get(prev.combatantId)?.actor;
      const taunt = tauntOn(actor);
      if (!taunt) return;
      if (!shouldExpire({ armedAt: taunt.armedAt, endedSeq: turnSeq(prev) })) return;
      await this.clear(actor);
    } catch (err) {
      console.warn(`${MODULE_ID} | taunt: could not expire on turn change`, err);
    }
  },

  /** Combat over — nothing left for "your next turn" to mean. */
  async _onCombatEnd(combat) {
    if (!_enabled() || !isActiveGM()) return;
    for (const c of combat?.combatants ?? []) {
      const actor = c.actor;
      if (tauntOn(actor)) await this.clear(actor).catch(() => {});
    }
  },

  async clear(actor) {
    if (!actor || !tauntOn(actor)) return;
    await actor.unsetFlag(MODULE_ID, "taunt");
  },
};
