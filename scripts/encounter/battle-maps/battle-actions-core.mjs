/**
 * Shadowdark Enhancer — encounter battle maps: what the HUD's buttons and the posted card decide, the pure half
 * (battle-actions.mjs is the half that touches Foundry). Plain values in, plain values out, so Node tests
 * import it. See docs/plans/encounter-battle-maps.md, part D.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { BATTLE_STATUS, FLAGS } from "./constants.mjs";
import { describeSnapshot } from "./encounter-preload-core.mjs";

/** The picker's three looks for a map. */
const VARIANTS = ["day", "night", "camp"];

/**
 * The record behind an answer of BattleMaps: current() may hand back the record itself or `{battle, scene}` (as
 * get() does). Anything without an id (nothing, or a promise) is no battle.
 */
export function recordOf(answer) {
  const record = answer?.battle ?? answer ?? null;
  return record && typeof record === "object" && typeof record.id === "string" && !record.then ? record : null;
}

/** An encounter a battle can be built from: a creature to put on the map. */
export const canBattle = (enc) => !!enc?.uuid && (enc.kind ?? "monster") === "monster";

/** The picker opens when the GM asked to choose, or the party's terrain is unknown, or the library has no default for it. */
export const needsPick = ({ choose = false, terrain = null, hasDefault = false } = {}) => !!choose || !terrain || !hasDefault;

/**
 * The picker's day, night or camp laid over what the clock and the camp say. A camp keeps the night's darkness,
 * and an answer the picker does not give leaves the table's own state alone.
 */
export function withVariant(variant, { night = false, camping = false } = {}) {
  if (!VARIANTS.includes(variant)) return { night: !!night, camping: !!camping };
  return { night: variant === "night" || (variant === "camp" && !!night), camping: variant === "camp" };
}

/**
 * The picker's answer (`{mapId, variant, night}` of a library map, or `{sceneId}` of a world scene) as a battle takes
 * it, over the table's conditions. The picker says whether a camp is lit or dark; the clock says it when it does not.
 */
export function pickAnswer(pick, now = {}) {
  const look = withVariant(pick?.variant, now);
  return {
    mapId: pick?.mapId ?? null,
    sceneId: pick?.sceneId ?? null,
    variant: pick?.variant ?? null,
    night: typeof pick?.night === "boolean" ? pick.night : look.night,
    camping: look.camping,
  };
}

/** What BattleMaps.setUp takes: the encounter, where the party stands, the table's conditions, and the GM's pick if they made one. */
export function setUpArgs({ enc, terrain = null, hex = null, originSceneId = null, night = false, camping = false, pick = null }) {
  const args = { encounter: cardEncounter(enc), terrain, hex, ...(pick ? pickAnswer(pick, { night, camping }) : { night: !!night, camping: !!camping }) };
  // No scene to come back to given: leave it out, so setUp's own default (the viewed scene) applies.
  if (originSceneId) args.originSceneId = originSceneId;
  return args;
}

/** What Change map opens the picker with: the battle's terrain and its look as it stands. */
export const pickerArgs = (battle, now) => ({ terrain: battle?.terrain ?? null, ...withVariant(battle?.variant, now) });

// ─── The posted card ────────────────────────────────────────────────────────

/** The encounter as a battle keeps it: just what is needed to put the creatures on the map. */
export const cardEncounter = (enc) => ({
  kind: "monster",
  uuid: enc?.uuid ?? null,
  name: enc?.name ?? null,
  count: Number.isFinite(enc?.count) ? enc.count : 1,
  distanceRoll: Number.isFinite(enc?.distanceRoll) ? enc.distanceRoll : null,
});

/** What a posted monster card keeps in its message flags for its Battle map button. */
export const cardStash = ({ res, terrain = null, hexNum = null, originSceneId = null }) =>
  ({ encounter: cardEncounter(res), terrain, hexNum, originSceneId });

/** A card's stash if a battle can be built from it, else null (an older card, or one with no creature). */
export function readStash(stash) {
  if (!canBattle(stash?.encounter)) return null;
  return {
    encounter: stash.encounter,
    terrain: stash.terrain ?? null,
    hexNum: Number.isInteger(stash.hexNum) ? stash.hexNum : null,
    originSceneId: stash.originSceneId ?? null,
  };
}

// ─── The panel ──────────────────────────────────────────────────────────────

/** Which controls the panel offers for a battle (null: none yet). A battle can be taken down from either stage. */
export function battleControls(battle) {
  if (!battle) return { start: true, bring: false, change: false, back: false };
  const staged = battle.status === BATTLE_STATUS.staged;
  return { start: false, bring: staged, change: staged, back: true };
}

// The readout is worded by the preload part (encounter-preload-core.mjs describeSnapshot), so "ready" and
// "pending" mean there what they mean here. A snapshot of null is no readout: no preload ran.

/** The "Ready n/N" label's numbers, or null when nobody is expected (no preload ran, or no player is connected). */
export function readyArgs(preload) {
  const { readyLabelArgs } = describeSnapshot(preload);
  return readyLabelArgs.expected > 0 ? readyLabelArgs : null;
}

/** Everyone expected has the map. */
export const allReady = (preload) => readyArgs(preload) !== null && describeSnapshot(preload).tone === "ready";

/** Who has not finished loading, for the confirm. */
export const stillLoading = (preload) => describeSnapshot(preload).pending;

/** Bringing the table before everyone expected is ready asks first. */
export const needsConfirm = (preload) => readyArgs(preload) !== null && !allReady(preload);

/** What the one line under the rows says: nobody connected, everyone ready, or who is being waited on. */
export function readoutSummary(preload) {
  if (!preload) return null;
  if (readyArgs(preload) === null) return { kind: "nobody" };
  return allReady(preload) ? { kind: "allReady" } : { kind: "pending", names: stillLoading(preload).join(", ") };
}

/** A player's bar, in whole percent. The ledger keeps the share as a fraction of one; one who has left shows none. */
export function barPercent(row) {
  if (row?.state === "ready") return 100;
  if (row?.state === "left") return 0;
  const share = Number(row?.pct);
  return Number.isFinite(share) ? Math.round(Math.max(0, Math.min(1, share)) * 100) : 0;
}

/** What a redraw of the readout would change, so a burst of progress that moves nothing visible draws nothing. */
export const readoutKey = (preload) => (preload
  ? JSON.stringify((preload.rows ?? []).map((row) => [row.userId, row.state, barPercent(row), row.loaded, row.total]))
  : "");

// ─── The bar ────────────────────────────────────────────────────────────────

/**
 * What the bar's open panel, and its memory of the battle's stage, become when a redraw sees `stage` (null: no
 * battle). A staged battle opens its panel, once, so the readout is in view. A battle that goes live folds it: the
 * table's combat has put its cards (the Crawl Strip) right under the bar, and the panel would cover them. A battle
 * that is gone closes it. One first seen live (a reload) is left folded, and any panel the GM opened themselves
 * (the Time panel, the month) stays.
 */
export function panelAfter({ open = null, stage: last = null } = {}, stage = null) {
  if (stage === last) return { open, stage };
  if (stage === BATTLE_STATUS.staged) return { open: "battle", stage };
  return { open: open === "battle" ? null : open, stage };
}

/** The panel a change of scene leaves open: a staged battle's, where its readout is in view; none once it is live. */
export const panelOnScene = (stage) => (stage === BATTLE_STATUS.staged ? "battle" : null);

/** A change in the preload readout is worth a redraw only where it shows, and never under a GM typing the Time panel's date. */
export const readoutShown = ({ open = null, typing = false } = {}) => (open === "battle" || open === "encounter") && !typing;

/** Did a scene update change the battle record? (A flag replaced or deleted shows up under its key, with or without the operator prefix.) */
export const touchesBattle = (changed) =>
  Object.keys(changed?.flags?.[MODULE_ID] ?? {}).some((key) => key.replace(/^(-=|==)/, "") === FLAGS.battle);

/**
 * Keeps the HUD's preload readout live without leaking: it listens while a battle is staged and not otherwise, and
 * folds a burst of progress messages into one redraw. A redraw replaces the bar's buttons, and a click on a button
 * that is replaced between the press and the release is lost, so while the pointer is held (`hold`) a redraw that
 * falls due waits for the release.
 * @param {{subscribe:(fn:Function) => Function, redraw:() => void, delay?:number, setTimer?:Function, clearTimer?:Function}} io
 *   subscribe: C's onPreloadChange (returns the unsubscribe)
 */
export function makePreloadWatch({ subscribe, redraw, delay = 300, setTimer = setTimeout, clearTimer = clearTimeout }) {
  let off = null;
  let timer = null;
  let held = false;
  let owed = false;
  const queue = () => {
    if (timer === null) timer = setTimer(() => { timer = null; if (held) owed = true; else redraw(); }, delay);
  };
  return {
    /** The pointer went down on the bar (true) or came up (false). */
    hold(down) {
      held = !!down;
      // After the release, so the click that follows it still finds the button it was aimed at.
      if (!held && owed) { owed = false; setTimer(redraw, 0); }
    },
    /** Call on every redraw: listens while `staged`, stops when not. */
    sync(staged) {
      if (staged && off === null) {
        const stop = subscribe(queue);
        // A subscription that cannot be undone still counts as made: asking again would stack another.
        off = typeof stop === "function" ? stop : () => {};
      } else if (!staged && off !== null) {
        off();
        off = null;
        owed = false;
        if (timer !== null) { clearTimer(timer); timer = null; }
      }
    },
    get listening() { return off !== null; },
  };
}
