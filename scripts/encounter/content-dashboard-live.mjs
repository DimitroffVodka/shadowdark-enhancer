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
import { reconcile, summarize, groupRows, keySet } from "./content-manifest.mjs";
import { findSuitePack } from "./compendium-suite.mjs";

async function packKeys(packId) {
  const pack = game.packs.get(packId);
  if (!pack) return new Set();
  const idx = await pack.getIndex();
  return keySet([...idx].map((e) => e.name));
}

async function suiteKeys(suiteId) {
  const pack = findSuitePack(suiteId);
  if (!pack) return new Set();
  const idx = await pack.getIndex();
  return keySet([...idx].map((e) => e.name));
}

function bundle(manifest, sets) {
  const rows = reconcile(manifest, sets);
  return { rows, summary: summarize(rows), groups: groupRows(rows) };
}

/** Monsters: system bestiary wins, sde-actors fills gaps. */
export async function gatherMonsterCatalog() {
  const [systemKeys, haveKeys] = await Promise.all([
    packKeys("shadowdark.monsters"),
    suiteKeys("sde-actors"),
  ]);
  return bundle(MONSTER_MANIFEST, { systemKeys, haveKeys });
}

/** Items: system gear + magic items win, sde-items fills gaps. */
export async function gatherItemCatalog() {
  const [gear, magic, haveKeys] = await Promise.all([
    packKeys("shadowdark.gear"),
    packKeys("shadowdark.magic-items"),
    suiteKeys("sde-items"),
  ]);
  const systemKeys = new Set([...gear, ...magic]);
  return bundle(ITEM_MANIFEST, { systemKeys, haveKeys });
}

/** Journals: a deployed/world or sde-journal crawl whose name matches → imported. */
export async function gatherJournalCatalog() {
  const haveNames = [];
  const pack = findSuitePack("sde-journal");
  if (pack) for (const e of await pack.getIndex()) haveNames.push(e.name);
  for (const j of game.journal) haveNames.push(j.name);
  return bundle(JOURNAL_MANIFEST, { haveKeys: keySet(haveNames) });
}

/** Scenes: a built world scene (or sde-scenes backup) whose name matches → built. */
export async function gatherSceneCatalog() {
  const haveNames = [];
  for (const s of game.scenes) haveNames.push(s.name);
  const pack = findSuitePack("sde-scenes");
  if (pack) for (const e of await pack.getIndex()) haveNames.push(e.name);
  return bundle(SCENE_MANIFEST, { haveKeys: keySet(haveNames) });
}
