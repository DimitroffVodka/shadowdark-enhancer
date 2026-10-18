/**
 * Stage places (custom backdrops), the Foundry-free half: the stored list, its
 * edits, picture sizing and file naming. No Foundry globals here.
 */

import { PLACE_ID, PLACE_KINDS } from "./stage-core.mjs";

export { PLACE_KINDS };
export const MAX_PLACES = 24;
const NAME_MAX = 60;

const str = (v) => (typeof v === "string" ? v : "");

const READY_ART = "modules/shadowdark-enhancer/assets/scenes/places/";

/**
 * The places that ship with the module: a picture, a name and nothing to set up. They are never stored in the
 * `stagePlaces` list and cannot be edited, renamed, replaced or deleted; the window shows them first with Show and Hide.
 * Their ids are permanent: a stage value written today names one. `thumb` is the 480 px preview for the window.
 */
export const READY_PLACES = Object.freeze([
  { id: "ready-tavern", kind: "tavern", nameKey: "SDE.stage.ready.tavern", image: `${READY_ART}tavern.webp`, thumb: `${READY_ART}thumbs/tavern.webp` },
  { id: "ready-town", kind: "town", nameKey: "SDE.stage.ready.town", image: `${READY_ART}town.webp`, thumb: `${READY_ART}thumbs/town.webp` },
  { id: "ready-market", kind: "custom", nameKey: "SDE.stage.ready.market", image: `${READY_ART}market.webp`, thumb: `${READY_ART}thumbs/market.webp` },
].map((p) => Object.freeze(p)));

export const readyById = (id) => READY_PLACES.find((p) => p.id === id) ?? null;

/** The only reader of the places setting: junk is dropped place by place. Never throws. */
export function normalizePlaces(raw) {
  const list = Array.isArray(raw?.places) ? raw.places : [];
  const seen = new Set(), places = [];
  for (const p of list) {
    if (places.length >= MAX_PLACES) break;
    const id = str(p?.id), image = str(p?.image).trim();
    if (!PLACE_ID.test(id) || id === "camp" || readyById(id) || !image || seen.has(id)) continue;
    seen.add(id);
    const place = { id, kind: PLACE_KINDS.includes(p.kind) ? p.kind : "custom", name: [...str(p.name).trim()].slice(0, NAME_MAX).join("").trim(), image };
    if (PLACE_ID.test(str(p.pageSceneId))) place.pageSceneId = p.pageSceneId;
    places.push(place);
  }
  return { places };
}

/** A ready place or one of the GM's own, by id (ready ones come with their `nameKey`, own ones with a `name`). */
export const placeById = (value, id) => readyById(id) ?? normalizePlaces(value).places.find((p) => p.id === id) ?? null;

export function addPlace(value, place) {
  const cur = normalizePlaces(value);
  if (cur.places.length >= MAX_PLACES) return cur;
  return normalizePlaces({ places: [...cur.places, place] });
}

export function updatePlace(value, id, patch) {
  const { name, kind, image, pageSceneId } = patch ?? {};
  const keep = Object.fromEntries(Object.entries({ name, kind, image, pageSceneId }).filter(([, v]) => v !== undefined));
  return normalizePlaces({ places: normalizePlaces(value).places.map((p) => (p.id === id ? { ...p, ...keep } : p)) });
}

export const removePlace = (value, id) => normalizePlaces({ places: normalizePlaces(value).places.filter((p) => p.id !== id) });

/** Scale to a longest edge of at most `max`, never upscaling; integer sizes of at least 1. */
export function fitWithin(width, height, max) {
  if (!(width > 0 && height > 0 && max > 0 && Number.isFinite(width + height + max))) return { width: 1, height: 1 };
  const s = Math.min(1, max / Math.max(width, height));
  return { width: Math.max(1, Math.round(width * s)), height: Math.max(1, Math.round(height * s)) };
}

/** `<slug>-<rand>.webp`: slug lowercase [a-z0-9-], at most 40 chars, "place" when empty. */
export function uploadName(name, rand) {
  const slug = str(name).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+/, "").slice(0, 40).replace(/-+$/, "") || "place";
  return `${slug}-${rand}.webp`;
}

/** The place to show again when the stage is hidden and last showed a custom place that still exists (its current picture is used), else null (the camp case). */
export function reshowTarget(stage, placesValue) {
  if (!stage || stage.shown || !stage.place || stage.place === "camp") return null;
  return placeById(placesValue, stage.place);
}
