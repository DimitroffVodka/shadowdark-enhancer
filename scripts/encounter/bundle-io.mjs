/**
 * Shadowdark Enhancer — Export/Import Bundle (REQ-25, SP-C).
 *
 * With D8, "a GM's imported content" IS the compendium suite. The bundle is
 * one self-contained JSON file: every suite pack's documents (with their _ids)
 * plus per-source compendium folders. Because ensureSuite creates packs from
 * fixed labels, the world collection ids (world.shadowdark-enhancer--actors,
 * …) are identical on every world — so `@UUID[Compendium.world.…]` references
 * inside the docs stay valid as long as the import preserves _ids
 * (`keepId: true`).
 *
 * Legacy hazard (A-03): treasure tables enriched before the Phase 11 fold-in
 * reference `Compendium.world.loot.Item.*`, which will not exist on a fresh
 * world. Export remaps those by id → name → the same-name sde-items copy;
 * anything unresolvable is counted in `warnings` — visible, never silent.
 *
 * Import (A-02/D6): create-with-keepId, SKIP docs whose _id already exists,
 * never delete or overwrite. Idempotent re-import.
 *
 * Ships ZERO content (D1) — the bundle is produced from the GM's own world.
 * Pure helpers (remapLegacyRefs, validateBundle) are Foundry-free and
 * node-tested; Foundry-bound functions dynamic-import their dependencies.
 */
import { MODULE_ID } from "../module-id.mjs";

// ─── Constants ───────────────────────────────────────────────────────────────

/** Bundle format version — bump on breaking shape changes. */
export const BUNDLE_FORMAT = 1;

/** Compendium reference pattern inside serialized docs (world packs only). */
const WORLD_REF_RE = /Compendium\.world\.([a-zA-Z0-9_-]+)\.([A-Za-z]+)\.([a-zA-Z0-9]{16})/g;

// ─── Pure helpers (Foundry-free, node:test importable) ───────────────────────

/**
 * Rewrite legacy world-pack references inside a serialized bundle string.
 *
 * Any `Compendium.world.<pack>.<Type>.<id>` whose pack slug is NOT in
 * `suiteSlugs` is looked up via `legacyIdToName` (id → doc name) and then
 * `nameToSuiteRef` (lowercased name → { slug, type, id }); resolvable refs
 * are rewritten to the suite copy, unresolvable ones stay verbatim and are
 * reported.
 *
 * @param {string} json - the serialized bundle
 * @param {object} opts
 * @param {string[]} opts.suiteSlugs - world pack slugs that belong to the suite
 * @param {Map<string,string>|Record<string,string>} opts.legacyIdToName
 * @param {Map<string,{slug:string,type:string,id:string}>} opts.nameToSuiteRef
 * @returns {{ json: string, remapped: number, unresolved: string[] }}
 */
export function remapLegacyRefs(json, { suiteSlugs, legacyIdToName, nameToSuiteRef }) {
  const slugSet = new Set(suiteSlugs ?? []);
  const idName = legacyIdToName instanceof Map
    ? legacyIdToName
    : new Map(Object.entries(legacyIdToName ?? {}));
  const nameRef = nameToSuiteRef instanceof Map
    ? nameToSuiteRef
    : new Map(Object.entries(nameToSuiteRef ?? {}));

  let remapped = 0;
  const unresolved = [];
  const out = String(json ?? "").replace(WORLD_REF_RE, (full, slug, type, id) => {
    if (slugSet.has(slug)) return full;                    // suite ref — keep
    const name = idName.get(id);
    const ref = name ? nameRef.get(String(name).toLowerCase()) : null;
    if (ref) {
      remapped++;
      return `Compendium.world.${ref.slug}.${ref.type}.${ref.id}`;
    }
    unresolved.push(full);
    return full;                                           // visible in warnings
  });
  return { json: out, remapped, unresolved };
}

/**
 * Null out provenance fields (`_stats.compendiumSource`, `flags.core.sourceId`)
 * that point at NON-suite world packs. These are creation metadata, never
 * resolved for gameplay; carrying them cross-world just produces dangling
 * refs (live-caught: 09-02 migration stamped the legacy imported-monsters
 * pack as compendiumSource on 4 actors). Mutates docObj; returns scrub count.
 *
 * @param {object} docObj - a document toObject()
 * @param {Set<string>|string[]} suiteSlugs
 * @returns {number}
 */
export function scrubNonSuiteProvenance(docObj, suiteSlugs) {
  const slugs = suiteSlugs instanceof Set ? suiteSlugs : new Set(suiteSlugs ?? []);
  let scrubbed = 0;
  const isNonSuiteWorldRef = (v) => {
    const m = /^Compendium\.world\.([a-zA-Z0-9_-]+)\./.exec(String(v ?? ""));
    return m ? !slugs.has(m[1]) : false;
  };
  const scrubDoc = (o) => {
    if (!o || typeof o !== "object") return;
    if (o._stats && isNonSuiteWorldRef(o._stats.compendiumSource)) { o._stats.compendiumSource = null; scrubbed++; }
    if (o.flags?.core && isNonSuiteWorldRef(o.flags.core.sourceId)) { o.flags.core.sourceId = null; scrubbed++; }
    for (const embedded of [o.items, o.effects, o.results, o.pages]) {
      if (Array.isArray(embedded)) embedded.forEach(scrubDoc);
    }
  };
  scrubDoc(docObj);
  return scrubbed;
}

/**
 * Validate a parsed bundle object. Returns { ok, errors } — never throws.
 * @param {object} obj
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateBundle(obj) {
  const errors = [];
  if (!obj || typeof obj !== "object") errors.push("not an object");
  else {
    if (obj.format !== BUNDLE_FORMAT) errors.push(`format ${obj.format} != ${BUNDLE_FORMAT}`);
    if (obj.module !== MODULE_ID) errors.push(`module "${obj.module}" != "${MODULE_ID}"`);
    if (!obj.packs || typeof obj.packs !== "object") errors.push("missing packs");
    else {
      for (const [key, p] of Object.entries(obj.packs)) {
        if (!p || !Array.isArray(p.docs) || !Array.isArray(p.folders)) {
          errors.push(`pack "${key}" missing docs/folders arrays`);
        }
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

// ─── Export (Foundry-bound) ───────────────────────────────────────────────────

/**
 * Serialize the entire suite into a bundle object.
 *
 * Read-only — mutates nothing in the world. GM-gated.
 *
 * @returns {Promise<object|null>} the bundle, or null (non-GM / no suite)
 */
export async function buildBundle() {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a GM can export the bundle.");
    return null;
  }
  const { SUITE_PACKS, findSuitePack, ensureSuite } = await import("./compendium-suite.mjs");

  // Resolve all suite packs (create any missing so the export shape is total).
  let missing = SUITE_PACKS.some((d) => !findSuitePack(d.id));
  if (missing) await ensureSuite();

  const packs = {};
  const stats = {};
  const suiteSlugs = [];
  const nameToSuiteRef = new Map();

  for (const desc of SUITE_PACKS) {
    const pack = findSuitePack(desc.id);
    if (!pack) { packs[desc.key] = { folders: [], docs: [] }; stats[desc.key] = { docs: 0, folders: 0 }; continue; }
    const slug = pack.collection.replace(/^world\./, "");
    suiteSlugs.push(slug);
    const folders = (pack.folders?.contents ?? [...(pack.folders ?? [])]).map((f) => f.toObject());
    const docs = (await pack.getDocuments()).map((d) => d.toObject());
    packs[desc.key] = { type: desc.type, slug, folders, docs };
    stats[desc.key] = { docs: docs.length, folders: folders.length };
    // Same-name lookup target for legacy remap (items carry the world.loot fold-in copies).
    for (const d of docs) {
      const key = String(d.name ?? "").toLowerCase();
      if (key && !nameToSuiteRef.has(key)) nameToSuiteRef.set(key, { slug, type: desc.type, id: d._id });
    }
  }

  // Scrub cross-world-meaningless provenance now that the FULL slug set is known.
  const slugSetForScrub = new Set(suiteSlugs);
  let scrubbedProvenance = 0;
  for (const key of Object.keys(packs)) {
    for (const d of packs[key].docs ?? []) scrubbedProvenance += scrubNonSuiteProvenance(d, slugSetForScrub);
  }

  // Legacy id → name map from every non-suite WORLD pack (e.g. world.loot).
  const legacyIdToName = new Map();
  const slugSet = new Set(suiteSlugs);
  for (const pack of game.packs) {
    if (pack.metadata?.packageType !== "world") continue;
    const slug = pack.collection.replace(/^world\./, "");
    if (slugSet.has(slug)) continue;
    try {
      const index = await pack.getIndex();
      for (const e of index) legacyIdToName.set(e._id, e.name ?? "");
    } catch (_) { /* unreadable pack — refs to it will surface as unresolved */ }
  }

  const bundle = {
    format: BUNDLE_FORMAT,
    module: MODULE_ID,
    moduleVersion: game.modules.get(MODULE_ID)?.version ?? "unknown",
    world: game.world?.id ?? "unknown",
    exported: new Date().toISOString(),
    packs,
    stats,
    warnings: [],
  };

  // Remap legacy refs across the serialized bundle (A-03).
  const { json, remapped, unresolved } = remapLegacyRefs(JSON.stringify(bundle), {
    suiteSlugs, legacyIdToName, nameToSuiteRef,
  });
  const out = JSON.parse(json);
  out.stats.remappedRefs = remapped;
  out.stats.scrubbedProvenance = scrubbedProvenance;
  out.warnings = [...new Set(unresolved)].map((u) => `unresolved legacy ref: ${u}`);
  return out;
}

/** Build the bundle and hand it to the browser as a JSON download. GM-gated. */
export async function exportBundle() {
  const bundle = await buildBundle();
  if (!bundle) return null;
  const save = foundry.utils?.saveDataToFile ?? globalThis.saveDataToFile;
  if (typeof save !== "function") {
    ui.notifications?.error("saveDataToFile unavailable — cannot download the bundle.");
    return bundle;
  }
  const date = bundle.exported.slice(0, 10);
  save(JSON.stringify(bundle, null, 2), "text/json", `shadowdark-enhancer-bundle-${date}.json`);
  return bundle;
}

// ─── Import (Foundry-bound) ───────────────────────────────────────────────────

/** Document class per suite pack type. */
const DOC_CLASSES = {
  Actor: () => Actor,
  Item: () => Item,
  RollTable: () => RollTable,
  JournalEntry: () => JournalEntry,
  Scene: () => Scene,
};

/**
 * Apply a validated bundle to this world's suite (A-02, D6):
 * ensure the suite, recreate compendium folders + documents with their
 * original _ids (`keepId: true`), SKIP anything whose _id already exists —
 * never deletes, never overwrites. Idempotent re-import.
 *
 * @param {object} bundle
 * @returns {Promise<{ok:boolean, errors?:string[], packs?:object,
 *   created?:number, skippedExisting?:number, failures?:number}|null>}
 */
export async function applyBundle(bundle) {
  if (!game.user?.isGM) {
    ui.notifications?.warn("Only a GM can import a bundle.");
    return null;
  }
  const check = validateBundle(bundle);
  if (!check.ok) return { ok: false, errors: check.errors };

  const { SUITE_PACKS, findSuitePack, ensureSuite } = await import("./compendium-suite.mjs");
  await ensureSuite();

  const report = { ok: true, packs: {}, created: 0, skippedExisting: 0, failures: 0 };

  for (const desc of SUITE_PACKS) {
    const data = bundle.packs[desc.key];
    const tally = { created: 0, skippedExisting: 0, failures: 0 };
    report.packs[desc.key] = tally;
    if (!data || (!data.docs.length && !data.folders.length)) continue;

    const pack = findSuitePack(desc.id);
    if (!pack) { tally.failures += data.docs.length; report.failures += data.docs.length; continue; }
    if (pack.locked) { try { await pack.configure({ locked: false }); } catch (_) {} }

    // Folders first (docs reference folder ids). Skip ids already present.
    const haveFolders = new Set((pack.folders?.contents ?? [...(pack.folders ?? [])]).map((f) => f.id));
    for (const f of data.folders) {
      if (haveFolders.has(f._id)) continue;
      try {
        await Folder.create(f, { pack: pack.collection, keepId: true });
      } catch (err) {
        console.warn(`${MODULE_ID} | bundle import: folder "${f.name}" failed:`, err);
      }
    }

    // Documents — keepId, skip-existing, batch create, per-batch catch.
    const haveIds = new Set([...pack.index].map((e) => e._id));
    const fresh = [];
    for (const d of data.docs) {
      if (haveIds.has(d._id)) tally.skippedExisting++;
      else fresh.push(d);
    }
    const DocClass = DOC_CLASSES[desc.type]?.();
    if (fresh.length && DocClass) {
      try {
        const made = await DocClass.createDocuments(fresh, { pack: pack.collection, keepId: true });
        tally.created += made.length;
      } catch (err) {
        console.error(`${MODULE_ID} | bundle import: batch create failed for ${desc.key}:`, err);
        // Fall back to per-doc so one bad payload doesn't sink the pack.
        for (const d of fresh) {
          try {
            await DocClass.create(d, { pack: pack.collection, keepId: true });
            tally.created++;
          } catch (e2) {
            console.error(`${MODULE_ID} | bundle import: "${d.name}" failed:`, e2);
            tally.failures++;
          }
        }
      }
    }
    report.created += tally.created;
    report.skippedExisting += tally.skippedExisting;
    report.failures += tally.failures;
  }

  // Fresh indices so imported content resolves immediately (mirrors A-03/12-01).
  try {
    const { MonsterLinker } = await import("./monster-linker.mjs");
    MonsterLinker.invalidate();
  } catch (_) {}
  try {
    const { LootLinker } = await import("./loot-linker.mjs");
    LootLinker.invalidate();
  } catch (_) {}
  // The Western Reaches default merchant references the just-imported item pack —
  // top it up now that its items resolve.
  try {
    const { MerchantShop } = await import("../merchant-shop.mjs");
    await MerchantShop.seedDefaultMerchants();
  } catch (_) {}
  // Wire any imported ancestry Names/Trinkets tables into the character builder.
  try {
    const { wireAncestryTables } = await import("../char-builder/data.mjs");
    await wireAncestryTables();
  } catch (_) {}

  return report;
}

/**
 * Read a File (from an <input type="file">), parse and apply it.
 * @param {File} file
 * @returns {Promise<object|null>} applyBundle's report, or { ok:false, errors }
 */
export async function importBundleFromFile(file) {
  let text;
  try {
    text = await file.text();
  } catch (err) {
    return { ok: false, errors: [`could not read file: ${err.message}`] };
  }
  let bundle;
  try {
    bundle = JSON.parse(text);
  } catch (err) {
    return { ok: false, errors: [`not valid JSON: ${err.message}`] };
  }
  return applyBundle(bundle);
}
