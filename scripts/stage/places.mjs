/**
 * Stage places (custom backdrops), the Foundry side: the `stagePlaces` world setting, showing a place on the
 * stage, and the picture upload. The list never overwrites `stage` and `stage` writes never touch the list.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { addPlace, fitWithin, normalizePlaces, placeById, removePlace, updatePlace, uploadName } from "./places-core.mjs";
import { normalizeStage } from "./stage-core.mjs";

const MAX_EDGE = 2560;

let placesWindow = null;
/** The Places window registers itself here so a setting change on this client redraws it. */
export const setPlacesWindow = (app) => { placesWindow = app; };
export const refreshPlacesWindow = () => { placesWindow?.render({ parts: ["list"] }); };

export function registerPlaces() {
  game.settings.register(MODULE_ID, "stagePlaces", {
    scope: "world",
    config: false,
    type: Object,
    default: normalizePlaces(null),
    onChange: refreshPlacesWindow,
  });
}

export const readPlaces = () => normalizePlaces(game.settings.get(MODULE_ID, "stagePlaces"));

/** Whole-value write of the list (GM only). Returns the written value, or null for a non-GM. */
export async function writePlaces(value) {
  if (!game.user?.isGM) return null;
  const next = normalizePlaces(value);
  await game.settings.set(MODULE_ID, "stagePlaces", next);
  return next;
}

/** Raise a custom place on the stage. The stage carries the picture, so the layer never needs the list. */
export async function showPlace(id) {
  if (!game.user?.isGM) return;
  const place = placeById(readPlaces(), id);
  if (!place) return;
  await game.settings.set(MODULE_ID, "stage", { shown: true, place: place.id, image: place.image, partyId: "", campId: "" });
}

/** Delete a place; if the stage is showing it, hide the stage. The picture file stays where it is. */
export async function removePlaceAndHide(id) {
  if (!game.user?.isGM) return;
  await writePlaces(removePlace(readPlaces(), id));
  const stage = normalizeStage(game.settings.get(MODULE_ID, "stage"));
  if (stage.shown && stage.place === id) await game.settings.set(MODULE_ID, "stage", { ...stage, shown: false });
}

export const addPlaceToList = (place) => writePlaces(addPlace(readPlaces(), place));
/** A new picture for the place on show goes to the stage too, or the table keeps the old one. */
export async function updatePlaceInList(id, patch) {
  const next = await writePlaces(updatePlace(readPlaces(), id, patch));
  const stage = normalizeStage(game.settings.get(MODULE_ID, "stage"));
  const image = next?.places.find((p) => p.id === id)?.image;
  if (image && stage.shown && stage.place === id && image !== stage.image) await game.settings.set(MODULE_ID, "stage", { ...stage, image });
  return next;
}

const warn = (key) => ui.notifications?.warn(game.i18n.localize(key));

/** Encode to WebP 0.85, or JPEG 0.9 when the browser cannot encode WebP. */
async function encode(bitmap, { width, height }) {
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d").drawImage(bitmap, 0, 0, width, height);
  const webp = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
  if (webp.type === "image/webp") return { blob: webp, ext: "webp" };
  return { blob: await canvas.convertToBlob({ type: "image/jpeg", quality: 0.9 }), ext: "jpg" };
}

/**
 * Downscale a picture from the GM's computer and put it in `worlds/<world>/stage/`.
 * @param {File} file
 * @param {string} [name]  the place's name, for the file name
 * @returns {Promise<string|null>} the served path the upload reported, or null (with a notice)
 */
export async function uploadPlacePicture(file, name = "") {
  if (!game.user?.can?.("FILES_UPLOAD")) { warn("SDE.stage.uploadDenied"); return null; }
  if (!file?.type?.startsWith("image/")) { warn("SDE.stage.uploadNotImage"); return null; }
  let full;
  try {
    full = await createImageBitmap(file);
    const size = fitWithin(full.width, full.height, MAX_EDGE);
    let encoded;
    if (size.width === full.width && size.height === full.height) encoded = await encode(full, size);
    else {
      const small = await createImageBitmap(full, { resizeWidth: size.width, resizeHeight: size.height, resizeQuality: "high" });
      try { encoded = await encode(small, size); } finally { small.close?.(); }
    }
    const { blob, ext } = encoded;
    const FP = foundry.applications.apps.FilePicker.implementation;
    const dir = `worlds/${game.world.id}/stage`;
    try { await FP.createDirectory("data", dir); } catch (_err) { /* already there */ }
    const stored = uploadName(name, foundry.utils.randomID(6).toLowerCase()).replace(/\.webp$/, `.${ext}`);
    const res = await FP.upload("data", dir, new File([blob], stored, { type: blob.type }), {}, { notify: false });
    if (!res?.path) throw new Error("no path returned");
    return res.path;
  } catch (err) {
    console.error(`${MODULE_ID} | stage: picture upload failed`, err);
    warn(full ? "SDE.stage.uploadFailed" : "SDE.stage.uploadNotImage");
    return null;
  } finally {
    full?.close?.();
  }
}
