/**
 * Shadowdark Enhancer — Content Catalog Live Adapter (Phase 25/26)
 *
 * Foundry-bound: resolves the DRAFT content manifests against the live world
 * (system compendia + suite packs) and returns Tables-style reconciled rows
 * (system / imported / missing) for the Monsters / Items / Journal / Scenes
 * catalog dashboards. The pure reconcile/group/summarize lives in
 * content-manifest.mjs; this only gathers the live name Sets.
 */

import {
  MONSTER_MANIFEST, ITEM_MANIFEST, JOURNAL_MANIFEST, SCENE_MANIFEST,
} from "./content-manifest-data.mjs";
import { reconcile, summarize, groupRows, keyIndex, resolveRowValue } from "./content-manifest.mjs";
import { findSuitePack } from "./compendium-suite.mjs";

/** {name, value:uuid} records from a system compendium pack index. */
async function packRecords(packId) {
  const pack = game.packs.get(packId);
  if (!pack) return [];
  const idx = await pack.getIndex();
  return [...idx].map((e) => ({ name: e.name, value: e.uuid }));
}

/** {name, value:uuid} records from a suite pack (resolved by suite key). */
async function suiteRecords(suiteId) {
  const pack = findSuitePack(suiteId);
  if (!pack) return [];
  const idx = await pack.getIndex();
  return [...idx].map((e) => ({ name: e.name, value: e.uuid }));
}

/**
 * Reconcile a manifest, then stamp each system/imported row with the uuid of
 * the live doc it resolved against (so the catalog UI can open it on
 * double-click, like the Tables tab). Reconcile keys are derived from the same
 * indices used to resolve uuids, keeping classification and resolution in
 * lockstep — every non-missing row gets a uuid.
 */
function bundle(manifest, { systemIndex, haveIndex } = {}) {
  const rows = reconcile(manifest, {
    systemKeys: systemIndex ? new Set(systemIndex.keys()) : undefined,
    haveKeys:   haveIndex ? new Set(haveIndex.keys()) : undefined,
  });
  for (const r of rows) {
    const uuid = resolveRowValue(r, { systemIndex, haveIndex });
    if (uuid) r.uuid = uuid;
  }
  return { rows, summary: summarize(rows), groups: groupRows(rows) };
}

/** Monsters: system bestiary wins, sde-actors fills gaps. */
export async function gatherMonsterCatalog() {
  const [system, have] = await Promise.all([
    packRecords("shadowdark.monsters"),
    suiteRecords("sde-actors"),
  ]);
  return bundle(MONSTER_MANIFEST, { systemIndex: keyIndex(system), haveIndex: keyIndex(have) });
}

/** Items: system gear + magic items win, sde-items fills gaps. */
export async function gatherItemCatalog() {
  const [gear, magic, have] = await Promise.all([
    packRecords("shadowdark.gear"),
    packRecords("shadowdark.magic-items"),
    suiteRecords("sde-items"),
  ]);
  return bundle(ITEM_MANIFEST, { systemIndex: keyIndex([...gear, ...magic]), haveIndex: keyIndex(have) });
}

/** Journals: a deployed/world or sde-journal crawl whose name matches → imported.
 *  World entries first so double-click opens the live crawl, not the backup. */
export async function gatherJournalCatalog() {
  const have = [];
  for (const j of game.journal) have.push({ name: j.name, value: j.uuid });
  const pack = findSuitePack("sde-journal");
  if (pack) for (const e of await pack.getIndex()) have.push({ name: e.name, value: e.uuid });
  return bundle(JOURNAL_MANIFEST, { haveIndex: keyIndex(have) });
}

/** Scenes: a built world scene (or sde-scenes backup) whose name matches → built.
 *  World scenes first so double-click opens the live scene, not the backup. */
export async function gatherSceneCatalog() {
  const have = [];
  for (const s of game.scenes) have.push({ name: s.name, value: s.uuid });
  const pack = findSuitePack("sde-scenes");
  if (pack) for (const e of await pack.getIndex()) have.push({ name: e.name, value: e.uuid });
  return bundle(SCENE_MANIFEST, { haveIndex: keyIndex(have) });
}
