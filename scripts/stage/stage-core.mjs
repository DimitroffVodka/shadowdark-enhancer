/**
 * Camp picture, the Foundry-free half: reading the stored value, choosing a
 * camp's picture, and when a camp's end drops it. No Foundry globals here.
 */

import { ENCOUNTER_MAPS, campVariantOf, mapsForTerrain } from "../encounter/battle-maps/encounter-maps.mjs";
import { terrainKeyOf } from "../encounter/battle-maps/battle-map-picker-core.mjs";

const FALLBACK_CAMP_ID = "forest-woods-camp";

const str = (v) => (typeof v === "string" ? v : "");

/**
 * The only reader of the stage setting: junk becomes the defaults, field by field. Never throws. The camp is the only
 * place; a world that still stores an old Backdrop place reads as nothing up.
 */
export function normalizeStage(raw) {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    shown: o.shown === true,
    place: o.place === "camp" ? "camp" : "",
    image: str(o.image),
    partyId: str(o.partyId),
    campId: str(o.campId),
  };
}

/** Is the camp picture up for everyone? */
export function campPictureUp(raw) {
  const stage = normalizeStage(raw);
  return stage.shown && stage.place === "camp" && stage.image !== "";
}

/** The camp picture for a terrain as {id, image}, or null on water (the boat is the camp). */
export function campArtFor(terrain) {
  const days = mapsForTerrain(terrainKeyOf(terrain));
  if (days[0]?.boat) return null;
  const camp = days.map(campVariantOf).find(Boolean)
    ?? ENCOUNTER_MAPS.find((m) => m.id === FALLBACK_CAMP_ID);
  return { id: camp.id, image: camp.image };
}

/**
 * What to write to the stage when a party's camp record changes: null (nothing), or the hidden stage when that
 * party's camp ended (complete, or the record gone) while its picture was up. A camp never raises the picture; it only adopts one its party raised by hand.
 *
 * @param {*} prev  the stored stage
 * @param {{id: string, phase: string}|null} camp  the party's camp record
 * @param {{partyId: string}} state
 */
export function campTransition(prev, camp, state) {
  const stage = normalizeStage(prev);
  if (camp && camp.phase !== "complete") {
    // A picture raised by hand before this party's camp began is adopted by it, so the camp's end drops it.
    const adopt = camp.id && stage.shown && stage.place === "camp" && stage.campId === "" && stage.partyId === str(state?.partyId);
    return adopt ? { ...stage, campId: str(camp.id) } : null;
  }
  // Only the party whose camp this is may drop it; several parties share the one stage.
  const mine = stage.partyId === str(state?.partyId) && (camp ? stage.campId === camp.id : stage.campId !== "");
  if (!stage.shown || stage.place !== "camp" || !mine) return null;
  return { ...stage, shown: false };
}

/** What the Camping window's button writes to raise the camp picture. */
export function showCamp(camp, { partyId, image }) {
  const running = camp && camp.phase !== "complete";
  return { shown: true, place: "camp", image, partyId: str(partyId), campId: running ? str(camp.id) : "" };
}
