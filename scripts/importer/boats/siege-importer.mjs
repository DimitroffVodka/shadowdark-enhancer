/**
 * Shadowdark Enhancer — siege-weapon property resolution (Foundry-bound).
 *
 * The WR siege weapons carry Blast/Exploding — weapon properties the core
 * `shadowdark.properties` pack doesn't ship. This materializes them as real
 * `Property` items in the sde-items pack (idempotent, matched by name) and
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
  if (!pack) return;

  // Resolve the destination before reading the index. This both creates the
  // parent source folder when an older world only has the pack and gives us a
  // stable leaf for newly-created and legacy root-level properties alike.
  const folderId = await ensureFolderPath(pack, WEAPON_PROPERTIES_FOLDER);
  const idx = await pack.getIndex({ fields: ["type", "folder"] });
  const byName = new Map();
  for (const entry of idx) {
    if (entry.type !== "Property") continue;
    const key = (entry.name ?? "").toLowerCase();
    // If a previous partial/manual run left two same-named entries, prefer the
    // one already in the managed destination. Never create a third copy.
    const entryFolder = entry.folder?.id ?? entry.folder ?? null;
    const prior = byName.get(key);
    if (!prior || (folderId && entryFolder === folderId)) byName.set(key, entry);
  }

  // Properties the drafts need (name → description).
  const needed = new Map();
  for (const d of drafts) {
    for (const p of (d.siegeProperties ?? [])) if (!needed.has(p.name)) needed.set(p.name, p.description);
  }

  // Ensure each exists; record its UUID.
  const uuidByName = {};
  for (const [name, description] of needed) {
    const existing = byName.get(name.toLowerCase());
    let uuid = existing
      ? `Compendium.${pack.collection}.Item.${existing._id}`
      : null;
    if (existing && folderId) {
      // A pre-B2 import created Blast/Exploding at pack root. Reuse the same
      // document and move only this imported Property into the stable folder;
      // its UUID, description, and any GM edits remain intact.
      const existingFolder = existing.folder?.id ?? existing.folder ?? null;
      if (existingFolder !== folderId) {
        try {
          const doc = await pack.getDocument(existing._id);
          const currentFolder = doc?.folder?.id ?? doc?.folder ?? existingFolder;
          if (doc && currentFolder !== folderId) await doc.update({ folder: folderId });
        } catch (err) {
          console.warn(`shadowdark-enhancer | couldn't move siege property "${name}" into ${WEAPON_PROPERTIES_FOLDER.join(" / ")}:`, err);
        }
      }
    }
    if (!uuid) {
      const doc = await Item.create(
        {
          name, type: "Property",
          system: { itemType: "weapon", description: description || "<p></p>", source: { title: "western-reaches" } },
          folder: folderId ?? null,
        },
        { pack: pack.collection },
      ).catch((err) => { console.warn("shadowdark-enhancer | siege property create failed:", err); return null; });
      uuid = doc?.uuid;
    }
    if (uuid) uuidByName[name] = uuid;
  }

  // Stamp resolved UUIDs onto the weapon drafts.
  for (const d of drafts) {
    if (d.siegeProperties?.length) {
      d.properties = d.siegeProperties.map((p) => uuidByName[p.name]).filter(Boolean);
    }
    delete d.siegeProperties;
  }
}
