/**
 * Shadowdark Enhancer — Crawl Strip light-source logic (pure).
 *
 * Foundry-free so it can be unit-tested. Operates on plain item-like objects
 * shaped like the Shadowdark ItemSD surface:
 *
 *   { id, name, type, system: { light: {
 *       isSource, active, remainingSecs, longevityMins, template } } }
 *
 * Shadowdark rule model (see systems/shadowdark ItemSD.isLight / ActorSD):
 *   - Only "Basic" (gear: torch, lantern, candle…) and "Effect" (e.g. a Light
 *     spell) items can be light sources, and only when `system.light.isSource`.
 *   - A source is burning when `system.light.active` is true.
 *   - Effect lights are managed by the system's effect lifecycle, so the strip
 *     only offers to toggle *Basic* sources; effect lights show as read-only.
 */

// Shadowdark: only Basic gear and Effect items can be light sources.
export const LIGHT_ITEM_TYPES = ["Basic", "Effect"];

export function isLightItem(item) {
  return !!item
    && LIGHT_ITEM_TYPES.includes(item.type)
    && item.system?.light?.isSource === true;
}

/**
 * Remaining-life bucket for a burning source, as a CSS modifier class.
 * Empty string = full/near-full (the base lit colour). Drives the flame's
 * colour so the GM can eyeball how close a torch is to guttering out.
 *
 * @param {number|null} frac  remainingSecs / (longevityMins*60), or null when unknown
 * @returns {string}
 */
export function lifeClass(frac) {
  if (frac == null || !Number.isFinite(frac)) return "";
  if (frac <= 0.15) return "sde-strip-light-low";
  if (frac <= 0.40) return "sde-strip-light-mid";
  return "";
}

/**
 * Derive the crawl-strip light state for one actor's item list.
 * Render-ready descriptor; never touches Foundry.
 *
 * Returned `state`:
 *   "lit"       — an active light source is burning
 *   "available" — no active light, but ≥1 Basic light is carried & ready
 *   "none"      — nothing to show
 *
 * On "lit": `toggleId` is the id of a Basic active source to extinguish, or
 *   null when only an effect light is burning (read-only).
 * On "available": `choices` lists the carriable Basic sources; `toggleId` is
 *   set only when there's exactly one (otherwise the caller shows a chooser).
 *
 * @param {Array} items
 * @returns {{state:string, activeName?:string, remainingMins?:number,
 *            lifeClass?:string, toggleId?:string|null, choices?:Array}}
 */
export function computeLightState(items = []) {
  const lights = (items ?? []).filter(isLightItem);
  if (!lights.length) return { state: "none" };

  const active = lights.filter(i => i.system.light.active === true);

  if (active.length) {
    // Prefer a Basic active light as the display/extinguish target — effect
    // lights (e.g. a Light spell) are driven by the system's effect lifecycle.
    const basicActive = active.find(i => i.type === "Basic") ?? null;
    const primary = basicActive ?? active[0];
    const light = primary.system.light ?? {};
    const longevitySecs = (light.longevityMins ?? 0) * 60;
    const remainingSecs = Math.max(0, light.remainingSecs ?? 0);
    const frac = longevitySecs > 0 ? remainingSecs / longevitySecs : null;
    return {
      state: "lit",
      activeName: primary.name,
      remainingMins: Math.floor(remainingSecs / 60),
      lifeClass: lifeClass(frac),
      toggleId: basicActive ? basicActive.id : null,
      choices: [],
    };
  }

  const carried = lights.filter(i => i.type === "Basic");
  if (!carried.length) return { state: "none" };

  return {
    state: "available",
    choices: carried.map(i => ({ id: i.id, name: i.name })),
    toggleId: carried.length === 1 ? carried[0].id : null, // else → chooser
  };
}
