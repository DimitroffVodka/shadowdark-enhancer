/**
 * Shadowdark Enhancer — the off-duty clock move (#228, Overland O2).
 *
 * `time.advanceOffDuty(seconds, {reason})` moves the world clock for downtime,
 * carousing or a rest without burning the torches the party carries. Design:
 * docs/plans/overland.md §3.6. It leans on the light tracker of Shadowdark
 * 4.0.6 (shadowdark-compiled.mjs), so the live check is part of its acceptance:
 *
 *  - Every GM tab whose user holds the `primaryGM` flag burns lights; it is a
 *    user flag, not Foundry's active GM (isPrimaryGM :5071-5093, read at
 *    :8080). When no GM online holds it, the first GM whose tracker sees the
 *    clock move takes it (:5083-5087, without awaiting the write) and burns in
 *    the same call. Each GM clears only its own flag when it loads (:7866), so
 *    two tabs can hold it at once, and then both burn.
 *  - Each burns from its own cached list (:8089-8117), which a 1-second
 *    housekeeping pass rebuilds (:7879-7882) only when it is dirty
 *    (:8191-8199). An item update does not make it dirty. A light at 0 is
 *    deleted (:8119-8125).
 *  - With real-time tracking on, the primary tab advances the clock by 1 every
 *    second (:7558-7567). `advance` sets an absolute time computed on the
 *    sending tab (client helpers/time.mjs:146-150), so a tick sent after the
 *    jump would undo it.
 *
 * So the move runs on the one tab that holds the flag, with its real-time
 * clock stopped. It puts the lights out there and waits until that tab's cache
 * holds no PC's Basic light. It refuses if any other tab holds the flag, and
 * only then advances. Light spells and dropped Light actors are left to the
 * clock.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { queryActiveGM } from "../shared/gm-relay.mjs";
import { isLightItem } from "../crawl-strip/crawl-lights-core.mjs";
import { esc } from "../shared/esc.mjs";

export const OFF_DUTY_QUERY = `${MODULE_ID}.offDuty`;

/** How long the calling GM waits for the primary tab: a douse is a few round trips per light, plus the waits below. */
export const HANDOFF_TIMEOUT_MS = 60000;

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

/** The GMs online whose tabs burn lights: every one holding the system's `primaryGM` flag. */
export const lightGMs = (users) => users.filter((u) => !!u?.active && !!u.isGM && u.flags?.shadowdark?.primaryGM === true);

/**
 * Where the move runs, given the GMs that hold the flag.
 * - `advance`: tracking is off, so the clock only moves.
 * - `twoPrimaries`: more than one tab would burn, and a douse can clear only one tab's cache.
 * - `handoff`: another GM burns the lights, so the move runs there.
 * - `douse`: here, taking the flag first when nobody online holds it (the
 *   system would give it to the first GM whose tracker saw the clock move).
 */
export function offDutyRoute({ tracking, flagged, selfId }) {
  if (!tracking) return "advance";
  if (flagged.length > 1) return "twoPrimaries";
  return flagged.length && flagged[0].id !== selfId ? "handoff" : "douse";
}

/** Just before advancing: null when this GM alone holds the flag, else why the move stops. */
export function burnCheck(flagged, selfId) {
  if (flagged.length > 1) return "twoPrimaries";
  return flagged.length === 1 && flagged[0].id === selfId ? null : "notPrimary";
}

/** The options `game.time.advance` gets; `timeAdvanced` reads `offDuty` back from them. */
export const advanceOptions = (reason) => ({ [MODULE_ID]: { offDuty: reason } });

/** Does the tracker's cached list still hold a Basic light of one of these actors? Then advancing would burn it. */
export const stillTracked = (monitored, actorIds) => Array.isArray(monitored)
  && monitored.some((a) => actorIds.has(a?._id) && (a.lightSources ?? []).some((l) => l?.type === "Basic"));

// ── Foundry ─────────────────────────────────────────────────────────────────

const refusal = (key, data) => ({ ok: false, error: data ? game.i18n.format(key, data) : game.i18n.localize(key) });
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });
const names = (users) => users.map((u) => u.name).join(", ");
/** A throw anywhere becomes a refusal: the clock was not moved (a failed advance moves nothing). */
const safely = (promise) => promise.catch((err) => {
  console.error(`${MODULE_ID} | off-duty move stopped`, err);
  return refusal("SDE.time.offDuty.failed");
});

/** The refusal for a `burnCheck`/`offDutyRoute` verdict. */
function burnRefusal(verdict, flagged) {
  if (verdict === "twoPrimaries") return refusal("SDE.time.offDuty.twoPrimaries", { names: names(flagged) });
  return refusal("SDE.time.offDuty.notPrimary");
}

/**
 * Rebuild the tracker's cache and wait until it holds no Basic light of the
 * members and no burn tick is running. False when it never gets there.
 */
export async function settle(tracker, actorIds, { tries = 30, ms = 100 } = {}) {
  // Not 4.0.6's tracker: nothing to read, so the design's timed wait for one pass.
  if (!Array.isArray(tracker.monitoredLightSources)) { await sleep(1100); return true; }
  tracker.dirty = true;   // even with nothing put out here, the list can predate a light put out elsewhere
  for (let i = 0; i < tries; i++) {
    await tracker._updateLightSources?.();
    if (!tracker.performingTick && !stillTracked(tracker.monitoredLightSources, actorIds)) return true;
    await sleep(ms);
  }
  return false;
}

/**
 * The token's light goes out as the sheet toggle does it (ActorSD.toggleLight,
 * :10981-10998). That reads the canvas's tokens layer (:10891), which a tab in
 * core's no-canvas mode doesn't have; there only the prototype token goes dark.
 */
const lightOff = (actor, item) => (globalThis.canvas?.tokens
  ? actor.toggleLight?.(false, item.id)
  : actor.update({ "prototypeToken.light": { dim: 0, bright: 0 } }));

/**
 * On the tab that holds the flag: put out every lit Basic light the members
 * carry, with the three steps of the system's sheet toggle
 * (PlayerSheetSD._toggleLightSource, :17127-17168) minus its per-light chat
 * card. The item keeps its `remainingSecs`. Then settle, check nobody else
 * holds the flag, and advance. After a throw or a refusal the clock is not
 * moved, and the reply still lists what was put out. One chat line names the
 * lights and says whether the clock moved.
 */
async function douseAndAdvance(tracker, seconds, reason, { tookFlag }) {
  const members = offDutyMembers(Array.from(game.actors ?? []));
  const doused = [];
  const clock = tracker.realTime;
  const ticking = clock?.updateIntervalId != null;
  let failure = null;
  if (ticking) clock.stop();
  try {
    if (tookFlag) await game.user.setFlag("shadowdark", "primaryGM", true);
    for (const { actor, item } of litCarried(members)) {
      await actor.updateEmbeddedDocuments("Item", [{ _id: item.id, "system.light.active": false }]);
      doused.push({ actor, item });
      await lightOff(actor, item);
      await tracker.toggleLightSource?.(actor, item);
    }
    if (!await settle(tracker, new Set(members.map((a) => a.id)))) {
      failure = refusal("SDE.time.offDuty.unsettled");
    } else {
      if (tookFlag) await sleep(1100);   // a promotion that raced ours has landed by now
      const flagged = lightGMs(Array.from(game.users ?? []));
      const verdict = burnCheck(flagged, game.user.id);
      if (verdict) failure = burnRefusal(verdict, flagged);
    }
    if (!failure && seconds > 0) await game.time.advance(seconds, advanceOptions(reason));
  } catch (err) {
    console.error(`${MODULE_ID} | off-duty move stopped`, err);
    failure = refusal("SDE.time.offDuty.failed");
  } finally {
    if (ticking) clock.start();
  }

  if (doused.length) {
    const lights = new Intl.ListFormat(game.i18n.lang, { type: "conjunction" }).format(doused.map(({ actor, item }) =>
      game.i18n.format("SDE.time.offDuty.light", { actor: actor.name, light: item.name })));
    const line = failure ? "SDE.time.offDuty.chatRefused" : "SDE.time.offDuty.chat";
    await ChatMessage.create({ content: `<p>${esc(game.i18n.format(line, { lights }))}</p>` })
      .catch((err) => console.error(`${MODULE_ID} | off-duty chat line`, err));
  }
  const out = doused.map(({ actor, item }) => ({ actorId: actor.id, itemId: item.id }));
  return failure ? { ...failure, doused: out } : { ok: true, worldTime: game.time.worldTime, doused: out };
}

/** Run the move on this client, or hand it to the primary GM. `handedOff`: it came from another GM, so never pass it on. */
async function perform(seconds, reason, { handedOff = false } = {}) {
  // 0 seconds puts the lights out and moves no clock: Overland's camp (#233)
  // does that, then moves the clock itself with its encounter checks.
  if (!(Number.isFinite(seconds) && seconds >= 0)) return refusal("SDE.time.offDuty.badSeconds");
  const tracker = game.shadowdark?.lightSourceTracker;
  const tracking = !!tracker && game.settings.get("shadowdark", "trackLightSources") === true;
  const flagged = lightGMs(Array.from(game.users ?? []));
  const route = offDutyRoute({ tracking, flagged, selfId: game.user.id });

  if (route === "advance") {
    if (seconds > 0) await game.time.advance(seconds, advanceOptions(reason));
    return { ok: true, worldTime: game.time.worldTime, doused: [] };
  }
  if (route === "twoPrimaries") return burnRefusal(route, flagged);
  if (route === "handoff") {
    if (handedOff) return refusal("SDE.time.offDuty.notPrimary");
    const reply = await queryActiveGM(OFF_DUTY_QUERY, { seconds, reason }, {
      label: game.i18n.localize("SDE.time.offDuty.relayLabel"), targetUser: flagged[0], queryTimeoutMs: HANDOFF_TIMEOUT_MS,
    });
    // No answer is not a refusal: a slow tab can still move the clock, and a retry would move it twice.
    return reply?.answered === false ? refusal("SDE.time.offDuty.unknown", { name: flagged[0].name }) : reply;
  }
  return douseAndAdvance(tracker, seconds, reason, { tookFlag: !flagged.length });
}

/**
 * `game.shadowdarkEnhancer.time.advanceOffDuty(seconds, { reason })`, GM only.
 * @param {number} seconds  how far to move the clock: 0 or more; 0 only puts the lights out
 * @param {{reason?: string}} [options]  what `timeAdvanced` reports as `offDuty`
 * @returns {Promise<{ok: true, worldTime: number, doused: {actorId: string, itemId: string}[]}
 *   |{ok: false, error: string, doused?: {actorId: string, itemId: string}[]}>}
 *   `doused` on a refusal: what was put out before the move stopped.
 */
export async function advanceOffDuty(seconds, { reason = "downtime" } = {}) {
  const reply = game.user?.isGM
    ? await safely(perform(Number(seconds), String(reason)))
    : refusal("SDE.time.offDuty.gmOnly");
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
  return safely(perform(Number(data?.seconds), String(data?.reason ?? "downtime"), { handedOff: true }));
}
