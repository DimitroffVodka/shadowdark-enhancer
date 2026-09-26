/**
 * Shadowdark Enhancer — stat damage (Foundry-bound, #182)
 *
 * Invisible until it happens: no setting, no control, nothing on the sheet or
 * the crawl strip. A character who has never been damaged carries nothing.
 * Damage is Active Effects in the shape stat-damage-core.mjs describes, so it
 * shows as one line per ability in the sheet's existing Effects tab and is
 * gone when healed.
 *
 * Other modules drive it through `game.shadowdarkEnhancer.statDamage`:
 * monster hits (#183), missed rations and rests in Shadowdark Extras.
 *
 * WRITES REPLACE. Changing an ability's damage deletes that ability's
 * stat-damage effects and creates one with the new total. An in-place update
 * would have to write `changes` on v13 and `system.changes` on v14 (update
 * data is not migrated); a create is migrated on both. It also folds several
 * Effects-library drops into one line the next time that ability changes.
 */

import { isActiveGM } from "../shared/gm-relay.mjs";
import {
  ABILITIES, abilityKey, afterHeal, damageOf, damagedAbility, diesAtZeroCon, statDamageEffect,
} from "./stat-damage-core.mjs";

/** Only characters have scores; an NPC's abilities are bare modifiers (NpcSD). */
const canTake = (actor) => actor?.type === "Player";

// ponytail: one queue for every stat-damage write on this client, so two hits
// landing together cannot both delete the same effect. Per-actor queues if a
// table ever notices the wait.
let _queue = Promise.resolve();
const serial = (fn) => (_queue = _queue.then(fn, fn));

/** Actors this client is marking dead right now. */
const _dying = new Set();

function effectName(ability, amount) {
  const label = game.i18n.localize(`SHADOWDARK.ability_${ability}`).toUpperCase();
  return game.i18n.format("SDE.statDamage.effect", { amount, ability: label });
}

/** Set one ability's damage to `total`: delete its effects, create one if any is left. */
async function setDamage(actor, ability, total) {
  const ids = actor.effects.filter((e) => damagedAbility(e) === ability).map((e) => e.id);
  if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  if (total > 0) {
    await actor.createEmbeddedDocuments("ActiveEffect",
      [statDamageEffect(ability, total, effectName(ability, total))]);
  }
}

/**
 * The dead status and a defeated combatant: what #181 calls dead. The dying
 * rules themselves (timers, stabilizing) are #181's.
 */
async function die(actor) {
  await actor.toggleStatusEffect("dead", { active: true, overlay: true });
  for (const combat of game.combats ?? []) {
    for (const c of combat.combatants) {
      const isThem = actor.isToken ? c.tokenId === actor.token?.id : c.actorId === actor.id;
      if (isThem && !c.defeated) await c.update({ defeated: true });
    }
  }
}

export const StatDamage = {

  /**
   * Death at CON 0, from any stat-damage effect however it arrived: this
   * module's `apply`, or an Effects-library drop that never passed through it.
   * The core backend re-prepares the actor before `createActiveEffect` fires,
   * so the score read here already includes the new effect.
   */
  init() {
    Hooks.on("createActiveEffect", (effect) => {
      StatDamage._checkCon(effect).catch((err) =>
        console.warn("shadowdark-enhancer | stat damage: could not check CON", err));
    });
  },

  async _checkCon(effect) {
    if (!isActiveGM() || damagedAbility(effect) !== "con") return;
    const actor = effect.parent;
    if (actor?.documentName !== "Actor" || !canTake(actor)) return;
    if ((actor.system?.abilities?.con?.value ?? 1) > 0) return;
    // A batched create fires this once per effect, before the first death
    // has set the status: the in-flight set stops the second toggle.
    if (actor.statuses?.has("dead") || _dying.has(actor.uuid) || !diesAtZeroCon(actor)) return;
    _dying.add(actor.uuid);
    try {
      await die(actor);
    } finally {
      _dying.delete(actor.uuid);
    }
  },

  /** Damage per ability: `{ str, dex, con, int, wis, cha }`, zero when clean. */
  of(actor) {
    return damageOf(actor?.effects ?? []);
  },

  /**
   * Add `amount` points of damage to one ability. Characters only.
   * @returns {Promise<?number>} that ability's new total, or null when
   *   nothing was applied (not a character, unknown ability, amount below 1).
   */
  async apply(actor, ability, amount) {
    const key = abilityKey(ability);
    const points = Math.floor(Number(amount));
    if (!canTake(actor) || !key || !(points > 0)) return null;
    return serial(async () => {
      const total = StatDamage.of(actor)[key] + points;
      await setDamage(actor, key, total);
      return total;
    });
  },

  /**
   * Heal stat damage. `heal(actor)` or `heal(actor, { all: true })` clears it
   * (a normal rest); `heal(actor, { perAbility: 1 })` takes 1 off each damaged
   * ability (Grinder Mode). Abilities with nothing to heal are not touched.
   * @returns {Promise<object>} the damage left, as `of` reads it.
   */
  async heal(actor, options = {}) {
    if (!actor) return null;
    return serial(async () => {
      const before = StatDamage.of(actor);
      const after = afterHeal(before, options);
      for (const a of ABILITIES) {
        if (after[a] !== before[a]) await setDamage(actor, a, after[a]);
      }
      return after;
    });
  },
};
