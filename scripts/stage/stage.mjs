/**
 * Stage (player name "Backdrop"): one full-screen picture every client shows behind Foundry's UI, kept in the
 * world setting `stage`. This file is the layer, the setting and the GM's toolbar switch.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { isNativeParty } from "../party/party.mjs";
import { campOf } from "../camping/camping.mjs";
import { imageSrc } from "../encounter/battle-maps/battle-map-picker-core.mjs";
import { isActiveGM } from "../shared/gm-relay.mjs";
import { isZoneFight } from "./zone-core.mjs";
import { campArtFor, campTransition, normalizeStage, showCamp } from "./stage-core.mjs";

const read = () => normalizeStage(game.settings.get(MODULE_ID, "stage"));
const write = (value) => game.settings.set(MODULE_ID, "stage", value);
let wasShown = false;

/** Make the layer match the setting. Safe to call any number of times, on every client. */
function drawStage() {
  const stage = read();
  let el = document.querySelector("#sde-stage");
  if (!(stage.shown && stage.place && stage.image)) {
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
  el.style.backgroundImage = `url("${imageSrc({ image: stage.image }).replace(/["\\]/g, "\\$&")}")`;
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

/** The native party with a camp in progress, else the first native party, else null. */
export function pickParty() {
  const parties = game.actors.contents.filter(isNativeParty);
  return parties.find((p) => { const c = campOf(p); return c && c.phase !== "complete"; }) ?? parties[0] ?? null;
}

/** Raise the camp picture by hand (the toolbar switch; piece 3's Camping button). */
export async function raiseByHand(party) {
  const art = campArtFor(await partyTerrain()) ?? campArtFor("");
  return write(showCamp(party ? campOf(party) : null, { partyId: party?.id ?? "", image: art.image }));
}

/** Bring the table calls this. campId stays so the camp cannot re-raise itself. */
export async function hideStage() {
  const stage = read();
  if (!game.user?.isGM || !stage.shown) return;
  await write({ ...stage, shown: false });
}

/** updateActor on a party: raise the camp picture when a camp BEGINS, drop it when the camp ends. Active GM only. */
export async function onPartyCamp(actor, changed, options) {
  if (!isActiveGM() || !isNativeParty(actor)) return;
  // The diff names the key plainly with an operator as its value; the legacy ==/-= spellings still count.
  if (!Object.keys(changed?.flags?.[MODULE_ID] ?? {}).some((k) => k.replace(/^(==|-=)/, "") === "camping")) return;
  // Raising is decided once, on the write that creates the camp (camping.mjs marks it); later setup writes never re-raise.
  const phase = campOf(actor)?.phase;
  if (phase === "setup" && options?.[MODULE_ID]?.campBegin !== true) return;
  const image = phase === "setup" ? (campArtFor(await partyTerrain())?.image ?? null) : null;
  const camp = campOf(actor); // the document, never the diff (it holds the operator); read after the await so a cancel that landed meanwhile wins
  const partyTokenOnMap = !!globalThis.canvas?.scene?.tokens?.some?.((t) => t.actorId === actor.id);
  const next = campTransition(read(), camp, { partyId: actor.id, image, partyTokenOnMap }); // read after the await: fresh state
  if (next) await write(next).catch((e) => console.warn(`${MODULE_ID} | stage write failed`, e));
}

export function registerStage() {
  game.settings.register(MODULE_ID, "stage", {
    scope: "world",
    config: false,
    type: Object,
    default: normalizeStage(null),
    onChange: () => {
      drawStage();
      if (game.user?.isGM) ui.controls?.render({ reset: true });
    },
  });
  Hooks.once("ready", drawStage);
  Hooks.on("updateActor", onPartyCamp);
  // Every canvas draw re-controls a player's tokens (after this hook's draw step, before canvasReady); a module returning false would stop ours, fine, it only releases.
  Hooks.on("canvasReady", () => { if (document.querySelector("#sde-stage")) canvas.tokens?.releaseAll?.(); });
  Hooks.on("getSceneControlButtons", (controls) => {
    if (!game.user?.isGM || !controls.tokens?.tools) return;
    controls.tokens.tools.sdeStage = {
      name: "sdeStage", title: "SDE.stage.tool", icon: "fa-solid fa-image", order: 91, toggle: true,
      active: read().shown,
      onChange: () => (read().shown ? hideStage() : raiseByHand(pickParty())),
    };
    controls.tokens.tools.sdeZoneFight = {
      name: "sdeZoneFight", title: "SDE.stage.zone.tool", icon: "fa-solid fa-swords", order: 93, toggle: true,
      active: Array.from(game.combats ?? []).some(isZoneFight),
      onChange: async () => {
        try {
          const { findZoneFight, startZoneFight, confirmEndZoneFight } = await import("./zone-fight.mjs");
          const fight = findZoneFight();
          if (fight) await confirmEndZoneFight(fight);
          else await startZoneFight();
        } catch (err) {
          console.error(`${MODULE_ID} | zone fight tool failed`, err);
          ui.notifications?.error(game.i18n.localize("SDE.stage.zone.boardFailed"));
        }
        ui.controls?.render({ reset: true }); // a declined End must put the toggle back
      },
    };
  });
}
