/**
 * Shadowdark Enhancer — Bastions: what the panel shows (pure).
 *
 * The panel lists the bastions a user can see, optionally only those one party
 * owns, one card each: its art, type and week, hit points, treasury, upgrades
 * built and building. This builds the cards from actors, so the window itself
 * only draws them.
 */

import * as core from "./bastion-core.mjs";
import { stateOf } from "./bastion-core.mjs";
import { BASTION_TYPE } from "./bastion-art.mjs";

/** Bastions `user` may see (the GM all of them), only those owned by `party` when one is given, by name. */
export function visibleBastions(actors, { user, party = null } = {}) {
  return [...actors]
    .filter((a) => a?.type === BASTION_TYPE)
    .filter((a) => user?.isGM || a.testUserPermission?.(user, "OBSERVER"))
    .filter((a) => !party || a.system?.party === party.uuid)
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/** One card for an actor. `t` localizes a key and `format` fills one. */
export function bastionCard(actor, { t, format }) {
  const state = stateOf(actor), st = core.stats(state);
  const named = (id) => ({ id, name: t(core.upgradeOf(id)?.name ?? "") });
  const ups = state.upgrades.filter((u) => core.upgradeOf(u.id));
  return {
    id: actor.id,
    name: actor.name,
    img: actor.img,
    typeName: t(st.type.name),
    line: st.standing ? format("SDE.bastion.panel.standing", { week: state.week }) : format("SDE.bastion.panel.raising", { weeks: state.weeksLeft }),
    hp: st.hp,
    maxHp: st.maxHp,
    hpPct: Math.round((100 * st.hp) / st.maxHp),
    breached: st.breached,
    treasury: state.treasury,
    used: st.used,
    slots: st.slots,
    built: ups.filter((u) => u.weeksLeft <= 0).map((u) => named(u.id)),
    building: ups.filter((u) => u.weeksLeft > 0).map((u) => named(u.id)),
  };
}
