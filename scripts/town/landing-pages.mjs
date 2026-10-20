/**
 * Shadowdark Enhancer — Town: the one landing page, and moving the table to it and back (Foundry side, GM only).
 *
 * The page lives on a scene of its own, so moving everyone there is Foundry's own scene activation, and the party's
 * tokens stay where they were on the map they left. The toolbar's Landing page button takes everyone there (making
 * the page the first time) and, pressed on the page, back. Going there remembers where the table came from, and the
 * market's size follows the settlement the party stands in. The pure rules are in landing-pages-core.mjs.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { landingOf, setShown } from "./town-core.mjs";
import { updateLanding } from "./town-live.mjs";
import { makeMerchant } from "./town-stock.mjs";
import { TABLE, sizeOfGround } from "./landing-table-core.mjs";
import { MADE_KIND, TABLE_FLAG, madeLanding, madeSceneData, resized, returnFor } from "./landing-pages-core.mjs";

/** The table's scene, or null before it is made. */
export const tableScene = () => game.scenes.find((s) => s.flags?.[MODULE_ID]?.[TABLE_FLAG]) ?? null;

/**
 * The settlement the party stands in: the travel token's hex, read from the hex map's tags (the hex data's own words
 * village, town, city and city_state), or null when the party is in open country or not on a hex map.
 */
export async function sizeHere() {
  try {
    const uuid = game.settings.get(MODULE_ID, "overlandState")?.tokenUuid;
    const token = uuid ? fromUuidSync(uuid) : null, scene = token?.parent;
    if (!scene?.grid?.isHexagonal) return null;
    const size = scene.grid.size;
    const offset = scene.grid.getOffset({ x: token.x + (token.width * size) / 2, y: token.y + (token.height * size) / 2 });
    const { hexNumberAt } = await import("../hex-map/hex-number-api.mjs");
    const { decodeTags } = await import("../hex-map/tag-store.mjs");
    const num = hexNumberAt(offset, scene);
    return num === null ? null : sizeOfGround(decodeTags(scene.getFlag(MODULE_ID, "hexTags")).cells.get(String(num))?.terrain);
  } catch (err) {
    console.warn("Shadowdark Enhancer | landing page: no settlement read", err);
    return null;
  }
}

/** Where the party stands, as the table reads it (tests replace it). */
export const tableIo = { sizeHere };

/** The settlement's size on the page: the market's goods are rolled again for it (landing-pages-core resized). */
export function resize(scene, size) {
  if (!game.user.isGM || !scene) return null;
  return updateLanding(scene, (page) => page && resized(page, size));
}

/** Make the table: its scene, its merchant rolled for `size`, its page. Returns the scene, or null when it could not be made. */
export async function makeTable(size = "town") {
  if (!game.user.isGM) return null;
  const name = t("SDE.town.table.name");
  const scene = await Scene.create(madeSceneData({ name, src: TABLE.src, width: TABLE.width, height: TABLE.height, landing: madeLanding({ name, size }) }));
  if (!scene) return null;
  const actor = await makeMerchant({ kind: MADE_KIND, size, sceneName: name });
  if (actor) await updateLanding(scene, () => madeLanding({ name, size, merchantId: foundry.utils.randomID(), actorId: actor.id, role: t("SDE.town.make.merchantRole") }));
  return scene;
}

/**
 * Take everyone to `scene`'s page: it goes up, it remembers where the table came from, its market follows the
 * settlement the party is in (when the hex data says), and the scene is activated.
 */
export async function goToPage(scene) {
  if (!game.user.isGM || !scene) return null;
  const from = game.scenes.active, back = returnFor(scene, from, landingOf);
  const here = from?.id === scene.id ? null : await tableIo.sizeHere();
  await updateLanding(scene, (page) => {
    const up = { ...setShown(page ?? {}, true), returnTo: back };
    return here ? resized(up, here) : up;
  });
  if (!scene.active) await scene.activate();
  return scene;
}

/** Take everyone back from `scene`'s page to the scene they came from. */
export async function returnFromPage(scene) {
  if (!game.user.isGM) return null;
  const to = game.scenes.get(landingOf(scene)?.returnTo ?? "");
  if (!to) { ui.notifications.warn(t("SDE.town.make.noReturn")); return null; }
  return to.activate();
}

/** The toolbar's button: on the table, everyone goes back; anywhere else, everyone comes to the table (made the first time). */
export async function toggleTable() {
  if (!game.user.isGM) return null;
  const table = tableScene();
  if (table && game.scenes.active?.id === table.id) return returnFromPage(table);
  const scene = table ?? await makeTable((await tableIo.sizeHere()) ?? "town");
  return scene ? goToPage(scene) : null;
}
