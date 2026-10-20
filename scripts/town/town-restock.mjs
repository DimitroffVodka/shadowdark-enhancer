/**
 * Shadowdark Enhancer — Town: shelves that restock by themselves.
 *
 * When the world's day turns, the active GM walks every scene with a landing page and puts back the shelves whose
 * merchants restock every N days (town-core.mjs autoRestock). Only a day change matters (the clock ticks every second
 * under real-time light tracking), and only a page that changed is written, through the serialized writer so a tick can
 * neither undo a switch nor raise a revision twice. A GM who was away when days passed catches up on `ready`.
 */
import { isActiveGM } from "../shared/gm-relay.mjs";
import { autoRestock, landingOf } from "./town-core.mjs";

export function registerTownRestock() {
  let lastDay = null;
  const tick = async () => {
    if (!game.user.isGM || !isActiveGM()) return;
    const { today, updateLanding } = await import("./town-live.mjs");
    const day = today();
    if (day === lastDay) return;
    lastDay = day;
    for (const scene of game.scenes) {
      if (!landingOf(scene)) continue;
      try { await updateLanding(scene, (page) => { const out = page && autoRestock(page, day); return out?.changed ? out.landing : null; }); }
      catch (err) { console.error("Shadowdark Enhancer | auto-restock failed on", scene.name, err); }
    }
  };
  Hooks.on("updateWorldTime", tick);
  Hooks.once("ready", tick);
}
