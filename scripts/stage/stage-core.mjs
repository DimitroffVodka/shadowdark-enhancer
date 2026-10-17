/**
 * Stage (player name "Backdrop"), the Foundry-free half: reading the stored
 * value, choosing a camp's picture, and the table that raises and drops the
 * Camp place. No Foundry globals here.
 */

import { ENCOUNTER_MAPS, campVariantOf, mapsForTerrain } from "../encounter/battle-maps/encounter-maps.mjs";
import { terrainKeyOf } from "../encounter/battle-maps/battle-map-picker-core.mjs";

/** Places a Stage can show. Phase 1a has only the camp; later phases add to this list. */
export const STAGE_PLACES = ["camp"];

/** Raise the camp backdrop even when a party token is on the viewed map. Patrick: "use a button". */
export const RAISE_WITH_PARTY_TOKEN = false;

const FALLBACK_CAMP_ID = "forest-woods-camp";

const str = (v) => (typeof v === "string" ? v : "");

/** The only reader of the stage setting: junk becomes the defaults, field by field. Never throws. */
export function normalizeStage(raw) {
  const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  return {
    shown: o.shown === true,
    place: STAGE_PLACES.includes(o.place) ? o.place : "",
    image: str(o.image),
    partyId: str(o.partyId),
    campId: str(o.campId),
  };
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
 * What to write to the stage when a party's camp record changes: null (nothing)
 * or the complete next stage value.
 *
 * @param {*} prev  the stored stage
 * @param {{id: string, phase: string}|null} camp  the party's camp record
 * @param {{partyId: string, image: string|null, partyTokenOnMap: boolean}} state
 */
export function campTransition(prev, camp, state, { raiseWithToken = RAISE_WITH_PARTY_TOKEN } = {}) {
  const stage = normalizeStage(prev);
  if (camp?.phase === "setup") {
    if (!camp.id || camp.id === stage.campId || !state?.image) return null;
    if (state.partyTokenOnMap && !raiseWithToken) return null;
    return { shown: true, place: "camp", image: state.image, partyId: str(state.partyId), campId: str(camp.id) };
  }
  if (camp && camp.phase !== "complete") return null;
  // Only the party whose camp this is may drop it; several parties share the one stage.
  const mine = stage.partyId === str(state?.partyId) && (camp ? stage.campId === camp.id : stage.campId !== "");
  if (!stage.shown || stage.place !== "camp" || !mine) return null;
  return { ...stage, shown: false };
}

/** What the toolbar switch and the Camping window's button write to raise the camp picture by hand. */
export function showCamp(camp, { partyId, image }) {
  const running = camp && camp.phase !== "complete";
  return { shown: true, place: "camp", image, partyId: str(partyId), campId: running ? str(camp.id) : "" };
}
