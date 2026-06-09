/**
 * Shadowdark Enhancer — Monster importer pipeline (Foundry-bound).
 *
 * Takes parser drafts (statblock-parser.mjs) and creates Shadowdark NPC actors
 * in a managed WORLD Actor compendium (`Shadowdark Enhancer — Imported
 * Monsters`), foldered by source, deduped by name. Reuses the Monster Creator's
 * `draftToActorData()` verbatim — the actual NPC-schema mapping lives there.
 *
 * GM-only. Ships ZERO book content — the GM provides the statblock text; these
 * actors live only in the GM's local world compendium.
 */
import { MODULE_ID } from "../module-id.mjs";
import { draftToActorData } from "./encounter-creator.mjs";
import { MonsterLinker } from "./monster-linker.mjs";
import { MONSTER_PACK_LABEL, findMonsterPack } from "./monster-pack.mjs";

const PACK_LABEL = MONSTER_PACK_LABEL;

/** Find-or-create the managed world Actor compendium; unlock if locked. (Mirrors ensureLootPack.) */
export async function ensureMonsterPack() {
  let pack = findMonsterPack();
  if (!pack) {
    pack = await CompendiumCollection.createCompendium({ label: PACK_LABEL, type: "Actor", packageType: "world" });
    try { await pack.setFlag(MODULE_ID, "monsterPack", true); } catch (_) {}
  }
  if (pack.locked) { try { await pack.configure({ locked: false }); } catch (_) {} }
  return pack;
}

/** Find-or-create a compendium folder for a source label; returns its id, or null. */
export async function ensureSourceFolder(pack, source) {
  const name = String(source ?? "").trim();
  if (!name) return null;
  try {
    const existing = pack.folders?.find?.((f) => f.name === name);
    if (existing) return existing.id;
    const folder = await Folder.create({ name, type: "Actor" }, { pack: pack.collection });
    return folder?.id ?? null;
  } catch (err) {
    console.warn(`${MODULE_ID} | compendium folder create failed (${name}); filing flat:`, err);
    return null;
  }
}

/** A pack-index-unique name (`Base (2)`, `Base (3)`, …). */
function _uniqueName(index, base) {
  const taken = new Set([...index].map((e) => (e.name ?? "").toLowerCase()));
  let n = 2, cand = `${base} (${n})`;
  while (taken.has(cand.toLowerCase())) { n++; cand = `${base} (${n})`; }
  return cand;
}

/**
 * Create one draft into the pack. Conflicts are checked against the PACK INDEX
 * (not game.actors). `onConflict(name) → "skip" | "replace" | "rename"` (default
 * "rename"). Replace deletes the existing compendium document by id, then creates.
 * @returns {Promise<{uuid?:string, name:string, status:"created"|"skipped"|"replaced"}|null>}
 */
export async function createMonster(draft, { pack, folder = null, source = "", onConflict } = {}) {
  if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can import monsters."); return null; }
  if (!pack) pack = await ensureMonsterPack();

  const { actorData, items } = draftToActorData(draft);
  const index = await pack.getIndex();
  const existing = [...index].find((e) => (e.name ?? "").toLowerCase() === actorData.name.toLowerCase());

  let status = "created";
  if (existing) {
    const choice = onConflict ? await onConflict(actorData.name) : "rename";
    if (choice === "skip") return { name: actorData.name, status: "skipped" };
    if (choice === "replace") {
      const old = await pack.getDocument(existing._id).catch(() => null);
      if (old) await old.delete();
      status = "replaced";
    } else {
      actorData.name = _uniqueName(index, actorData.name);
    }
  }

  // Fold the embedded items into the create payload (the compendium-create path,
  // not a post-create createEmbeddedDocuments call); stamp the source flag.
  const payload = {
    ...actorData,
    items,
    folder: folder ?? null,
    flags: { ...(actorData.flags ?? {}), [MODULE_ID]: { ...(actorData.flags?.[MODULE_ID] ?? {}), source } },
  };
  const actor = await Actor.create(payload, { pack: pack.collection });
  return { uuid: actor.uuid, name: actor.name, status };
}

/**
 * Batch-import drafts under one source. Ensures the pack + source folder,
 * creates each, then invalidates the MonsterLinker cache so the new monsters are
 * linkable immediately (no reload). GM-only.
 * @returns {Promise<{pack:string, created:object[], replaced:object[], skipped:string[], total:number}|null>}
 */
export async function createMonsters(drafts, { source = "", onConflict } = {}) {
  if (!game.user?.isGM) { ui.notifications?.warn("Only a GM can import monsters."); return null; }
  const pack = await ensureMonsterPack();
  const folder = await ensureSourceFolder(pack, source);
  const out = { pack: pack.collection, created: [], replaced: [], skipped: [], total: drafts.length };
  for (const draft of drafts) {
    const r = await createMonster(draft, { pack, folder, source, onConflict });
    if (!r) continue;
    if (r.status === "skipped") out.skipped.push(r.name);
    else if (r.status === "replaced") out.replaced.push({ name: r.name, uuid: r.uuid });
    else out.created.push({ name: r.name, uuid: r.uuid });
  }
  MonsterLinker.invalidate();
  return out;
}

export const MonsterImporter = {
  PACK_LABEL, ensureMonsterPack, ensureSourceFolder, createMonster, createMonsters,
};
