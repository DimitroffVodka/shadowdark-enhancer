/**
 * DEV — one-shot sealed-unit builder. NOT loaded at runtime; import it via MCP
 * `evaluate` in the dev world when authoring a sealed unit. It captures live
 * world docs, seals them, and returns everything needed to write the repo
 * artifacts (blob + SEALED_UNITS entry). See dev/SEAL-PROCEDURE.md for the full
 * repeatable checklist (capture → seal → write → commit → test unlock).
 *
 * Usage (in an MCP evaluate):
 *   const { buildSealedUnit } = await import(
 *     '/modules/shadowdark-enhancer/dev/seal-unit.mjs?v='+Date.now());
 *   const r = await buildSealedUnit({
 *     id: "cs4-spells", name: "Cursed Scroll 4 Spells", type: "Spell",
 *     source: "CS4", pages: "…", coversType: "Spell",
 *     folders: [{ pack: "sde-items", path: ["Spells"] }],  // and/or roots:[uuid,…]
 *     anchorPhrases: [ …5 verbatim phrases from the book spell section… ],
 *   });
 *   return { docCount:r.docCount, kinds:r.kinds, anchors:r.registryEntry.anchors,
 *            b64len:r.encBase64.length };  // then hand r.encBase64 to the repo write
 *
 * The caller (Claude) writes r.encBase64 → data/locked/<id>.json, adds
 * r.registryEntry to SEALED_UNITS, updates the ledger, node --check, and commits.
 */
import { captureUnitPayload, sealUnit } from "../scripts/encounter/sealed-content.mjs";
import { findSuitePack } from "../scripts/encounter/compendium-suite.mjs";
import { MODULE_ID } from "../scripts/module-id.mjs";

/** Folder ids at and under `path` (array of names) in a pack; [] if not found. */
function _folderIdsUnder(pack, path) {
  let parentId = null;
  let leaf = null;
  for (const name of path) {
    leaf = pack.folders.find((f) => f.name === name && (f.folder?.id ?? null) === parentId);
    if (!leaf) return [];
    parentId = leaf.id;
  }
  const ids = new Set([leaf.id]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of pack.folders) {
      if (f.folder?.id && ids.has(f.folder.id) && !ids.has(f.id)) { ids.add(f.id); grew = true; }
    }
  }
  return [...ids];
}

/** Resolve explicit roots + folder selectors → a deduped uuid list. */
export async function collectRoots({ roots = [], folders = [] } = {}) {
  const out = [...roots];
  for (const spec of folders) {
    const pack = game.packs.get(spec.pack) ?? findSuitePack(spec.pack);
    if (!pack) { console.warn(`seal-unit: pack ${spec.pack} not found`); continue; }
    const ids = new Set(_folderIdsUnder(pack, spec.path));
    if (!ids.size) { console.warn(`seal-unit: folder ${spec.path.join("/")} not in ${spec.pack}`); continue; }
    const docs = await pack.getDocuments();
    for (const d of docs) { const fid = d.folder?.id; if (fid && ids.has(fid)) out.push(d.uuid); }
  }
  return [...new Set(out)];
}

/**
 * Capture + seal in one call. Returns { encBase64, registryEntry, docCount,
 * kinds } — never leaves prose in the caller (only ciphertext + hashes).
 */
export async function buildSealedUnit({
  id, name, type, source, pages = "", coversType = null,
  roots = [], folders = [], bundleSpellsForClass = null, anchorPhrases = [],
} = {}) {
  if (!id || !name || !type) throw new Error("buildSealedUnit: id, name, type required");
  if (!Array.isArray(anchorPhrases) || anchorPhrases.length < 3) {
    throw new Error("buildSealedUnit: provide ≥3 anchorPhrases (verbatim from the book section)");
  }
  const allRoots = await collectRoots({ roots, folders });
  const payload = await captureUnitPayload({ roots: allRoots, bundleSpellsForClass });
  if (!payload.docs.length) throw new Error("buildSealedUnit: captured 0 docs — check roots/folders");

  const { encBase64, anchorsMeta } = await sealUnit(payload, anchorPhrases);
  const registryEntry = {
    id, name, type, source, pages,
    ...(coversType ? { coversType } : {}),
    file: `modules/${MODULE_ID}/data/locked/${id}.json`,
    anchors: anchorsMeta,
  };
  const kinds = {};
  for (const d of payload.docs) { const k = d.data?.type || d.kind; kinds[k] = (kinds[k] || 0) + 1; }

  // Round-trip self-check: re-derive the key from the same phrases and decrypt,
  // so we never ship a blob that can't be unlocked by its own anchors.
  let verified = false;
  try {
    const { normalizeKeyText } = await import("../scripts/encounter/sealed-content.mjs");
    const material = anchorPhrases.map(normalizeKeyText).join("|");
    const bits = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(material));
    const key = await crypto.subtle.importKey("raw", bits, { name: "AES-GCM" }, false, ["decrypt"]);
    const u8 = Uint8Array.from(atob(encBase64), (c) => c.charCodeAt(0));
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: u8.slice(0, 12) }, key, u8.slice(12));
    verified = JSON.parse(new TextDecoder().decode(plain)).docs.length === payload.docs.length;
  } catch (_e) { verified = false; }

  return { id, filePath: `data/locked/${id}.json`, encBase64, docCount: payload.docs.length, kinds, registryEntry, verified };
}
