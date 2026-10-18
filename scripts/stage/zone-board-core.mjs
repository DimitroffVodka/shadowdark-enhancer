/**
 * Shadowdark Enhancer — Stage zone fight board, the Foundry-free half: what each
 * chip shows to a given viewer. Plain objects in, plain data out.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { canMoveZone, hpBand, layoutBands, zoneFightOf } from "./zone-core.mjs";

// Literal key maps (the i18n scan reads keys written out in full).
const BAND_TITLE = { far: "SDE.stage.zone.bandFar", near: "SDE.stage.zone.bandNear", close: "SDE.stage.zone.bandClose" };
const HP_WORD = { ok: "SDE.stage.zone.hpOk", mid: "SDE.stage.zone.hpMid", low: "SDE.stage.zone.hpLow", critical: "SDE.stage.zone.hpCritical", dead: "SDE.stage.zone.hpDead" };
const BAND_ORDER = ["far", "near", "close"]; // top to bottom

const flagsOf = (doc) => doc?.flags?.[MODULE_ID] ?? {};

/** In turn order when the Combat has turns, else creation order; combatants missing from the turns follow. */
function orderedCombatants(combat) {
  const all = Array.from(combat?.combatants ?? []);
  const turns = Array.isArray(combat?.turns) ? combat.turns : [];
  const seen = new Set(turns.map((c) => c?.id));
  return [...turns.filter(Boolean), ...all.filter((c) => !seen.has(c.id))];
}

/** One of this fight's clones, or a hostile prototype. */
function isFoeOf(actor, fight) {
  if (!actor) return false;
  const flag = flagsOf(actor).zoneClone;
  if (flag && (!fight || flag === fight.id)) return true;
  if (fight?.clones.includes(actor.id)) return true;
  return actor.prototypeToken?.disposition === (globalThis.CONST?.TOKEN_DISPOSITIONS?.HOSTILE ?? -1);
}

function statusIcons(actor) {
  return Array.from(actor?.effects ?? [])
    .filter((e) => e && !e.disabled && (e.img ?? e.icon))
    .map((e) => ({ img: e.img ?? e.icon, name: e.name ?? e.label ?? "" }));
}

/** The data the template draws. `user` is the viewer ({isGM}); plain objects work. */
export function boardContext({ combat, user, stage } = {}) {
  const isGM = !!user?.isGM;
  const fight = zoneFightOf(combat);
  const turnId = combat?.combatant?.id ?? null;
  const chips = orderedCombatants(combat)
    .filter((c) => isGM || c.visible !== false)
    .map((c) => {
      const actor = c.actor ?? null;
      const foe = isFoeOf(actor, fight);
      const zone = flagsOf(c).zone;
      const hp = actor?.system?.attributes?.hp ?? actor?.system?.hp ?? {};
      const band = hpBand(hp.value, hp.max);
      const canAct = canMoveZone({ isGM, ownsActor: !!actor?.isOwner, isFoe: foe });
      return {
        id: c.id,
        zone,
        name: c.name ?? actor?.name ?? "",
        img: actor?.img ?? c.img ?? "",
        foe,
        turn: !!turnId && turnId === c.id,
        defeated: c.defeated === true,
        hidden: isGM && c.hidden === true,
        hp: {
          tone: band.tone,
          pct: Math.round(band.ratio * 100),
          word: HP_WORD[band.tone],
          numbers: isGM || !foe,
          value: hp.value ?? 0,
          max: hp.max ?? 0,
        },
        statuses: statusIcons(actor),
        canAct,
        canDefeat: isGM,
      };
    });
  const bands = layoutBands(chips);
  return {
    backed: !(stage?.shown && stage?.place && stage?.image),
    bands: BAND_ORDER.map((zone) => ({
      zone,
      title: BAND_TITLE[zone],
      count: bands[zone].length,
      chips: bands[zone].map((c) => ({ ...c, atClose: zone === "close", atFar: zone === "far" })),
    })),
  };
}
