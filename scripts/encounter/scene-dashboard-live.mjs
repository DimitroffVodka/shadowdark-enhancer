/**
 * Shadowdark Enhancer — Scenes Dashboard Live Adapter (Phase 22)
 *
 * Foundry-bound: lists the world's keyed map scenes (module-flagged, or any
 * scene whose Note pins bind to journal pages) with grid type, pin count,
 * pin-resolution %, and whether an sde-scenes backup exists. Plus per-row
 * backup-by-uuid.
 *
 * Pure helpers `gridLabel` and `sceneMapRow` are node-testable.
 */

import { MODULE_ID } from "../module-id.mjs";
import { findSuitePack } from "./compendium-suite.mjs";

/** Human label for a Foundry grid type (0 gridless, 1 square, 2–5 hex). */
export function gridLabel(type) {
  if (type === 0) return "gridless";
  if (type === 1) return "square";
  if (type >= 2 && type <= 5) return "hex";
  return String(type ?? "?");
}

/**
 * Build a plain status row from already-extracted primitives. Pure.
 * @param {object} p
 */
export function sceneMapRow(p) {
  const bound = p.bound ?? 0;
  const resolved = p.resolved ?? 0;
  return {
    name:        p.name,
    id:          p.id,
    uuid:        p.uuid,
    source:      p.source || "",
    grid:        gridLabel(p.gridType),
    pins:        p.pins ?? 0,
    bound,
    resolved,
    resolvedPct: bound ? Math.round((resolved / bound) * 100) : null,
    allResolved: bound > 0 && resolved === bound,
    backedUp:    !!p.backedUp,
    active:      !!p.active,
  };
}

/**
 * Gather status rows for every keyed map scene in the world.
 * @returns {Promise<Array>}
 */
export async function gatherSceneMaps() {
  const backupPack = findSuitePack("sde-scenes");
  const backupIds = new Set(backupPack ? backupPack.index.map((e) => e._id) : []);

  const rows = [];
  for (const scene of game.scenes) {
    const notes = scene.notes?.contents ?? [];
    const bound = notes.filter((n) => n.entryId || n.pageId);
    const isMap = !!scene.flags?.[MODULE_ID] || bound.length > 0;
    if (!isMap) continue;

    let resolved = 0;
    for (const n of bound) {
      const entry = n.entryId ? game.journal.get(n.entryId) : null;
      const ok = n.pageId ? !!entry?.pages?.get(n.pageId) : !!entry;
      if (ok) resolved++;
    }

    rows.push(sceneMapRow({
      name: scene.name, id: scene.id, uuid: scene.uuid,
      source: scene.flags?.[MODULE_ID]?.source,
      gridType: scene.grid?.type,
      pins: notes.length, bound: bound.length, resolved,
      backedUp: backupIds.has(scene.id), active: scene.active,
    }));
  }

  rows.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return rows;
}

/** Create/refresh an sde-scenes backup of a world scene. GM-gated. */
export async function backupSceneById(uuid) {
  if (!game.user?.isGM) {
    ui.notifications?.warn(`${MODULE_ID} | backupSceneById: GM only`);
    return null;
  }
  const scene = await fromUuid(uuid).catch(() => null);
  if (!scene) { ui.notifications?.warn("Scene not found."); return null; }
  const { backupScene } = await import("./scene-builder.mjs");
  return backupScene(scene, scene.flags?.[MODULE_ID]?.source ?? "");
}
