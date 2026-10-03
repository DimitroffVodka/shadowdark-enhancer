/**
 * Shadowdark Enhancer — Bastions: the Aviary's pigeon.
 *
 * A finished Aviary sends one message a day by pigeon. The day is the world clock's day; it is marked
 * on the bastion (`pigeonDay`) before the message goes out, read back, and put back if the message
 * could not be posted, so a pigeon flies once a day and a failed one doesn't use the day up.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import * as core from "./bastion-core.mjs";
import { stateOf } from "./bastion-core.mjs";

/**
 * Send a pigeon from `actor` on world-clock `day`. `{ write, post }` are the bastion write and the
 * message post. Returns `{ ok, error }`: a rules error key ("aviary" | "flown"), "text" for an empty
 * message, or "write" when the day could not be marked or the message could not be posted.
 */
export async function sendPigeon(actor, day, text, { write, post }) {
  const before = stateOf(actor);
  if (!String(text ?? "").trim()) return { ok: false, error: "text" };
  const { state, error } = core.sendPigeon(before, day);
  if (error) return { ok: false, error };
  if (!(await write(actor, state)) || stateOf(actor).pigeonDay !== day) return { ok: false, error: "write" };
  const posted = await Promise.resolve(post()).then(() => true, (err) => { console.error(`${MODULE_ID} | bastion pigeon: message`, err); return false; });
  if (!posted) {
    await write(actor, before);
    return { ok: false, error: "write" };
  }
  return { ok: true, error: null };
}
