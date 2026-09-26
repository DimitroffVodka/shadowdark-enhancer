/**
 * Shadowdark Enhancer — hex crawl hand-off (Foundry-bound).
 *
 * Turns a committed crawl entry (hex-commit) back into the dataset Shadowdark
 * Extras' hexcrawl builder consumes, then hands it over when Extras exposes
 * the entry point (shadowdark-extras#141) or downloads it as JSON otherwise.
 * Mirrors the renown delegation the other way round: Extras is detected by
 * namespace, never required. Nothing from a book ships with the module; the
 * downloaded file is the GM's own extraction.
 */

import { MODULE_ID } from "../../shared/module-id.mjs";
import { replaceModuleFlag } from "../../shared/module-flags.mjs";
import { HEX_FLAG } from "./hex-commit.mjs";
import { buildHexDataset, ZONE_COLOR } from "./hex-dataset.mjs";

/**
 * Extras' compatible hex API when it mounts the agreed namespace, else null.
 * The raw module.api builder is intentionally not used here until #141 pins the
 * published-number coordinate contract; downloading remains the safe fallback.
 */
export function extrasHexApi() {
  const api = globalThis.game?.shadowdarkExtras?.hex;
  return typeof api?.buildHexcrawl === "function" ? api : null;
}

/**
 * Dataset from one or more crawl entries: their pages are the keyed hexes
 * (name, description with links intact), their flag carries the summary rows
 * (zone, terrain, feature).
 *
 * Takes a LIST because a book imported per region files one entry per region
 * (hex-book-import.mjs) and the map they describe is one map — the hand-off has
 * to see all of them or Extras gets a crawl with one region's hexes on it.
 * Hexes are keyed by published number inside buildHexDataset, so entries never
 * collide; the dataset is named after the book once there is more than one.
 * @param {JournalEntry[]|JournalEntry} entries
 * @returns {object} dataset (hex-dataset.mjs)
 */
export function datasetFromEntries(entries, { tags = {}, gridHint, assignments, zones } = {}) {
  const list = (Array.isArray(entries) ? entries : [entries]).filter(Boolean);
  const drafts = [], summaryRows = [];
  let name = "", source = "";
  for (const entry of list) {
    const flag = entry.getFlag?.(MODULE_ID, HEX_FLAG) ?? {};
    source ||= flag.source ?? "";
    name ||= flag.crawl ?? entry.name ?? "";
    summaryRows.push(...(flag.keyed ?? []));
    for (const p of entry.pages?.contents ?? []) {
      const f = p.getFlag?.(MODULE_ID, HEX_FLAG);
      if (!f?.key) continue;
      drafts.push({ hexId: f.num, key: f.key, name: String(p.name ?? "").replace(/^\d{3,4}\s*/, ""), html: p.text?.content ?? "" });
    }
  }
  if (list.length > 1 && source) name = source;
  return buildHexDataset({ name, source, drafts, summaryRows, tags, assignments, zones, gridHint });
}

/** One entry's dataset. The tagger's own art manifest rides along (it always
 *  passed `assignments`; this function used to drop it on the floor). */
export const datasetFromEntry = (entry, opts) => datasetFromEntries([entry], opts);

const slug = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "hexcrawl";

function downloadDataset(dataset) {
  const save = globalThis.foundry?.utils?.saveDataToFile ?? globalThis.saveDataToFile;
  if (typeof save !== "function") {
    globalThis.ui?.notifications?.error("saveDataToFile unavailable — cannot download the hex dataset.");
    return { via: "none" };
  }
  const filename = `${slug(dataset.name)}-hexcrawl.json`;
  save(JSON.stringify(dataset, null, 2), "text/json", filename);
  return { via: "download", filename };
}

/**
 * The dataset fields Extras' upsertHexRecords accepts on an EXISTING scene.
 *
 * A whitelist, not a blacklist of `art`/`icon`. Extras validates record keys
 * fail-closed — an unsupported field throws `unsupported hex field <key>` and
 * takes the whole batch with it, not just that hex — so a field added to the
 * dataset later must not silently start breaking the import. `art` and `icon`
 * are build-only there by design: they say how a hex is PAINTED, and painting
 * is the builder's job.
 */
const UPSERT_FIELDS = ["name", "terrain", "desc", "zone", "zoneColor"];

/**
 * importDetails' dataset from crawl entries: their keyed pages, plus a zone
 * and colour for every hex when a region scan can be found (scanSceneFor).
 * @param {JournalEntry[]|JournalEntry} entries  may be empty: zones alone
 * @param {string|object} scene  the scan scene, or the Extras scene being updated
 */
export async function detailsDataset(entries, scene) {
  const { sceneZones, scanSceneFor } = await import("../../hex-map/hex-region.mjs");
  const { byNum } = await sceneZones(scanSceneFor(scene));
  return datasetFromEntries(entries, { zones: byNum });
}

/**
 * Push a dataset's per-hex details onto a hexcrawl scene Extras ALREADY built,
 * without rebuilding it.
 *
 * `handoffDataset` below is the other half: it calls buildHexcrawl, which makes
 * a whole new scene and (with overwrite) deletes the old one, taking its
 * tokens, pins and fog progress with it. That is right for a first import and
 * wrong for a correction, which is what this is for — retag a few cells in the
 * tagger, then write the words onto the live map.
 *
 * Tile art follows too, when Extras is new enough to expose repaintHexTiles and
 * the caller asks for it. Words are written first: if the repaint then fails,
 * the GM is left with correct text over stale art, which is recoverable, rather
 * than new art over stale text, which reads as correct and is not.
 *
 * @param {string} sceneId  an Extras hexcrawl scene (built by buildHexcrawl or adopted)
 * @param {object} dataset  from buildHexDataset / datasetFromEntries
 * @param {{repaint?:boolean, features?:boolean, quiet?:boolean}} [opts]  repaint defaults to true.
 *   features sends the settlement entries too; Extras REPLACES a record's whole
 *   features list, discovery flags included, so only a hand-off that has not yet
 *   delivered them asks for it (handoffToPrint).
 *   quiet leaves the success toast to the caller.
 * @returns {Promise<{via:"extras", summary:object}|{via:"none", reason:string}>}
 */
export async function importDatasetRecords(sceneId, dataset, opts = {}) {
  if (!globalThis.game?.user?.isGM) {
    globalThis.ui?.notifications?.warn("Only a GM can import hex details.");
    return { via: "none", reason: "not-gm" };
  }
  const api = extrasHexApi();
  if (typeof api?.upsertHexRecords !== "function") {
    globalThis.ui?.notifications?.warn("Shadowdark Extras is not available, or is too old to update hex details.");
    return { via: "none", reason: "no-extras" };
  }
  if (!sceneId) {
    globalThis.ui?.notifications?.warn("Pick the hexcrawl scene to update first.");
    return { via: "none", reason: "no-scene" };
  }

  const records = [];
  for (const hex of dataset?.hexes ?? []) {
    const record = { num: hex.num };
    for (const key of UPSERT_FIELDS) {
      if (typeof hex[key] !== "string" || !hex[key]) continue;
      // One unparseable colour fails the whole batch there; drop just that one.
      if (key === "zoneColor" && !ZONE_COLOR.test(hex[key])) continue;
      record[key] = hex[key];
    }
    if (opts.features && Array.isArray(hex.features) && hex.features.length) record.features = hex.features;
    // num alone would be a no-op write; skip it rather than send it.
    if (Object.keys(record).length > 1) records.push(record);
  }
  if (!records.length) {
    globalThis.ui?.notifications?.warn("This dataset carries no hex details to import.");
    return { via: "none", reason: "empty" };
  }

  let summary;
  try {
    summary = await api.upsertHexRecords(sceneId, records);
  } catch (err) {
    console.error(`${MODULE_ID} | hex detail import failed`, err);
    globalThis.ui?.notifications?.error(`Shadowdark Extras refused the hex details: ${err.message}`);
    return { via: "none", reason: "extras-error" };
  }

  // Repaint only the hexes whose terrain we actually asserted. A hex with a
  // name but no terrain word has nothing to repaint FROM, and Extras refuses a
  // repaint without one rather than guessing — which is the behaviour we want,
  // so do not send those.
  const repaintable = [];
  for (const hex of dataset?.hexes ?? []) {
    if (typeof hex.terrain !== "string" || !hex.terrain) continue;
    const entry = { num: hex.num, terrain: hex.terrain };
    if (typeof hex.art === "string" && hex.art) entry.art = hex.art;
    repaintable.push(entry);
  }

  let repaint = null;
  if (opts.repaint !== false && repaintable.length) {
    if (typeof api.repaintHexTiles !== "function") {
      globalThis.ui?.notifications?.warn(`Updated ${records.length} hex${records.length === 1 ? "" : "es"}. Shadowdark Extras is too old to repaint the tiles, so the art still shows the old terrain.`);
      return { via: "extras", summary, repaint: null, reason: "no-repaint" };
    }
    try {
      repaint = await api.repaintHexTiles(sceneId, repaintable);
    } catch (err) {
      console.error(`${MODULE_ID} | hex tile repaint failed`, err);
      globalThis.ui?.notifications?.error(`Hex details were saved, but the tiles could not be repainted: ${err.message}`);
      return { via: "extras", summary, repaint: null, reason: "repaint-error" };
    }
  }

  const painted = repaint ? `, repainted ${repaint.repainted}` : "";
  if (!opts.quiet) globalThis.ui?.notifications?.info(`Updated ${records.length} hex${records.length === 1 ? "" : "es"}${painted}.`);
  return { via: "extras", summary, repaint };
}

/**
 * Scene flag on a print: its settlements have reached Extras in a record write
 * that succeeded. Kept apart from Extras' own layout flag, because adoption and
 * the record write are two calls and the first can land while the second fails.
 */
export const SETTLEMENTS_SENT_FLAG = "extrasSettlementsSent";

/**
 * Put a dataset's hex details on the print the GM tagged, instead of building
 * a new scene: Extras adopts the scene (adoptHexcrawl, shadowdark-extras#147),
 * then every hex's record is written onto it. Nothing is painted, so the
 * publisher's art, the pins and the notes stay as they are. Running it again
 * updates the records in place.
 *
 * The caller has already checked the numbering (extrasNumbersAlike): Extras
 * can only tell whether each published cell lands on the scene, not whether it
 * lands on the right one. Reporting the adoption is the caller's job too, so
 * this returns why it stopped; the record write reports its own failures.
 *
 * @param {string} sceneId  the tagged print
 * @param {object} dataset  from buildHexDataset / datasetFromEntries
 * @returns {Promise<{via:"extras", adopted:boolean, summary:object}
 *   |{via:"none", reason:"not-gm"|"no-extras"|"no-adopt"|"extras-error"|string, error?:string}>}
 */
export async function handoffToPrint(sceneId, dataset) {
  if (!globalThis.game?.user?.isGM) return { via: "none", reason: "not-gm" };
  const api = extrasHexApi();
  if (!api) return { via: "none", reason: "no-extras" };
  if (typeof api.adoptHexcrawl !== "function" || typeof api.upsertHexRecords !== "function") return { via: "none", reason: "no-adopt" };
  let adopted;
  try {
    ({ adopted } = await api.adoptHexcrawl(sceneId, { grid: dataset.grid }));
  } catch (err) {
    console.error(`${MODULE_ID} | adopting the print for Extras failed`, err);
    return { via: "none", reason: "extras-error", error: err.message };
  }
  // Settlements go until a write carrying them has succeeded, then never again:
  // from then on the players' discoveries live in Extras' features, and sending
  // them again would reset those. Not tied to `adopted` alone, which is false on
  // every retry once the layout is in, including after a first record write that
  // failed and delivered nothing. A fresh adoption has fresh records, so it sends.
  const scene = globalThis.game?.scenes?.get?.(sceneId);
  const sent = scene?.getFlag?.(MODULE_ID, SETTLEMENTS_SENT_FLAG) === true;
  const features = adopted || !sent;
  const res = await importDatasetRecords(sceneId, dataset, { repaint: false, features, quiet: true });
  if (res.via !== "extras") return res;
  // Only once some hex carried one: a dataset without the crawl's keyed pages
  // has no settlements yet, and marking it sent would keep them out for good.
  const carried = features && (dataset?.hexes ?? []).some((h) => Array.isArray(h.features) && h.features.length);
  if (carried && !sent && scene) {
    try {
      await replaceModuleFlag(scene, SETTLEMENTS_SENT_FLAG, true);
    } catch (err) {
      // The records are in; a missing mark only means the next send repeats them.
      console.warn(`${MODULE_ID} | could not mark the settlements as sent`, err);
    }
  }
  return { ...res, adopted };
}

/**
 * Hand a dataset to Extras, or download it. The guard lives here as well as in
 * the UI callers because this function is a documented public macro surface.
 * @param {object} dataset
 * @param {{sceneName?:string}} [opts]  builder options passed through (the tagger names the painted
 *   scene after the print scene plus a suffix, so the two are told apart in the sidebar)
 * @returns {Promise<{via:"extras", summary:object}|{via:"download", filename:string, reason?:string}|{via:"none", reason?:string}>}
 */
export async function handoffDataset(dataset, opts = {}) {
  if (!globalThis.game?.user?.isGM) {
    globalThis.ui?.notifications?.warn("Only a GM can hand off hex datasets.");
    return { via: "none", reason: "not-gm" };
  }
  const api = extrasHexApi();
  if (api) {
    try {
      const summary = await api.buildHexcrawl(dataset, opts.sceneName ? { sceneName: opts.sceneName } : undefined);
      return { via: "extras", summary };
    } catch (err) {
      console.error(`${MODULE_ID} | hex dataset hand-off failed`, err);
      globalThis.ui?.notifications?.error("Shadowdark Extras could not build this hex dataset; downloading the JSON instead.");
      const fallback = downloadDataset(dataset);
      return fallback.via === "download" ? { ...fallback, reason: "extras-error" } : fallback;
    }
  }
  return downloadDataset(dataset);
}
