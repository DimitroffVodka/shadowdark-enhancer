/**
 * Shadowdark Enhancer — Bastions: the Trophy Room's XP.
 *
 * Placing a notable trophy in a finished Trophy Room keeps its name on the bastion and gives each
 * member of the owning party 1 XP (the full amount to each, as Party XP does). The trophy is
 * written first, so a write Foundry refuses gives no XP; if no one could be given the XP the trophy
 * is taken back out, so a trophy on the shelf always means the XP was handed out.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import * as core from "./bastion-core.mjs";
import { stateOf } from "./bastion-core.mjs";

/**
 * Place a trophy for `actor`. `{ write, award, people }` are the bastion write, the Party XP award
 * (`award(amount, { actorIds, label })` -> results or null) and the characters to pay.
 * Returns `{ ok, error, xp }`: `error` is a rules error key, "write", "nobody" or "xp".
 */
export async function placeTrophy(actor, name, { write, award, people }) {
  const before = stateOf(actor);
  const { state, error } = core.placeTrophy(before, name);
  if (error) return { ok: false, error, xp: 0 };
  const covered = people.filter((a) => a?.type === "Player");
  if (!covered.length) return { ok: false, error: "nobody", xp: 0 };
  if (!(await write(actor, state)) || JSON.stringify(stateOf(actor).trophies) !== JSON.stringify(state.trophies)) return { ok: false, error: "write", xp: 0 };
  let results = null;
  try { results = await award(core.TROPHY_XP, { actorIds: covered.map((a) => a.id), label: state.trophies.at(-1) }); }
  catch (err) { console.error(`${MODULE_ID} | bastion trophy: XP`, err); return { ok: true, error: "xp", xp: 0 }; }   // some may have been given: the trophy stays
  if (!results) {
    await write(actor, before);
    return { ok: false, error: "nobody", xp: 0 };
  }
  return { ok: true, error: null, xp: core.TROPHY_XP };
}
