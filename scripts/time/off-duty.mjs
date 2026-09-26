/**
 * Shadowdark Enhancer — the off-duty clock move (#228, Overland O2).
 *
 * `time.advanceOffDuty(seconds, {reason})` moves the world clock for downtime,
 * carousing or a rest without burning the torches the party carries. Design:
 * docs/plans/overland.md §3.6. It leans on the light tracker of Shadowdark
 * 4.0.6 (shadowdark-compiled.mjs), so the live check is part of its acceptance:
 *
 *  - Only the system's primary GM burns lights. That is a user flag, not
 *    Foundry's active GM (isPrimaryGM :5071-5093, read at :8080). When no GM
 *    online holds it, the first GM whose tracker sees the clock move takes it
 *    (:5083-5087) and burns in the same call.
 *  - It burns from a cached list (:8089-8117) that a 1-second housekeeping pass
 *    rebuilds (:7879-7882) only when it is dirty (:8191-8199). An item update
 *    does not make it dirty; the tracker's toggleLightSource does, on the
 *    client that calls it (:7905-7927, :8053-8056). A light at 0 is deleted
 *    (:8119-8125).
 *
 * So the move runs on the primary GM, puts the lights out there, waits until
 * that GM's cache no longer holds them, and only then advances. Light spells
 * and dropped Light actors are left to the clock.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { queryActiveGM } from "../shared/gm-relay.mjs";
import { isLightItem } from "../crawl-strip/crawl-lights-core.mjs";
import { esc } from "../shared/esc.mjs";

export const OFF_DUTY_QUERY = `${MODULE_ID}.offDuty`;

// ── Pure decisions (unit-tested) ────────────────────────────────────────────

/**
 * Whose lights the move puts out: every player-owned Player actor, the same
 * filter the tracker burns from (:7957-7959) and the design's fallback for the
 * party's members (§2.1). ponytail: Overland O3 (#229) keeps a travel party's
 * `members`; this set is a superset of it and exactly what the tracker burns,
 * so it stays the safe choice unless a GM wants other PCs' torches left lit.
 */
export const offDutyMembers = (actors) => actors.filter((a) => a?.type === "Player" && a.hasPlayerOwner);

/** The lit Basic lights these actors carry, as `{actor, item}`. Effect lights (a Light spell) are left. */
export const litCarried = (actors) => actors.flatMap((actor) => Array.from(actor.items ?? [])
  .filter((i) => isLightItem(i) && i.type === "Basic" && i.system.light.active === true)
  .map((item) => ({ actor, item })));

/** The GM the system burns lights on: this user when it holds the flag (as isPrimaryGM reads it), else an online GM that does. */
export function primaryLightGM(self, users) {
  const flagged = (u) => !!u?.isGM && u.flags?.shadowdark?.primaryGM === true;
  if (flagged(self)) return self;
  return users.find((u) => u.active && flagged(u)) ?? null;
}

/**
 * Where the move runs. `advance`: tracking is off, so the clock only moves.
 * `handoff`: another GM burns the lights, so it runs there. `douse`: here,
 * taking the primary flag first when nobody online holds it (the system would
 * hand it to the first GM whose tracker saw the clock move, and burn there).
 */
export function offDutyRoute({ tracking, primary, self }) {
  if (!tracking) return "advance";
  return primary && primary.id !== self?.id ? "handoff" : "douse";
}

/** The options `game.time.advance` gets; `timeAdvanced` reads `offDuty` back from them. */
export const advanceOptions = (reason) => ({ [MODULE_ID]: { offDuty: reason } });

/** Is any of these light ids still in the tracker's cached list? Then advancing would burn it. */
export const stillTracked = (monitored, ids) => Array.isArray(monitored)
  && monitored.some((a) => (a?.lightSources ?? []).some((l) => ids.has(l?._id)));

// ── Foundry ─────────────────────────────────────────────────────────────────

const refusal = (key) => ({ ok: false, error: game.i18n.localize(key) });
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** Wait until the tracker's cache no longer holds `ids`, calling its housekeeping pass ourselves. False when it never lets go. */
export async function settle(tracker, ids, { tries = 30, ms = 100 } = {}) {
  // Not 4.0.6's tracker: nothing to read, so the design's timed wait for one pass.
  if (!Array.isArray(tracker.monitoredLightSources)) { await sleep(1100); return true; }
  for (let i = 0; i < tries; i++) {
    await tracker._updateLightSources?.();
    if (!tracker.performingTick && !stillTracked(tracker.monitoredLightSources, ids)) return true;
    await sleep(ms);
  }
  return false;
}

/**
 * Put out every lit Basic light the members carry, with the three steps of the
 * system's sheet toggle (PlayerSheetSD._toggleLightSource, :17127-17168) but
 * without its per-light chat card, so one line names them all. The item keeps
 * its `remainingSecs`; the token's light goes out; the tracker is told here.
 */
async function douse(tracker) {
  const lit = litCarried(offDutyMembers(Array.from(game.actors ?? [])));
  for (const { actor, item } of lit) {
    await actor.updateEmbeddedDocuments("Item", [{ _id: item.id, "system.light.active": false }]);
    await actor.toggleLight?.(false, item.id);
    await tracker.toggleLightSource?.(actor, item);
  }
  if (lit.length) {
    const names = lit.map(({ actor, item }) => game.i18n.format("SDE.time.offDuty.light", { actor: actor.name, light: item.name }));
    const lights = new Intl.ListFormat(game.i18n.lang, { type: "conjunction" }).format(names);
    await ChatMessage.create({ content: `<p>${esc(game.i18n.format("SDE.time.offDuty.chat", { lights }))}</p>` });
  }
  if (!await settle(tracker, new Set(lit.map(({ item }) => item.id)))) return refusal("SDE.time.offDuty.unsettled");
  return { ok: true, doused: lit.map(({ actor, item }) => ({ actorId: actor.id, itemId: item.id })) };
}

/** Run the move on this client, or hand it to the primary GM. `handedOff`: it came from another GM, so never pass it on. */
async function perform(seconds, reason, { handedOff = false } = {}) {
  if (!(Number.isFinite(seconds) && seconds > 0)) return refusal("SDE.time.offDuty.badSeconds");
  const tracker = game.shadowdark?.lightSourceTracker;
  const tracking = !!tracker && game.settings.get("shadowdark", "trackLightSources") === true;
  const primary = primaryLightGM(game.user, Array.from(game.users ?? []));
  const route = offDutyRoute({ tracking, primary, self: game.user });

  if (route === "handoff") {
    if (handedOff) return refusal("SDE.time.offDuty.notPrimary");
    return queryActiveGM(OFF_DUTY_QUERY, { seconds, reason },
      { label: game.i18n.localize("SDE.time.offDuty.relayLabel"), targetUser: primary });
  }
  let doused = [];
  if (route === "douse") {
    if (!primary) await game.user.setFlag("shadowdark", "primaryGM", true);
    const result = await douse(tracker);
    if (!result.ok) return result;
    doused = result.doused;
  }
  await game.time.advance(seconds, advanceOptions(reason));
  return { ok: true, worldTime: game.time.worldTime, doused };
}

/**
 * `game.shadowdarkEnhancer.time.advanceOffDuty(seconds, { reason })`, GM only.
 * @param {number} seconds  how far to move the clock, more than 0
 * @param {{reason?: string}} [options]  what `timeAdvanced` reports as `offDuty`
 * @returns {Promise<{ok: true, worldTime: number, doused: {actorId: string, itemId: string}[]}|{ok: false, error: string}>}
 */
export async function advanceOffDuty(seconds, { reason = "downtime" } = {}) {
  const reply = game.user?.isGM ? await perform(Number(seconds), String(reason)) : refusal("SDE.time.offDuty.gmOnly");
  if (!reply.ok && reply.error) ui.notifications?.warn(reply.error);
  return reply;
}

/**
 * The receiving side of the hand-off, GM to GM. The sender is the
 * server-stamped `user`, never the payload, and this client decides for itself
 * whether it burns the lights: if another GM does, it refuses rather than pass
 * it on (the relay trust model's rules 2 and 3, docs/API.md).
 */
export async function handleOffDutyQuery(data, user) {
  if (!user?.isGM || !game.user?.isGM) return refusal("SDE.time.offDuty.gmOnly");
  return perform(Number(data?.seconds), String(data?.reason ?? "downtime"), { handedOff: true });
}
