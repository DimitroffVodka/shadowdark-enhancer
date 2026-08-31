/**
 * Shadowdark Enhancer — siege-weapon property resolution (Foundry-bound).
 *
 * The WR siege weapons carry Blast/Exploding — weapon properties the core
 * `shadowdark.properties` pack doesn't ship. This materializes them as real
 * `Property` items in the sde-items pack (idempotent, matched by name within
 * the canonical folder or the pack root for legacy migration) and
 * stamps their UUIDs onto each weapon draft's `system.properties`, so the weapon
 * sheet lists them as proper weapon properties. Runs just before the shared item
 * commit; kept out of the pure siege-parser so that module stays node-testable.
 */

import { findSuitePack, ensureSuite, ensureFolderPath } from "../../shared/compendium-suite.mjs";

/** Stable destination for the WR-only Property items this importer creates. */
const WEAPON_PROPERTIES_FOLDER = ["Western Reaches", "Weapon Properties"];

/**
 * Turn each draft's `siegeProperties: [{name, description}]` into real Property
 * items and rewrite `draft.properties` to their UUIDs (then drop the marker).
 * A no-op when no draft carries siege properties.
 * @param {Array<object>} drafts item drafts (mutated in place)
 */
export async function resolveSiegeProperties(drafts) {
  if (!drafts?.some((d) => d.siegeProperties?.length)) return;
  const pack = findSuitePack("sde-items") ?? (await ensureSuite())?.items;
  if (!pack) throw new Error("managed Items pack is unavailable");
  if (pack.locked) {
    try {
      await pack.configure({ locked: false });
    } catch (err) {
      throw new Error(`managed Items pack could not be unlocked: ${err?.message ?? err}`);
    }
  }

  // Resolve the destination before reading the index. This both creates the
  // parent source folder when an older world only has the pack and gives us a
  // stable leaf for newly-created and legacy root-level properties alike.
  const folderId = await ensureFolderPath(pack, WEAPON_PROPERTIES_FOLDER);
  if (!folderId) throw new Error("could not create the Weapon Properties folder");
  const idx = await pack.getIndex({ fields: ["type", "folder"] });
  const byName = new Map();
  for (const entry of idx) {
    if (entry.type !== "Property") continue;
    const key = (entry.name ?? "").toLowerCase();
    // A target-folder document is canonical. A root-level document is the only
    // legacy candidate eligible for an in-place move. Ignore every unrelated
    // folder so a GM's same-named custom Property is never claimed by WR.
    const entryFolder = folderIdOf(entry.folder);
    const rank = entryFolder === folderId ? 2 : (entryFolder === null ? 1 : 0);
    if (!rank) continue;
    const prior = byName.get(key);
    const priorId = String(prior?.entry?._id ?? "");
    const entryId = String(entry._id ?? "");
    if (!prior || rank > prior.rank || (rank === prior.rank && entryId < priorId)) {
      byName.set(key, { entry, rank });
    }
  }

  // Properties the drafts need (name → description).
  const needed = new Map();
  for (const d of drafts) {
    for (const p of (d.siegeProperties ?? [])) if (!needed.has(p.name)) needed.set(p.name, p.description);
  }

  // Ensure each exists; record its UUID.
  const uuidByName = {};
  for (const [name, description] of needed) {
    const candidate = byName.get(name.toLowerCase())?.entry;
    let existing = candidate;
    let uuid = existing
      ? `Compendium.${pack.collection}.Item.${existing._id}`
      : null;
    if (existing && folderId) {
      // A pre-B2 import created Blast/Exploding at pack root. Reuse the same
      // document and move only this imported Property into the stable folder;
      // its UUID, description, and any GM edits remain intact.
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
          throw new Error(`couldn't move siege property "${name}" into ${WEAPON_PROPERTIES_FOLDER.join(" / ")}: ${err?.message ?? err}`);
        }
      }
    }
    if (!uuid) {
      let doc;
      try {
        doc = await Item.create(
          {
            name, type: "Property",
            system: { itemType: "weapon", description: description || "<p></p>", source: { title: "western-reaches" } },
            folder: folderId,
          },
          { pack: pack.collection },
        );
      } catch (err) {
        throw new Error(`couldn't create siege property "${name}": ${err?.message ?? err}`);
      }
      if (!doc?.uuid) throw new Error(`created siege property "${name}" has no UUID`);
      uuid = doc.uuid;
    }
    uuidByName[name] = uuid;
  }

  // Stamp resolved UUIDs onto the weapon drafts.
  for (const d of drafts) {
    if (d.siegeProperties?.length) {
      d.properties = d.siegeProperties.map((p) => uuidByName[p.name]).filter(Boolean);
    }
    delete d.siegeProperties;
  }
}

/**
 * Prepare siege properties at an importer commit boundary. A failed Property
 * create/move must stop the weapon commit rather than silently produce a
 * weapon whose properties list is empty.
 * @param {Array<object>} drafts item drafts (mutated in place on success)
 * @returns {Promise<boolean>} whether the prepass completed
 */
export async function prepareSiegeProperties(drafts) {
  if (!drafts?.some((d) => d.siegeProperties?.length)) return true;
  try {
    await resolveSiegeProperties(drafts);
    return true;
  } catch (err) {
    console.error("shadowdark-enhancer | siege property preparation failed:", err);
    globalThis.ui?.notifications?.error?.(
      "Siege weapon Properties could not be prepared; no items were imported. See the console.",
    );
    return false;
  }
}

/** Normalize Foundry index/document folder values to an id or null. */
function folderIdOf(folder) {
  return folder?.id ?? folder ?? null;
}
