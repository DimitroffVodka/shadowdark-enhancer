/**
 * Shadowdark Enhancer — hex rules on hex maps (#257).
 *
 * On a hex map (encounter-terrain isHexRulesScene: a tagged print or a
 * Shadowdark Extras hexcrawl) no token gives light and the scene has no token
 * vision, so a torch reveals nothing and every player sees the map as a map;
 * Extras' hex fog, when it's there, hides what the party hasn't seen. What the
 * party sees comes from the hex rules instead (GMWR p.41: time, weather,
 * height). Both are decided at runtime: no token's or scene's data changes,
 * so the same PC keeps its torch and its sight on a dungeon map.
 *
 * The party travels as one hex-shaped token: Extras' party token, or without
 * Extras an Enhancer "Party" actor, made the first time a GM starts travel with
 * no party token on the map.
 */

import { MODULE_ID } from "../shared/module-id.mjs";
import { isHexRulesScene } from "../encounter/encounter-terrain.mjs";

/** Actor flag: this NPC is the Enhancer's party (a party without Extras). */
export const PARTY_FLAG = "party";
export const PARTY_TOKEN_IMG = `modules/${MODULE_ID}/icons/party-hex.svg`;

/** Token fields that make a token the party's hex: the black hex, filling one cell, no ring. */
export const PARTY_TOKEN_STYLE = {
  texture: { src: PARTY_TOKEN_IMG, fit: "fill", scaleX: 1, scaleY: 1 },
  width: 1, height: 1, ring: { enabled: false }, lockRotation: true,
};

/**
 * The token and visibility classes, extended. Must run in `init`, before the
 * canvas is built. Whatever another module installed first is extended, not
 * replaced.
 */
export function registerHexRules() {
  const Token = CONFIG.Token?.objectClass;
  if (typeof Token?.prototype?._isLightSource === "function") {
    CONFIG.Token.objectClass = class HexRulesToken extends Token {
      /** @override No token lights a hex map (#257). */
      _isLightSource() { return !isHexRulesScene(this.document?.parent) && super._isLightSource(); }
    };
  } else {
    console.error(`${MODULE_ID} | hex rules: Token#_isLightSource is gone; tokens will light hex maps`);
  }
  const group = CONFIG.Canvas?.groups?.visibility;
  const Visibility = group?.groupClass;
  const has = (cls) => { for (let p = cls?.prototype; p; p = Object.getPrototypeOf(p)) if (Object.getOwnPropertyDescriptor(p, "tokenVision")?.get) return true; return false; };
  if (has(Visibility)) {
    group.groupClass = class HexRulesVisibility extends Visibility {
      /** @override A hex map has no token vision (#257). */
      get tokenVision() { return !isHexRulesScene(globalThis.canvas?.scene) && super.tokenVision; }
    };
  } else {
    console.error(`${MODULE_ID} | hex rules: CanvasVisibility#tokenVision is gone; tokens will see on hex maps`);
  }
}

/** The Enhancer's party actor, made on first use (GM). */
async function partyActor() {
  const found = game.actors.find((a) => a.getFlag(MODULE_ID, PARTY_FLAG));
  if (found) return found;
  const name = game.i18n.localize("SDE.overland.party.name");
  return Actor.create({
    name, type: "NPC", img: PARTY_TOKEN_IMG,
    prototypeToken: { name, actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY, ...PARTY_TOKEN_STYLE },
    flags: { [MODULE_ID]: { [PARTY_FLAG]: true } },
  });
}

/**
 * Put the Enhancer's party on the map (GM): its token in the hex at the centre
 * of the view. For a party without Extras, on Start travel with no party
 * token on the scene.
 * @returns {Promise<TokenDocument|null>}
 */
export async function placePartyToken(scene = globalThis.canvas?.scene) {
  if (!game.user?.isGM || !scene || scene !== canvas.scene) return null;
  const actor = await partyActor();
  if (!actor) return null;
  const { x, y } = canvas.grid.getTopLeftPoint(canvas.grid.getOffset(canvas.stage.pivot));
  // Linked on the token itself: the system makes a new NPC's prototype unlinked.
  const doc = await actor.getTokenDocument({ x, y, actorLink: true });
  const [token] = await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
  return token ?? null;
}

/**
 * Make the travel token the party's hex on a hex map (GM): its scene token
 * only, so the actor keeps its portrait everywhere else. Once: a token already
 * wearing the hex is left alone.
 * @param {TokenDocument} token
 */
export async function wearPartyHex(token) {
  if (!game.user?.isGM || !token || !isHexRulesScene(token.parent)) return;
  if (token.texture?.src === PARTY_TOKEN_IMG) return;
  await token.update(PARTY_TOKEN_STYLE);
}
