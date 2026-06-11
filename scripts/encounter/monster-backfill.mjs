/**
 * Shadowdark Enhancer — Monster Backfill
 *
 * GM-run, idempotent, non-destructive migration that upgrades NPC actors imported
 * BEFORE the fidelity fixes (icons, Title-Cased attack names, functional Spell
 * items, auto-resolved art, full stat-block Description, HTML-wrapped item
 * descriptions) to the same end state a fresh import now produces.
 *
 * Reuses the existing round-trip pipeline in IMPORT ORDER:
 *   actorToDraft → resolveSpellFeatures → resolveDraftArt → draftToActorData
 *
 * Never calls deleteCompendium. GM-only. Dry-run preview before commit.
 *
 * NOTE: The Foundry-bound pipeline imports (encounter-creator, monster-importer,
 * monster-pack, monster-linker) are loaded lazily via dynamic import() so that
 * the pure detectChanges helper can be imported in Foundry-free node:test suites.
 */

/** Item types the backfill rebuilds (matches what a fresh import creates). */
const BACKFILL_ITEM_TYPES = new Set(["NPC Attack", "NPC Special Attack", "NPC Feature", "Spell"]);

/** Placeholder art paths that signal "no real art assigned yet". */
const PLACEHOLDER_ART = new Set([
  "icons/svg/mystery-man.svg",
  "icons/svg/mystery-man-black.svg",
  "",
]);

function _isPlaceholder(src) {
  return !src || PLACEHOLDER_ART.has(src);
}

/** True if a string appears to be already HTML-wrapped (starts with a tag). */
function _isHtml(s) {
  return typeof s === "string" && s.trimStart().startsWith("<");
}

/** Regex matching "(XXX Spell)" or "(XXX Spells)" NPC Feature names (mirrors monster-importer.mjs). */
const SPELL_TAG = /\((?:int|wis|cha)\s+spell[s]?\)/i;

// ─── Pure change-detection helper ──────────────────────────────────────────
//
// No Foundry globals; importable in node:test without Foundry running.
// actor-like object: { name, img, prototypeToken, items[] }
// Each item: { type, name, img, system: { description } }
// builtActorData: { img, prototypeToken: { texture: { src } }, ... }
// builtItems: array of create-data objects (same shape as draftToActorData returns)

/**
 * Compare CURRENT actor state to the freshly-built target and return a tally
 * of what would change. Pure — no side effects, no Foundry globals.
 *
 * @param {object} actor          - Actor-like: { name, img, prototypeToken, items }
 * @param {object} builtActorData - Output of draftToActorData().actorData
 * @param {object[]} builtItems   - Output of draftToActorData().items
 * @returns {{ changed: boolean, tally: object }}
 */
export function detectChanges(actor, builtActorData, builtItems) {
  const tally = {
    descriptionsWrapped: 0,
    namesCased: 0,
    iconsSet: 0,
    spellsConverted: 0,
    artAssigned: 0,
  };

  // ── Art ────────────────────────────────────────────────────────────────────
  const builtImg = builtActorData?.img || "";
  const builtToken = builtActorData?.prototypeToken?.texture?.src || "";
  const curImg = actor?.img || "";
  const curToken = actor?.prototypeToken?.texture?.src || "";

  if (_isPlaceholder(curImg) && !_isPlaceholder(builtImg)) tally.artAssigned++;
  if (_isPlaceholder(curToken) && !_isPlaceholder(builtToken)) tally.artAssigned++;

  // ── Items ──────────────────────────────────────────────────────────────────
  // Support both plain array and Foundry Collection (has .contents).
  const currentItems = Array.isArray(actor?.items)
    ? actor.items
    : (actor?.items?.contents ? [...actor.items.contents] : []);

  // Spell conversion: count current NPC Feature items still tagged as (XXX Spell)
  // that have no matching Spell item on the actor yet.
  const hasSpellItem = new Set(
    currentItems.filter((i) => i.type === "Spell").map((i) => i.name?.toLowerCase())
  );
  for (const item of currentItems) {
    if (item.type === "NPC Feature" && SPELL_TAG.test(item.name || "")) {
      const spellName = String(item.name)
        .replace(/\s*\((?:int|wis|cha)\s+spell[s]?\)\s*/i, "")
        .trim()
        .toLowerCase();
      if (!hasSpellItem.has(spellName)) tally.spellsConverted++;
    }
  }

  // Build a lookup of rebuilt items by type+name for comparison.
  const builtByTypeAndName = new Map();
  for (const bi of (builtItems ?? [])) {
    const key = `${bi.type}||${(bi.name || "").toLowerCase()}`;
    builtByTypeAndName.set(key, bi);
  }

  for (const item of currentItems) {
    if (!BACKFILL_ITEM_TYPES.has(item.type)) continue;

    const key = `${item.type}||${(item.name || "").toLowerCase()}`;
    const built = builtByTypeAndName.get(key);

    // Description wrap check (NPC Feature + NPC Special Attack; NPC Attack rider stays plain)
    if (item.type !== "NPC Attack" && built) {
      const curDesc = item.system?.description || "";
      const builtDesc = built.system?.description || "";
      if (!_isHtml(curDesc) && _isHtml(builtDesc)) tally.descriptionsWrapped++;
    }

    // Name casing check (attack items)
    if ((item.type === "NPC Attack" || item.type === "NPC Special Attack") && built) {
      if (built.name && item.name !== built.name) tally.namesCased++;
    }

    // Icon check
    if (built?.img && (!item.img || _isPlaceholder(item.img)) && !_isPlaceholder(built.img)) {
      tally.iconsSet++;
    }
  }

  const changed = Object.values(tally).some((v) => v > 0);
  return { changed, tally };
}

// ─── backfillActor ─────────────────────────────────────────────────────────

/**
 * Upgrade one NPC actor to fresh-import fidelity using the existing round-trip
 * pipeline. Non-destructive: only writes what the pipeline says changed.
 * Idempotent: a second pass on an already-upgraded actor returns changed:false.
 *
 * @param {Actor} actor
 * @param {{ dryRun?: boolean }} [opts]
 * @returns {Promise<{actor:string, uuid:string, changed:boolean, tally:object, dryRun:boolean}|null>}
 */
export async function backfillActor(actor, { dryRun = false } = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a GM can run the monster backfill.");
    return null;
  }

  // ── Round-trip pipeline (SAME order as createMonster) ──────────────────────
  // Dynamic imports keep the Foundry-bound modules from loading at parse time,
  // which lets detectChanges be imported pure by node:test suites.
  const { actorToDraft, draftToActorData } = await import("./encounter-creator.mjs");
  const { resolveSpellFeatures, resolveDraftArt } = await import("./monster-importer.mjs");

  const draft = await actorToDraft(actor);          // async; strips HTML → plain draft
  await resolveSpellFeatures(draft);                // (XXX Spell) features → draft.spells
  await resolveDraftArt(draft);                     // fill placeholder img/tokenSrc
  const { actorData, items } = draftToActorData(draft); // pure choke point (D5)

  // ── Detect what changed ────────────────────────────────────────────────────
  const { changed, tally } = detectChanges(actor, actorData, items);

  if (dryRun || !changed) {
    return { actor: actor.name, uuid: actor.uuid, changed, tally, dryRun };
  }

  // ── Apply actor-level fields ───────────────────────────────────────────────
  // Build a targeted update that touches ONLY the keys actorData owns.
  // GM-owned fields (folder, ownership, flags, sort, etc.) are untouched.
  const actorUpdate = {};
  if (!_isPlaceholder(actorData.img)) actorUpdate.img = actorData.img;
  if (!_isPlaceholder(actorData.prototypeToken?.texture?.src)) {
    actorUpdate["prototypeToken.texture.src"] = actorData.prototypeToken.texture.src;
  }
  if (actorData.system?.notes !== undefined) actorUpdate["system.notes"] = actorData.system.notes;

  if (Object.keys(actorUpdate).length > 0) {
    await actor.update(actorUpdate);
  }

  // ── Apply embedded items ───────────────────────────────────────────────────
  // Current items in the backfill scope.
  const currentItems = [...actor.items].filter((i) => BACKFILL_ITEM_TYPES.has(i.type));

  // Build a map of built items by type+name.
  const builtByTypeAndName = new Map();
  for (const bi of items) {
    const key = `${bi.type}||${(bi.name || "").toLowerCase()}`;
    builtByTypeAndName.set(key, bi);
  }

  const descUpdates = [];   // [{_id, "system.description": ...}]
  const idsToDelete = [];   // item ids to delete before recreate
  const toCreate = [];      // item create-data (no _id)

  // IDs of current (XXX Spell) NPC Features that will be superseded by real Spell items.
  const spellFeatureIds = new Set(
    currentItems
      .filter((i) => i.type === "NPC Feature" && SPELL_TAG.test(i.name || ""))
      .map((i) => i.id)
  );

  for (const item of currentItems) {
    const key = `${item.type}||${(item.name || "").toLowerCase()}`;
    const built = builtByTypeAndName.get(key);

    if (!built) {
      // No matching built item — if it's a (XXX Spell) feature, schedule for deletion
      // (the real Spell item will be created below from toCreate).
      // Otherwise leave it alone (non-destructive).
      if (spellFeatureIds.has(item.id)) idsToDelete.push(item.id);
      continue;
    }

    const curDesc = item.system?.description || "";
    const builtDesc = built.system?.description || "";
    const descDiffers = curDesc !== builtDesc && !_isHtml(curDesc) && _isHtml(builtDesc);
    const nameDiffers = item.name !== built.name;
    const iconDiffers = (!item.img || _isPlaceholder(item.img)) && built.img && !_isPlaceholder(built.img);

    if (descDiffers && !nameDiffers && !iconDiffers) {
      // Description-only fix → safe in-place update (proven non-destructive pattern).
      descUpdates.push({ _id: item.id, "system.description": builtDesc });
    } else if (nameDiffers || iconDiffers || descDiffers) {
      // Structural change → delete + recreate.
      idsToDelete.push(item.id);
    }
    // No change → leave alone.
  }

  // Add new items from the built set that don't have a surviving current counterpart.
  const survivingKeys = new Set(
    currentItems
      .filter((i) => !idsToDelete.includes(i.id))
      .map((i) => `${i.type}||${(i.name || "").toLowerCase()}`)
  );

  for (const bi of items) {
    const key = `${bi.type}||${(bi.name || "").toLowerCase()}`;
    // A built item is "new" if it wasn't already covered by an in-place desc update
    // and either has no surviving current counterpart or was scheduled for deletion.
    const coveredByDescUpdate = descUpdates.some((u) => {
      const cur = currentItems.find((ci) => ci.id === u._id);
      return cur && `${cur.type}||${(cur.name || "").toLowerCase()}` === key;
    });
    if (!coveredByDescUpdate && !survivingKeys.has(key)) {
      const src = { ...bi };
      delete src._id;
      toCreate.push(src);
    }
  }

  // Apply in order: in-place desc updates first, then delete+recreate.
  if (descUpdates.length > 0) {
    await actor.updateEmbeddedDocuments("Item", descUpdates);
  }
  if (idsToDelete.length > 0) {
    await actor.deleteEmbeddedDocuments("Item", idsToDelete);
  }
  if (toCreate.length > 0) {
    await actor.createEmbeddedDocuments("Item", toCreate);
  }

  return { actor: actor.name, uuid: actor.uuid, changed: true, tally, dryRun: false };
}

// ─── backfillTargets batch ─────────────────────────────────────────────────

/**
 * Run backfillActor over a GM-chosen scope. Never sweeps the whole world.
 *
 * @param {{
 *   scope: "pack"|"folder"|"selection",
 *   packCollection?: CompendiumCollection,
 *   folderId?: string,
 *   actorUuids?: string[],
 *   dryRun?: boolean
 * }} [opts]
 * @returns {Promise<{dryRun:boolean, total:number, changed:object[], unchanged:object[], totals:object}|null>}
 */
export async function backfillTargets({
  scope,
  packCollection,
  folderId,
  actorUuids,
  dryRun = false,
} = {}) {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a GM can run the monster backfill.");
    return null;
  }

  const { findMonsterPack } = await import("./monster-pack.mjs");

  let actors = [];

  if (scope === "pack") {
    const pack = packCollection ?? findMonsterPack();
    if (!pack) {
      ui.notifications?.warn("No imported-monsters compendium found. Import some monsters first.");
      return { dryRun, total: 0, changed: [], unchanged: [], totals: _zeroTotals() };
    }
    const docs = await pack.getDocuments();
    actors = docs.filter((d) => d.type === "NPC");
  } else if (scope === "folder") {
    if (!folderId) {
      ui.notifications?.warn("backfillTargets: scope 'folder' requires a folderId.");
      return { dryRun, total: 0, changed: [], unchanged: [], totals: _zeroTotals() };
    }
    actors = game.actors.filter(
      (a) => a.type === "NPC" && (a.folder?.id === folderId || a.folderId === folderId)
    );
  } else if (scope === "selection") {
    if (!Array.isArray(actorUuids) || actorUuids.length === 0) {
      ui.notifications?.warn("backfillTargets: scope 'selection' requires actorUuids[].");
      return { dryRun, total: 0, changed: [], unchanged: [], totals: _zeroTotals() };
    }
    const resolved = await Promise.all(actorUuids.map((u) => fromUuid(u).catch(() => null)));
    actors = resolved.filter((a) => a && a.type === "NPC");
  } else {
    ui.notifications?.warn(`backfillTargets: unknown scope "${scope}". Use "pack", "folder", or "selection".`);
    return { dryRun, total: 0, changed: [], unchanged: [], totals: _zeroTotals() };
  }

  if (actors.length === 0) {
    return { dryRun, total: 0, changed: [], unchanged: [], totals: _zeroTotals() };
  }

  const changed = [];
  const unchanged = [];
  const totals = _zeroTotals();

  for (const actor of actors) {
    const result = await backfillActor(actor, { dryRun });
    if (!result) continue;
    if (result.changed) {
      changed.push(result);
      _sumTotals(totals, result.tally);
    } else {
      unchanged.push({ actor: result.actor, uuid: result.uuid });
    }
  }

  // After a committed batch, invalidate the linker cache once (mirrors createMonsters).
  if (!dryRun && changed.length > 0) {
    const { MonsterLinker } = await import("./monster-linker.mjs");
    MonsterLinker.invalidate();
  }

  return { dryRun, total: actors.length, changed, unchanged, totals };
}

function _zeroTotals() {
  return { descriptionsWrapped: 0, namesCased: 0, iconsSet: 0, spellsConverted: 0, artAssigned: 0 };
}

function _sumTotals(acc, tally) {
  for (const k of Object.keys(acc)) acc[k] += (tally?.[k] ?? 0);
}
