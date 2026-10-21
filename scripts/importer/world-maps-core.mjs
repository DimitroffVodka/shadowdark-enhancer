/**
 * Shadowdark Enhancer — "Maps for this world": which of the books' maps this world has, and the one thing each row does.
 *
 * Pure, no Foundry globals; world-maps-app.mjs draws it and supplies the Foundry parts as `deps`. Every step is work the
 * import wizard already does: Load is the Adventures compendium's own create-only import, Add map file is the wizard's
 * build of a ticked map. This file only lists and dispatches.
 *   deps.importPacked(id)         → {status:"imported"|"already"|"gmOnly"|"missing"}
 *   deps.sceneOf(id)              → the world scene's id for that map, or null
 *   deps.buildHex(id, files)      → {status, sceneId?, pinned?} (buildHexAdventure, world placement)
 *   deps.uploadMap(file)          → served path, or null (it says why)
 *   deps.buildSite(id, path)      → {status, placed, left, known} (buildPlaced, world placement)
 */
import { HEX_MAPS, isHexMap, mapGroups, newState, addFiles, filesOfHex, bookTitle } from "./wizard/wizard-core.mjs";
import { hexPrint } from "../hex-map/hex-prints.mjs";

/**
 * What a map's row offers: "world" it is in this world, "load" it waits in the Adventures compendium, "add" the module
 * has never been given its picture, "book" an adventure map whose book was never imported (its places come from it).
 * @param {string} id
 * @param {{inWorld:Set<string>, packed:Set<string>, filed:Set<string>}} known
 */
export function rowState(id, { inWorld, packed, filed }) {
  if (inWorld.has(id)) return "world";
  if (packed.has(id)) return "load";
  return isHexMap(id) || filed.has(id) ? "add" : "book";
}

/**
 * Every map the supported books contain, grouped by book (Western Reaches first, a book's hex map first), each with its
 * state. `known.unnamed` holds the hex maps in this world whose terrain was never named: their row also gets `terrain`,
 * which is the way back to the quick guide's Terrain page.
 */
export function mapList(known) {
  return mapGroups(newState())
    .filter((g) => g.rows.length)
    .map((g) => ({
      src: g.src, title: g.title,
      rows: g.rows.map((r) => {
        const state = rowState(r.id, known);
        return { id: r.id, title: r.title, hex: isHexMap(r.id), parts: HEX_MAPS.find((h) => h.id === r.id)?.files.length ?? 1, state, terrain: state === "world" && !!known.unnamed?.has(r.id) };
      }),
    }));
}

/**
 * What the template draws of mapList's groups: the row at work, the line each action left (with the scene its View
 * opens), and Add map file switched off when this user may not upload.
 * @param {ReturnType<typeof mapList>} groups
 * @param {{busy:string|null, lines:Record<string,{text:string, sceneId:string|null}>, canUpload:boolean, t:(key:string)=>string}} view
 */
export function mapsView(groups, { busy, lines, canUpload, t }) {
  return groups.map((g) => ({
    ...g,
    rows: g.rows.map((r) => {
      const line = lines[r.id];
      return {
        ...r, [r.state]: true, busy: busy === r.id, locked: !!busy,
        kind: t(r.hex ? "SDE.importer.wizard.ready.maps.hex" : "SDE.importer.wizard.ready.maps.site"),
        line: line?.text || (r.state === "book" ? t("SDE.importer.maps.line.needsBook") : ""),
        viewScene: r.state === "world" ? line?.sceneId ?? null : null,
        noUpload: r.state === "add" && !canUpload,
      };
    }),
  }));
}

/**
 * The picked files of a hex map, in the order its join needs: by their names when the names say which half is which,
 * else in the order picked. Null when the count is wrong (the Black River needs both halves at once).
 */
export function hexFilesFrom(id, files) {
  const hex = HEX_MAPS.find((h) => h.id === id);
  if (!hex || !files.length) return null;
  if (hex.files.length === 1) return [files[0]];   // the GM said which map this is: its name does not have to
  const s = newState();
  addFiles(s, files);
  const named = filesOfHex(s, id);
  if (named.length === hex.files.length) return named;
  // ponytail: two unrecognised names are taken north then south, as picked; a swapped pick joins upside down.
  return files.length === hex.files.length ? [...files] : null;
}

/** The book a hex map's numbered places come from, by its cover name. */
const keyBookOf = (id) => { const src = hexPrint(id)?.keySrc ?? HEX_MAPS.find((h) => h.id === id)?.src; try { return src ? bookTitle(src) : ""; } catch { return ""; } };

/**
 * Load: bring a map out of the Adventures compendium. Lines are language keys with their args.
 * @returns {Promise<{ok:boolean, sceneId?:string|null, line?:{key:string, args?:object}}>}
 */
export async function loadMap(id, deps) {
  const r = await deps.importPacked(id);
  const sceneId = deps.sceneOf(id);
  if (sceneId) return { ok: true, sceneId };
  return { ok: false, line: { key: r?.status === "missing" ? "SDE.importer.maps.line.notPacked" : "SDE.importer.maps.line.loadFailed" } };
}

/**
 * Add map file: build the map from the picture the GM picked, as the wizard's Import does for a ticked map.
 * @param {string} id
 * @param {File[]} files
 * @returns {Promise<{ok:boolean, sceneId?:string, line?:{key:string, args?:object}}>}
 */
export async function addMapFiles(id, files, deps) {
  if (isHexMap(id)) {
    const picked = hexFilesFrom(id, files);
    if (!picked) return { ok: false, line: { key: "SDE.importer.maps.line.bothHalves" } };
    const made = await deps.buildHex(id, picked);
    if (!made?.sceneId) return { ok: false, line: { key: made?.status === "needsLook" ? "SDE.importer.maps.line.needsLook" : "SDE.importer.maps.line.buildFailed" } };
    // Still loaded without its book: the pins come once the book's key locations are imported.
    return { ok: true, sceneId: made.sceneId, line: made.pinned ? null : { key: "SDE.importer.maps.line.noKeys", args: { book: keyBookOf(id) } } };
  }
  const path = await deps.uploadMap(files[0]);
  if (!path) return { ok: false };   // the upload said why
  const built = await deps.buildSite(id, path);
  const sceneId = deps.sceneOf(id);
  if (!sceneId || built?.status === "failed") return { ok: false, line: { key: "SDE.importer.maps.line.buildFailed" } };
  const line = !built.known ? { key: "SDE.importer.wizard.run.pinsByHand" }
    : built.left > 0 ? { key: "SDE.importer.wizard.run.pinsLeft", args: { n: built.left } } : null;
  return { ok: true, sceneId, line };
}
