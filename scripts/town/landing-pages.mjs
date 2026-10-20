/**
 * Shadowdark Enhancer — Town: making landing pages and moving the table between them (Foundry side, GM only).
 *
 * A landing page lives on a scene of its own, so moving everyone there is Foundry's own scene activation, and the
 * party's tokens stay where they were on the map they left. Going there remembers where the table came from; the
 * page's Return takes everyone back. The pure rules are in landing-pages-core.mjs.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { L as t } from "../shared/i18n.mjs";
import { SIZES } from "../merchant/stock-generator.mjs";
import { TABLE_GAMES } from "./games-core.mjs";
import { landingOf, setShown } from "./town-core.mjs";
import { updateLanding } from "./town-live.mjs";
import { makeMerchant } from "./town-stock.mjs";
import { MADE_KIND, PICTURES, PLAYER_MAP_SETTING, madeLanding, madeSceneData, returnFor, settlementRows } from "./landing-pages-core.mjs";

const FOLDER = "SDE.town.make.folder";

/** The Western Reaches player map's path in this world, or null before the import has made it. */
export function playerMapSrc() {
  try { return game.settings.get(MODULE_ID, PLAYER_MAP_SETTING) || null; } catch { return null; }
}

/** Take everyone to `scene`'s landing page: it goes up, it remembers where the table came from, and the scene is activated. */
export async function goToPage(scene) {
  if (!game.user.isGM || !scene) return null;
  const from = game.scenes.active, back = returnFor(scene, from, landingOf);
  await updateLanding(scene, (page) => ({ ...setShown(page ?? {}, true), returnTo: back }));
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

async function sceneFolder() {
  const name = t(FOLDER);
  return game.folders.find((f) => f.type === "Scene" && f.name === name) ?? Folder.create({ name, type: "Scene" });
}

/**
 * Make a landing page: its scene with `src` as the picture, one merchant rolled for `size`, the page with its tiles
 * and games; then take everyone there. `settlement` is `{ num }` for a Western Reaches place. Returns the scene, or
 * null (with a message) when the picture cannot be read.
 */
export async function makeLandingPage({ name, size, src, games = TABLE_GAMES, settlement = null }) {
  if (!game.user.isGM) return null;
  const tex = await foundry.canvas.loadTexture(src).catch(() => null);
  if (!tex?.width || !tex?.height) { ui.notifications.error(t("SDE.town.make.badPicture")); return null; }
  const folder = await sceneFolder();
  const sizeLabel = t(SIZES.find((z) => z.id === size)?.labelKey ?? "SDE.town.editor.sizeTown");
  const scene = await Scene.create(madeSceneData({
    name, src, width: tex.width, height: tex.height, folder: folder?.id ?? null, settlement,
    landing: madeLanding({ name, size, games, tagline: sizeLabel }),
  }));
  if (!scene) return null;
  // The merchant's folder is named after the scene, so it comes after the scene; a failed one leaves the page without a shop.
  const actor = await makeMerchant({ kind: MADE_KIND, size, sceneName: name });
  if (actor) {
    const role = t("SDE.town.make.merchantRole");
    await updateLanding(scene, () => madeLanding({ name, size, games, tagline: sizeLabel, merchantId: foundry.utils.randomID(), actorId: actor.id, role }));
  }
  ui.notifications.info(t("SDE.town.make.made", { name }));
  return goToPage(scene);
}

/** Every settlement the hex import filed (its crawl entries' keyed rows), from the world's copies and the Journals pack. */
async function keyedRows() {
  const { HEX_FLAG } = await import("../importer/hex/hex-commit.mjs");
  const rows = game.journal.contents.flatMap((j) => j.flags?.[MODULE_ID]?.[HEX_FLAG]?.keyed ?? []);
  const { findSuitePack } = await import("../shared/compendium-suite.mjs");
  const pack = findSuitePack("journal");
  if (pack) {
    const index = await pack.getIndex({ fields: [`flags.${MODULE_ID}.${HEX_FLAG}`] }).catch(() => null);
    for (const entry of index?.contents ?? []) rows.push(...(entry.flags?.[MODULE_ID]?.[HEX_FLAG]?.keyed ?? []));
  }
  return rows;
}

/** The hex import's settlements as the list shows them: `{ num, name, size, sceneId }`. */
export async function settlements() {
  return settlementRows(await keyedRows(), game.scenes.contents);
}

/** Open a settlement's page, making it first (the player map behind it, at the settlement's size) when it has none. */
export async function openSettlement({ num, name, size, sceneId }) {
  const made = sceneId && game.scenes.get(sceneId);
  if (made) return goToPage(made);
  return makeLandingPage({ name, size, src: playerMapSrc() ?? PICTURES[0].src, settlement: { num } });
}
