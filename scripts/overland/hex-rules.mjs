/**
 * Shadowdark Enhancer — hex rules on hex maps (#257).
 *
 * On a hex map (encounter-terrain isHexRulesScene: any scene with a hex grid,
 * #298) no token gives light and the scene has no token
 * vision, so a torch reveals nothing and every player sees the map as a map;
 * Extras' hex fog, when it's there, hides what the party hasn't seen, and a
 * token in a hex it hasn't revealed stays hidden from players when Extras can
 * say so (api.hex.isPositionRevealed). What the party sees comes from the hex
 * rules instead (GMWR p.41: time, weather, height). All of it is decided at
 * runtime (the scene's tokenVision is overridden on the document, so every
 * reader of it agrees): no token's or scene's stored data changes, so the same
 * PC keeps its torch and its sight on a dungeon map.
 *
 * The party travels as one hex-shaped token: Extras' party token, or else an
 * Enhancer "Party" actor, made the first time a GM starts travel with no party
 * token on the map. With Extras there and no party of its own, that actor is an
 * Extras party too (joinExtras), so it opens Extras' Party sheet.
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

      /**
       * @override With no token vision, core shows every unhidden token. A
       * player doesn't see one in a hex Extras' fog hasn't revealed, when
       * Extras can tell (its api.hex.isPositionRevealed; nothing is read from
       * its flags).
       */
      get isVisible() {
        const visible = super.isVisible;
        if (!visible || game.user?.isGM || this.isOwner || this.isPreview) return visible;
        const scene = this.document?.parent;
        const revealed = game.modules?.get("shadowdark-extras")?.api?.hex?.isPositionRevealed;
        if (typeof revealed !== "function" || !isHexRulesScene(scene)) return visible;
        try { return revealed(scene, this.center) !== false; } catch { return visible; }
      }
    };
  } else {
    console.error(`${MODULE_ID} | hex rules: Token#_isLightSource is gone; tokens will light hex maps`);
  }
  // No token vision on a hex map, on the Scene document itself, so every
  // reader of scene.tokenVision agrees (canvas visibility, token control, the
  // fog, notes). The stored value is untouched: SceneConfig reads _source.
  const Scene = CONFIG.Scene?.documentClass;
  if (Scene) {
    CONFIG.Scene.documentClass = class HexRulesScene extends Scene {
      /** @override */
      prepareDerivedData() {
        super.prepareDerivedData();
        if (isHexRulesScene(this)) this.tokenVision = false;
      }
    };
  }
  // A scene that becomes a hex map, or stops being one, mid-session: its
  // token sources are rebuilt (core only redraws on a grid change).
  let hexRules = null;
  Hooks.on("canvasReady", (c) => { hexRules = isHexRulesScene(c.scene); });
  Hooks.on("updateScene", (scene, changed) => {
    if (scene !== globalThis.canvas?.scene || !("flags" in (changed ?? {}) || "grid" in (changed ?? {}))) return;
    const now = isHexRulesScene(scene);
    if (now === hexRules) return;
    hexRules = now;
    for (const token of canvas.tokens.placeables) token.initializeSources();
    canvas.perception.initialize();
  });
}

const EXTRAS_ID = "shadowdark-extras";

/** Extras' party API, when Extras is there and switched on to answer. */
const extrasPartyApi = () => {
  const extras = game.modules?.get(EXTRAS_ID);
  return extras?.active && typeof extras.api?.party?.list === "function" ? extras.api.party : null;
};

/** Extras' party actors, when Extras is there to say. */
export function extrasParties() {
  try { return extrasPartyApi()?.list() ?? []; } catch { return []; }
}

/**
 * Should this actor be an Extras party too? When Extras is there and has no party but this one. With a
 * party of its own Extras keeps that one (Start travel uses it and never makes ours); two would leave
 * the travel token ambiguous.
 */
const joinsExtras = (actor) => !!extrasPartyApi() && extrasParties().every((a) => a.id === actor?.id);

/** The player characters, as the members an Extras party starts with: who travelled before Extras' sheet came into it. */
const playerIds = () => game.actors.filter((a) => a.type === "Player" && a.hasPlayerOwner).map((a) => a.id);

/**
 * Make the Enhancer's party an Extras party (GM): an NPC flagged `isParty`, which is Extras' own definition
 * of one (its Developer API). Extras then gives it its Party sheet, members and light tracker where the
 * plain actor got the NPC sheet and was never listed. Members it already has are kept; with none, the
 * player characters, so the same people travel as before. Once, and only ever the Enhancer's own party.
 * @param {Actor|null} actor
 */
export async function joinExtras(actor) {
  if (!actor?.getFlag(MODULE_ID, PARTY_FLAG) || actor.getFlag(EXTRAS_ID, "isParty") === true || !joinsExtras(actor)) return;
  if (!actor.getFlag(EXTRAS_ID, "members")?.length) await actor.setFlag(EXTRAS_ID, "members", playerIds());
  await actor.setFlag(EXTRAS_ID, "isParty", true);
}

/** The Enhancer's party actor, made on first use (GM); with Extras there, an Extras party. */
export async function partyActor() {
  const found = game.actors.find((a) => a.getFlag(MODULE_ID, PARTY_FLAG));
  if (found) { await joinExtras(found); return found; }
  const name = game.i18n.localize("SDE.overland.party.name");
  return Actor.create({
    name, type: "NPC", img: PARTY_TOKEN_IMG,
    prototypeToken: { name, actorLink: true, disposition: CONST.TOKEN_DISPOSITIONS.FRIENDLY, ...PARTY_TOKEN_STYLE },
    flags: {
      [MODULE_ID]: { [PARTY_FLAG]: true },
      // Flagged at creation, so Extras' own creation hooks set its sheet and its token.
      ...(joinsExtras(null) ? { [EXTRAS_ID]: { isParty: true, members: playerIds() } } : {}),
    },
  });
}

/**
 * Put the party on the map (GM): its token in the hex at the centre of the
 * view, on Start travel with no party token on the scene. `actor` is the
 * Extras party when there is one; else the module's own Party.
 * @param {Actor|null} [actor]
 * @returns {Promise<TokenDocument|null>}
 */
export async function placePartyToken(actor = null, scene = globalThis.canvas?.scene) {
  if (!game.user?.isGM || !scene || scene !== canvas.scene) return null;
  actor ??= await partyActor();
  if (!actor) return null;
  const { x, y } = canvas.grid.getTopLeftPoint(canvas.grid.getOffset(canvas.stage.pivot));
  // Linked on the token itself: the system makes a new NPC's prototype unlinked.
  const doc = await actor.getTokenDocument({ x, y, actorLink: true });
  const [token] = await scene.createEmbeddedDocuments("Token", [doc.toObject()]);
  return token ?? null;
}

/**
 * Make a party token the party's hex on a hex map (GM): its scene token only,
 * so the actor keeps its portrait everywhere else. Once: a token already
 * wearing the hex is left alone. A larger token shrinks onto the hex under
 * its old centre, the hex travel starts from.
 * @param {TokenDocument} token
 */
export async function wearPartyHex(token) {
  if (!game.user?.isGM || !token || !isHexRulesScene(token.parent)) return;
  if (token.texture?.src === PARTY_TOKEN_IMG) return;
  const grid = token.parent.grid;
  const { x, y } = grid.getTopLeftPoint(grid.getOffset(token.getCenterPoint()));
  await token.update({ ...PARTY_TOKEN_STYLE, x, y });
}
