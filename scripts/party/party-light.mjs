import { MODULE_ID } from "../shared/module-id.mjs";
import { Party, isNativeParty, isLegacyParty } from "./party.mjs";
import { isHexRulesScene } from "../encounter/encounter-terrain.mjs";
/** Runtime-only mirror: never copy an Item or enroll a second fuel consumer. */
function mirror(doc) {
  const actor = doc.actor;
  if (!(isNativeParty(actor) || isLegacyParty(actor)) || isHexRulesScene(doc.parent) || !globalThis.game?.actors) return;
  const sources = [doc._source.light];
  const packed = doc.flags?.[MODULE_ID]?.partyMovement?.packed ?? [];
  try {
    for (const uuid of Party.members(actor)) {
      const member = game.actors.contents.find(a => a.uuid === uuid);
      if (!member) continue;
      const sceneToken = doc.parent?.tokens?.contents.find(d => d.actorLink && d.actorId === member.id);
      // A prototype is placement configuration, not an active light. In particular,
      // a current extinguished token overrides an older packed burning source.
      sources.push(sceneToken ? sceneToken._source.light : packed.find(s => s.actorId === member.id)?.light);
    }
  } catch (error) { console.warn(`${MODULE_ID} | Party light roster`, error); }
  const light = sources.filter(l => l && Math.max(l.dim, l.bright) > 0).sort((a, b) => Math.max(b.dim, b.bright) - Math.max(a.dim, a.bright))[0] ?? doc._source.light;
  if (light) doc.light = new foundry.data.LightData(light.toObject?.() ?? light, { parent: doc });
}
export function refreshPartyLights() {
  for (const token of globalThis.canvas?.tokens?.placeables ?? []) {
    const doc = token.document, actor = token.actor;
    if (!(isNativeParty(actor) || isLegacyParty(actor))) continue;
    doc.prepareData();
    token.initializeLightSource();
  }
  canvas.perception.update({ refreshLighting: true, refreshVision: true });
}
export function registerPartyLight() {
  const TokenDocument = CONFIG.Token.documentClass;
  CONFIG.Token.documentClass = class PartyLightTokenDocument extends TokenDocument {
    prepareDerivedData() { super.prepareDerivedData(); mirror(this); }
  };
  Hooks.on("canvasReady", refreshPartyLights);
  for (const hook of ["updateActor", "updateItem", "createItem", "deleteItem", "updateToken", "createToken", "deleteToken"]) Hooks.on(hook, () => { if (globalThis.canvas?.ready) refreshPartyLights(); });
}
