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
import { replaceDocument, cleanImportHtml } from "./compendium-suite.mjs";
import { pickShikashiSpellIcon } from "./shikashi-icons.mjs";

const PACK_LABEL = MONSTER_PACK_LABEL;

/** Find-or-create the managed world Actor compendium; unlock if locked. (Mirrors ensureLootPack.) */
export async function ensureMonsterPack() {
  // v13 namespaced the global under foundry.documents.collections (module min is v13).
  const CompendiumCollectionCls =
    foundry.documents?.collections?.CompendiumCollection ?? CompendiumCollection;
  let pack = findMonsterPack();
  if (!pack) {
    pack = await CompendiumCollectionCls.createCompendium({ label: PACK_LABEL, type: "Actor", packageType: "world" });
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

const SPELL_TAG = /\((int|wis|cha)\s+spell\)/i;

/** Synthesize a minimal but functional Spell item when no compendium match exists. */
function buildFallbackSpell(name, description) {
  const text = String(description || "");
  const body = text
    .replace(/^\s*\((?:int|wis|cha)\s+spell\)[.,]?\s*/i, "")
    .replace(/^\s*(?:int|wis|cha)\s+spell[.,]?\s*/i, "")
    .replace(/^\s*DC\s+\d+[.,]?\s*/i, "")
    .trim();
  const range = /\b(?:within\s+|in\s+)?far\b/i.test(text) ? "far"
    : /\bself\b/i.test(text) ? "self"
    : /\bnear\b/i.test(text) ? "near" : "close";
  const focus = /\bfocus\b/i.test(text);
  return {
    name, type: "Spell", img: pickShikashiSpellIcon(name),
    system: {
      class: [], tier: 1, range,
      duration: focus ? { type: "focus", value: "-1" } : { type: "instant", value: "-1" },
      lost: false, properties: [], source: { title: "" },
      description: body.startsWith("<") ? body : `<p>${body || name}</p>`,
      damageType: "none",
    },
  };
}

/**
 * Convert a draft's "(XXX Spell)" features into functional Spell items: match the
 * spell name against the installed spell compendia (real, full data) where it
 * exists, else synthesize a basic Spell item from the parsed text. The feature is
 * flagged `isSpell` so draftToActorData makes a Spell item (not an NPC Feature)
 * while STILL listing it in the notes stat block. Idempotent; never throws.
 */
export async function resolveSpellFeatures(draft) {
  const feats = draft.features ?? [];
  if (!feats.some((f) => SPELL_TAG.test(f.name || "") && !f.isSpell)) return;
  let byName = new Map();
  try {
    const { SpellIndex } = await import("./spell-index.mjs");
    const rows = await SpellIndex.loadAll();
    byName = new Map(rows.map((r) => [String(r.name).toLowerCase(), r]));
  } catch (err) {
    console.warn(`${MODULE_ID} | spell index load failed; using fallback spells:`, err);
  }
  draft.spells = draft.spells ?? [];
  for (const f of feats) {
    if (f.isSpell || !SPELL_TAG.test(f.name || "")) continue;
    const spellName = String(f.name).replace(/\s*\((?:int|wis|cha)\s+spell\)\s*/i, "").trim();
    const row = byName.get(spellName.toLowerCase());
    let source = null;
    if (row?.uuid) {
      const doc = await fromUuid(row.uuid).catch(() => null);
      if (doc?.type === "Spell") { source = doc.toObject(); delete source._id; }
    }
    if (!source) source = buildFallbackSpell(spellName, f.description);
    draft.spells.push({ uuid: row?.uuid ?? null, name: spellName, img: source.img ?? pickShikashiSpellIcon(spellName), source, matched: !!row });
    f.isSpell = true;
  }
}

/**
 * Auto-assign portrait + token art by name-matching the monster against any
 * installed Actor compendium (picking up community-token art mappings). No-op if
 * the draft already has real art or there's no match. Best-effort; never throws.
 */
export async function resolveDraftArt(draft) {
  try {
    const { _isPlaceholderArt, _findCompendiumActorByName, _getCompendiumArtFor } = await import("./art-utils.mjs");
    if (!_isPlaceholderArt(draft.img) && draft.tokenSrc && !_isPlaceholderArt(draft.tokenSrc)) return;
    const uuid = await _findCompendiumActorByName(draft.name);
    if (!uuid) return;
    const comp = await fromUuid(uuid).catch(() => null);
    if (!comp) return;
    const art = _getCompendiumArtFor(comp);
    const img = art?.actor || (!_isPlaceholderArt(comp.img) ? comp.img : null);
    const token = art?.token?.texture?.src || (!_isPlaceholderArt(comp.prototypeToken?.texture?.src) ? comp.prototypeToken?.texture?.src : null);
    if (img && _isPlaceholderArt(draft.img)) draft.img = img;
    if (token && (!draft.tokenSrc || _isPlaceholderArt(draft.tokenSrc))) draft.tokenSrc = token;
  } catch (err) {
    console.warn(`${MODULE_ID} | art resolution failed:`, err);
  }
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

  // Foundry-bound enrichment of the parsed draft before the (pure) data build:
  // resolve "(XXX Spell)" features → functional Spell items, and auto-assign art.
  await resolveSpellFeatures(draft);
  await resolveDraftArt(draft);

  const { actorData, items } = draftToActorData(draft);
  // Commit choke point: sanitize persisted HTML (review #1) — encounter-
  // creator's _descHtml passes through strings that start with "<".
  if (actorData.system?.notes) actorData.system.notes = cleanImportHtml(actorData.system.notes);
  for (const it of items) {
    if (it.system?.description) it.system.description = cleanImportHtml(it.system.description);
  }
  const index = await pack.getIndex();
  const existing = [...index].find((e) => (e.name ?? "").toLowerCase() === actorData.name.toLowerCase());

  // Fold the embedded items into the create payload (the compendium-create path,
  // not a post-create createEmbeddedDocuments call); stamp the source flag.
  const buildPayload = () => ({
    ...actorData,
    items,
    folder: folder ?? null,
    flags: { ...(actorData.flags ?? {}), [MODULE_ID]: { ...(actorData.flags?.[MODULE_ID] ?? {}), source } },
  });

  if (existing) {
    const choice = onConflict ? await onConflict(actorData.name) : "rename";
    if (choice === "skip") return { name: actorData.name, status: "skipped" };
    if (choice === "replace") {
      const old = await pack.getDocument(existing._id).catch(() => null);
      if (old) {
        // Non-destructive replace: in-place update (UUID + inbound links
        // survive; embedded items swapped) with create-then-delete fallback.
        const { doc, mode } = await replaceDocument(old, buildPayload(), pack);
        return { uuid: doc.uuid, name: doc.name, status: "replaced", mode };
      }
      // Index entry without a resolvable document — fall through to create.
    } else {
      actorData.name = _uniqueName(index, actorData.name);
    }
  }

  const actor = await Actor.create(buildPayload(), { pack: pack.collection });
  return { uuid: actor.uuid, name: actor.name, status: "created" };
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
