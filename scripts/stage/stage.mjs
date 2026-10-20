/**
 * Camp picture: one full-screen picture every client shows behind Foundry's UI, kept in the world setting `stage`.
 * The GM shows and hides it with the Camping window's button; the camp ending or Bring the table hides it too.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { isNativeParty } from "../party/party.mjs";
import { campOf } from "../camping/camping.mjs";
import { fileRoute } from "../shared/file-route.mjs";
import { isActiveGM } from "../shared/gm-relay.mjs";
import { campArtFor, campPictureUp, campTransition, normalizeStage, showCamp } from "./stage-core.mjs";

const read = () => normalizeStage(game.settings.get(MODULE_ID, "stage"));
const write = (value) => game.settings.set(MODULE_ID, "stage", value);
let wasShown = false;

/** Make the layer match the setting. Safe to call any number of times, on every client. */
function drawStage() {
  const stage = read();
  let el = document.querySelector("#sde-stage");
  if (!campPictureUp(stage)) {
    el?.remove();
    wasShown = false;
    return;
  }
  if (!el) {
    el = document.createElement("div");
    el.id = "sde-stage";
    el.setAttribute("aria-hidden", "true");
    document.body.append(el);
  }
  el.style.backgroundImage = `url("${fileRoute(stage.image).replace(/["\\]/g, "\\$&")}")`;
  // Arrow keys and Delete would otherwise keep driving the canvas hidden underneath.
  if (!wasShown) globalThis.canvas?.tokens?.releaseAll?.();
  wasShown = true;
}

/** The terrain key of the party's hex, or "" when nothing says (no party token on the map is normal). */
export async function partyTerrain() {
  try {
    const { partyHex, terrainKey } = await import("../encounter/encounter-terrain.mjs");
    const overland = game.shadowdarkEnhancer?.overland;
    let hex = overland?.isActive?.() ? overland.state()?.hex : null;
    hex ??= partyHex();
    return terrainKey(hex?.terrain);
  } catch {
    return "";
  }
}

/** Raise the camp picture for `party` (null: no party, the woods camp). */
export async function raiseByHand(party) {
  const art = campArtFor(await partyTerrain()) ?? campArtFor("");
  return write(showCamp(party ? campOf(party) : null, { partyId: party?.id ?? "", image: art.image }));
}

/** The Camping window's button: hide the picture when it is up, else raise it for `party`. GM only. */
export async function toggleCampPicture(party) {
  if (!game.user?.isGM) return null;
  return campPictureUp(read()) ? hideStage() : raiseByHand(party);
}

/** Bring the table calls this. campId stays so the camp's end does nothing more. Answers the place it hid, else null. */
export async function hideStage() {
  const stage = read();
  if (!game.user?.isGM || !stage.shown) return null;
  await write({ ...stage, shown: false });
  return stage.place || null;
}

/** updateActor on a party: drop the camp picture when the camp it was raised for ends. Active GM only. */
export async function onPartyCamp(actor, changed) {
  if (!isActiveGM() || !isNativeParty(actor)) return;
  // The diff names the key plainly with an operator as its value; the legacy ==/-= spellings still count.
  if (!Object.keys(changed?.flags?.[MODULE_ID] ?? {}).some((k) => k.replace(/^(==|-=)/, "") === "camping")) return;
  const next = campTransition(read(), campOf(actor), { partyId: actor.id }); // the document, never the diff (it holds the operator)
  if (next) await write(next).catch((e) => console.warn(`${MODULE_ID} | stage write failed`, e));
}

/** Re-render the open windows that carry the camp picture button (the Camping window, the Party sheet's copy) so its label follows. */
function refreshCampButtons() {
  for (const app of foundry.applications.instances.values()) {
    if (app.rendered && app.element?.querySelector?.('[data-action="campPicture"], [data-activity-action="campPicture"]')) app.render();
  }
}

export function registerStage() {
  game.settings.register(MODULE_ID, "stage", {
    scope: "world",
    config: false,
    type: Object,
    default: normalizeStage(null),
    onChange: () => {
      drawStage();
      refreshCampButtons();
    },
  });
  Hooks.once("ready", drawStage);
  Hooks.on("updateActor", onPartyCamp);
  // Every canvas draw re-controls a player's tokens (after this hook's draw step, before canvasReady); a module returning false would stop ours, fine, it only releases.
  Hooks.on("canvasReady", () => { if (document.querySelector("#sde-stage")) canvas.tokens?.releaseAll?.(); });
}
