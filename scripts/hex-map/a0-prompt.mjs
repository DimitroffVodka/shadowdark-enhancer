/**
 * Shadowdark Enhancer — the one-time offer to make a Western Reaches A0 scene
 * playable (#257). The first time the active GM views a scene showing the A0
 * print that isn't numbered yet, it asks once, and remembers it asked on the
 * scene. Yes runs Make this map playable (hex-tagger-app.mjs); the tagger's
 * button runs it any time after.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { isA0 } from "./a0-print.mjs";

const ASKED_FLAG = "hexPlayableAsked";
const t = (key) => game.i18n.localize(key);

/** Offer it on each scene drawn. Call at ready. */
export function registerA0Prompt() {
  Hooks.on("canvasReady", async (c) => {
    const scene = c?.scene;
    const tex = c?.primary?.background?.texture;
    // Cheap checks first: only the active GM asks, only on the print, only once.
    if (!game.users.activeGM?.isSelf || !scene || !isA0(tex?.width, tex?.height)) return;
    if (scene.getFlag(MODULE_ID, "hexTags")?.origin || scene.getFlag(MODULE_ID, ASKED_FLAG)) return;
    await replaceModuleFlag(scene, ASKED_FLAG, true);
    const yes = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("SDE.hexMap.playable.title"), icon: "fa-solid fa-map" },
      content: `<p>${t("SDE.hexMap.playable.promptBody")}</p>`,
      yes: { label: t("SDE.hexMap.playable.promptYes") },
      no: { label: t("SDE.hexMap.playable.promptNo") },
      rejectClose: false,
    });
    if (yes && canvas.scene === scene) await (await import("./hex-tagger-app.mjs")).HexTaggerApp.makePlayable();
  });
}
