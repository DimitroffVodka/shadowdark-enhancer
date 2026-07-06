import { MODULE_ID } from "../module-id.mjs";

/**
 * Pure recompute of a Class Ability's use pool from its rule. Returns the new
 * `{ max, available }`, or `null` when the max is unchanged (nothing to write).
 * Kept side-effect-free so it's unit-testable under Node without a Foundry client.
 *
 * @param {{type: string, base?: number}} rule  the ability's usesRule flag
 * @param {object} ctx  { level, boostCount, oldMax, oldAvail }
 */
export function computeAbilityUses(rule, { level = 1, boostCount = 0, oldMax = 0, oldAvail = 0 } = {}) {
  let newMax;
  if (rule?.type === "level") {
    newMax = Math.max(1, Number(level) || 1);
  } else if (rule?.type === "base") {
    newMax = Math.max(0, (Number(rule.base) || 0) + (Number(boostCount) || 0));
  } else {
    return null;
  }
  const prevMax = Number(oldMax) || 0;
  if (newMax === prevMax) return null;
  // Growing the pool grants the new use(s); shrinking clamps what's left.
  const available = Math.min(newMax, Math.max(0, (Number(oldAvail) || 0) + (newMax - prevMax)));
  return { max: newMax, available };
}

/**
 * Dynamic `uses.max` for Class Ability items.
 *
 * The Shadowdark `Class Ability` schema stores `uses.max` as a plain number and
 * the system exposes NO effect key for it (its bonus switch covers attack/damage/
 * AC/abilities/gear-slots… but nothing for ability uses). A few Western Reaches
 * abilities need a max that isn't a fixed constant:
 *   • level-scaled   — Still the Heart (rounds/day equal to character level)
 *   • talent-boosted — Hawk Eye / Parry / Sun on the Water gain +1 use for each
 *                      matching "additional use" talent the character has taken.
 *
 * So we recompute `uses.max` idempotently from a flag on the ability whenever the
 * actor's items or level change. Recomputing from source (not incrementing) keeps
 * it correct across add/remove/level-up with no drift.
 *
 * The recompute writes embedded items, so it must NOT run synchronously inside a
 * create/delete hook — doing so re-enters the in-flight CRUD workflow and throws
 * "Cannot read properties of undefined (reading '_id')". Every trigger therefore
 * routes through `_defer`, which coalesces bursts and runs once the operation has
 * settled (and re-fetches the live actor, so a doc deleted in the meantime is a
 * no-op rather than an error).
 *
 * Flags:
 *   Class Ability:  flags[MODULE_ID].usesRule = { type: "level" }
 *                   flags[MODULE_ID].usesRule = { type: "base", base: <n> }
 *   Boost Talent:   flags[MODULE_ID].grantsExtraUse = "<Class Ability name>"
 */
export const ClassAbilityUses = {
  _timers: new Map(),

  init() {
    Hooks.on("createItem", (item) => this._onItem(item));
    Hooks.on("deleteItem", (item) => this._onItem(item));
    Hooks.on("createActor", (actor) => this._defer(actor));
    Hooks.on("updateActor", (actor, changes) => {
      if (foundry.utils.hasProperty(changes, "system.level.value")) this._defer(actor);
    });
  },

  /** Only the active GM writes the embedded updates, so N clients don't race. */
  _isWriter() {
    return game.users?.activeGM === game.user;
  },

  _onItem(item) {
    if (item.parent?.documentName === "Actor") this._defer(item.parent);
  },

  /**
   * Schedule a recompute for `actor` after the current CRUD operation settles.
   * Coalesces a burst of item changes into a single write and never mutates
   * embedded docs from inside the triggering create/delete hook.
   */
  _defer(actor) {
    if (!this._isWriter() || !actor?.id) return;
    const id = actor.id;
    clearTimeout(this._timers.get(id));
    this._timers.set(id, setTimeout(() => {
      this._timers.delete(id);
      const live = game.actors.get(id);
      if (live) this.recompute(live).catch((e) => console.error(`${MODULE_ID} | class-ability uses recompute failed:`, e));
    }, 50));
  },

  async recompute(actor) {
    if (actor?.type !== "Player" || !actor.items) return;
    const updates = [];
    for (const item of actor.items) {
      if (item.type !== "Class Ability") continue;
      const rule = item.getFlag(MODULE_ID, "usesRule");
      if (!rule) continue;

      const boostCount = rule.type === "base"
        ? actor.items.filter((i) => i.getFlag(MODULE_ID, "grantsExtraUse") === item.name).length
        : 0;
      const next = computeAbilityUses(rule, {
        level: actor.system?.level?.value,
        boostCount,
        oldMax: item.system.uses?.max,
        oldAvail: item.system.uses?.available,
      });
      if (next) updates.push({ _id: item.id, "system.uses.max": next.max, "system.uses.available": next.available });
    }
    if (updates.length) await actor.updateEmbeddedDocuments("Item", updates);
  },
};
