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

import { findSuitePack, ensureSuite } from "../../shared/compendium-suite.mjs";

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

  const idx = await pack.getIndex({ fields: ["type"] });
  const byName = new Map(
    [...idx].filter((e) => e.type === "Property")
      .map((e) => [(e.name ?? "").toLowerCase(), `Compendium.${pack.collection}.Item.${e._id}`]),
  );

  // Properties the drafts need (name → description).
  const needed = new Map();
  for (const d of drafts) {
    for (const p of (d.siegeProperties ?? [])) if (!needed.has(p.name)) needed.set(p.name, p.description);
  }

  // Ensure each exists; record its UUID.
  const uuidByName = {};
  for (const [name, description] of needed) {
    let uuid = byName.get(name.toLowerCase());
    if (!uuid) {
      const doc = await Item.create(
        {
          name, type: "Property",
          system: { itemType: "weapon", description: description || "<p></p>", source: { title: "western-reaches" } },
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
