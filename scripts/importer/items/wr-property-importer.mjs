/**
 * Shadowdark Enhancer — Western Reaches custom weapon-property materializer.
 *
 * B2 introduced the one canonical policy for WR-only Property documents:
 * create/reuse them in `Western Reaches / Weapon Properties`, move a legacy
 * root document in place, ignore unrelated same-name folders, and fail closed
 * before the owning item import. Both siege properties and the Lance's
 * Charge/Devastating/Mounted use this seam so their identities cannot drift.
 */

import { findSuitePack, ensureSuite, ensureFolderPath } from "../../shared/compendium-suite.mjs";

/** Stable destination for every WR-only weapon Property item. */
export const WEAPON_PROPERTIES_FOLDER = Object.freeze(["Western Reaches", "Weapon Properties"]);

/** The only three custom property names B5 is allowed to materialize. */
export const LANCE_PROPERTY_NAMES = Object.freeze(["Charge", "Devastating", "Mounted"]);

/** Normalize a custom-property marker entry without inventing a name. */
function propertySpec(value) {
  if (typeof value === "string") return { name: value, description: "" };
  const name = String(value?.name ?? "").trim();
  return name ? { name, description: String(value?.description ?? "") } : null;
}
/** Read a marker field as deduplicated, case-insensitive Property specs. */
function specsFor(draft, marker) {
  const specs = [];
  const seen = new Set();
  for (const raw of (Array.isArray(draft?.[marker]) ? draft[marker] : [])) {
    const spec = propertySpec(raw);
    if (!spec) continue;
    const key = spec.name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    specs.push(spec);
  }
  return specs;
}

/** Normalize a Foundry folder value to an id or null. */
function folderIdOf(folder) {
  return folder?.id ?? folder ?? null;
}

/**
 * Materialize one marker's custom Property specs into the canonical WR folder.
 *
 * @param {Array<object>} drafts item drafts mutated in place
 * @param {{marker?: string, context?: string, pack?: object}} [options]
 *   `marker` is the draft field carrying `{name, description}` or string specs.
 *   `context` is only used in error text (for example, "siege" or "lance").
 *   `pack` is an optional already-resolved managed Items pack.
 * @returns {Promise<Array<object>|undefined>} the same drafts, or undefined for
 *   the no-op case
 */
export async function resolveWrWeaponProperties(
  drafts,
  { marker = "customProperties", context = "WR weapon", pack: suppliedPack } = {},
) {
  const targets = (drafts ?? []).filter((draft) => specsFor(draft, marker).length);
  if (!targets.length) return;

  const pack = suppliedPack ?? findSuitePack("sde-items") ?? (await ensureSuite())?.items;
  if (!pack) throw new Error("managed Items pack is unavailable");
  if (pack.locked) {
    try {
      await pack.configure({ locked: false });
    } catch (err) {
      throw new Error(`managed Items pack could not be unlocked: ${err?.message ?? err}`);
    }
  }

  // Resolve the destination before reading the index. This creates the parent
  // source folder in an older world and gives new and legacy documents one
  // stable canonical leaf.
  const folderId = await ensureFolderPath(pack, WEAPON_PROPERTIES_FOLDER);
  if (!folderId) throw new Error("could not create the Weapon Properties folder");

  const idx = await pack.getIndex({ fields: ["type", "folder"] });
  const byName = new Map();
  for (const entry of idx) {
    if (entry.type !== "Property") continue;
    const key = String(entry.name ?? "").toLowerCase();
    const entryFolder = folderIdOf(entry.folder);
    // A target-folder document is canonical. A root document is the only
    // legacy candidate eligible for an in-place move. Ignore every unrelated
    // folder so a GM's same-named custom Property is never claimed by WR.
    const rank = entryFolder === folderId ? 2 : (entryFolder === null ? 1 : 0);
    if (!rank || !key) continue;
    const prior = byName.get(key);
    const priorId = String(prior?.entry?._id ?? "");
    const entryId = String(entry._id ?? "");
    if (!prior || rank > prior.rank || (rank === prior.rank && entryId < priorId)) {
      byName.set(key, { entry, rank });
    }
  }

  // Property names are an independent, deterministic set across all drafts.
  const needed = new Map();
  for (const draft of targets) {
    for (const spec of specsFor(draft, marker)) {
      const key = spec.name.toLowerCase();
      if (!needed.has(key)) needed.set(key, spec);
    }
  }

  const uuidByName = new Map();
  for (const spec of needed.values()) {
    const candidate = byName.get(spec.name.toLowerCase())?.entry;
    let existing = candidate;
    let uuid = existing
      ? `Compendium.${pack.collection}.Item.${existing._id}`
      : null;

    if (existing && folderId) {
      const existingFolder = folderIdOf(existing.folder);
      if (existingFolder === null) {
        try {
          const doc = await pack.getDocument(existing._id);
          if (!doc) throw new Error("document no longer exists");
          const currentFolder = folderIdOf(doc.folder);
          if (currentFolder === null) {
            await doc.update({ folder: folderId });
            if (folderIdOf(doc.folder) !== folderId) throw new Error("folder update did not persist");
          } else if (currentFolder !== folderId) {
            // The index raced a GM move. It is no longer a root legacy
            // document, so leave it alone and create the canonical target.
            existing = null;
            uuid = null;
          }
        } catch (err) {
          throw new Error(`couldn't move ${context} property "${spec.name}" into ${WEAPON_PROPERTIES_FOLDER.join(" / ")}: ${err?.message ?? err}`);
        }
      }
    }

    if (!uuid) {
      let doc;
      try {
        doc = await globalThis.Item?.create?.({
          name: spec.name,
          type: "Property",
          system: {
            itemType: "weapon",
            description: spec.description || "<p></p>",
            source: { title: "western-reaches" },
          },
          folder: folderId,
        }, { pack: pack.collection });
      } catch (err) {
        throw new Error(`couldn't create ${context} property "${spec.name}": ${err?.message ?? err}`);
      }
      if (!doc?.uuid) throw new Error(`created ${context} property "${spec.name}" has no UUID`);
      uuid = doc.uuid;
    }
    uuidByName.set(spec.name.toLowerCase(), uuid);
  }

  // Preserve core properties already resolved on a weapon and append only the
  // custom UUIDs this marker owns. A rerun therefore cannot duplicate either.
  for (const draft of targets) {
    const current = Array.isArray(draft.properties) ? draft.properties : [];
    const added = specsFor(draft, marker)
      .map((spec) => uuidByName.get(spec.name.toLowerCase()))
      .filter(Boolean);
    draft.properties = [...current, ...added.filter((uuid) => !current.includes(uuid))];
    delete draft[marker];
  }
  return drafts;
}

/** B5-specialized wrapper: exactly the Lance marker, no broader code mapping. */
export function resolveLanceProperties(drafts, options = {}) {
  const allowed = new Set(LANCE_PROPERTY_NAMES.map((name) => name.toLowerCase()));
  for (const draft of drafts ?? []) {
    const invalid = specsFor(draft, "lanceProperties")
      .find((spec) => !allowed.has(spec.name.toLowerCase()));
    if (invalid) {
      throw new Error(`unsupported lance property "${invalid.name}"`);
    }
  }
  return resolveWrWeaponProperties(drafts, { ...options, marker: "lanceProperties", context: "lance" });
}

/**
 * Fail-closed B5 preparation used by both item-import and class-overlay paths.
 * A failed custom-property write leaves the marker on the draft and returns
 * false, so the owning item is not committed without its three UUIDs.
 */
export async function prepareLanceProperties(drafts, options = {}) {
  if (!(drafts ?? []).some((draft) => specsFor(draft, "lanceProperties").length)) return true;
  try {
    await resolveLanceProperties(drafts, options);
    return true;
  } catch (err) {
    console.error("shadowdark-enhancer | lance property preparation failed:", err);
    globalThis.ui?.notifications?.error?.(
      "Lance weapon Properties could not be prepared; no items were imported. See the console.",
    );
    return false;
  }
}
