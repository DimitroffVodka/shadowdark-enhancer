/**
 * item-builder-gear.mjs — pure (Foundry-free, node-testable) gear logic for the
 * Item Builder workspace: stage-① table parsing, row merging, and stage-③ draft
 * assembly. Extracted so the parse → merge → create chain is testable end to
 * end without ApplicationV2 (2026-07-14 pre-push review: the builder rebuilt a
 * name/cost/slots-only draft in `_onCreate`, so Weapon/Armor lost damage, AC,
 * range, type, and properties on the primary guided path).
 *
 * Weapon/Armor rows come from gear-parser.parseGear (real stat columns);
 * Basic rows keep the generic itemRecognizer force-parse. Rows carry the FULL
 * draft fields plus `description` (stage ② fills it) and `warnings` (shown as
 * review flags). Property NAME → UUID resolution stays Foundry-bound
 * (item-importer.resolveGearPropertiesAll) and runs on these same rows.
 */
import { parseGear } from "./gear-parser.mjs";
import { itemRecognizer } from "./item-parser.mjs";

const _strip = (h) => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const _norm  = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Parse a price/stat table paste into working rows for the builder.
 * @param {string} text
 * @param {"Basic"|"Weapon"|"Armor"} gearType
 * @param {{ onDrop?: (text: string, reason: string) => void }} [opts]
 * @returns {object[]} rows — full draft fields + description:"" + warnings[]
 */
export function parseGearTable(text, gearType, { onDrop } = {}) {
  if (gearType === "Weapon" || gearType === "Armor") {
    return parseGear(text, gearType, { onDrop }).map(({ draft, warnings }) => ({
      ...draft,
      description: "",
      warnings: warnings ?? [],
    }));
  }
  const { claimed } = itemRecognizer.claim(text, { force: true });
  return itemRecognizer.parse(claimed, { force: true }).map(({ draft, warnings }) => ({
    name: draft.name,
    cost: draft.cost,
    slots: draft.slots,
    description: "",
    warnings: warnings ?? [],
  }));
}

/**
 * Merge freshly parsed rows into the working set: an existing row (matched by
 * normalized name) refreshes ALL mechanics from the new parse but KEEPS its
 * hand-edited name and any description already matched/typed; new names append.
 */
export function mergeGearRows(existingRows, newRows) {
  const rows = existingRows.map((r) => ({ ...r }));
  for (const nr of newRows) {
    const i = rows.findIndex((r) => _norm(r.name) === _norm(nr.name));
    if (i >= 0) rows[i] = { ...nr, name: rows[i].name, description: rows[i].description };
    else rows.push({ ...nr });
  }
  return rows;
}

/**
 * Source label → the char-builder's `system.source.title` slug (same mapping
 * the hub's char-content commit stamps, so builder-imported gear is gated and
 * censused like every other unlock).
 */
export function sourceTitleSlug(label) {
  const s = String(label ?? "").trim().toLowerCase();
  if (!s) return "";
  return ({
    "cursed scroll 4": "cursed-scroll-4",
    "cursed scroll 5": "cursed-scroll-5",
    "cursed scroll 6": "cursed-scroll-6",
    "cs4": "cursed-scroll-4", "cs5": "cursed-scroll-5", "cs6": "cursed-scroll-6",
    "western reaches": "western-reaches",
  })[s] ?? s.replace(/\s+/g, "-");
}

/**
 * Assemble the create-ready drafts for ItemImporter.createItems, carrying the
 * type-appropriate mechanics through (this is the pass-through `_onCreate` was
 * missing). `properties` (resolved UUIDs) rides along when present;
 * `sourceTitle` stamps `system.source.title` for char-builder gating.
 */
export function assembleCreateDrafts(rows, gearType, { sourceTitle = "" } = {}) {
  return rows.map((it) => ({
    name: it.name,
    type: gearType,
    cost: { gp: it.cost?.gp ?? 0, sp: it.cost?.sp ?? 0, cp: it.cost?.cp ?? 0 },
    slots: { free_carry: it.slots?.free_carry ?? 0, per_slot: it.slots?.per_slot ?? 1, slots_used: it.slots?.slots_used ?? 1 },
    description: _strip(it.description) ? it.description : "<p></p>",
    riders: { benefit: [], bonus: "", curse: "", personality: "" },
    ...(gearType === "Weapon" ? {
      damage: it.damage ?? { oneHanded: "", twoHanded: "" },
      range: it.range || "close",
      wtype: it.wtype || "melee",
      propNames: it.propNames ?? [],
    } : {}),
    ...(gearType === "Armor" ? {
      ac: it.ac ?? { base: 0, modifier: 0, attribute: "" },
      baseArmor: it.baseArmor ?? "",
      propNames: it.propNames ?? [],
    } : {}),
    ...(Array.isArray(it.properties) ? { properties: it.properties } : {}),
    ...(sourceTitle ? { source: { title: sourceTitle } } : {}),
  }));
}

/** Compact per-row mechanics summary for the builder's review table. */
export function gearStatsLabel(it, gearType) {
  const props = (it.propNames ?? []).join(", ");
  if (gearType === "Weapon") {
    const dmg = [it.damage?.oneHanded, it.damage?.twoHanded].filter(Boolean).join("/");
    return [dmg || "no damage", it.range, it.wtype, props].filter(Boolean).join(" · ");
  }
  if (gearType === "Armor") {
    const ac = it.ac?.base
      ? `AC ${it.ac.base}${it.ac.attribute ? ` +${it.ac.attribute}` : ""}`
      : (it.ac?.modifier ? `AC +${it.ac.modifier}` : "no AC");
    return [ac, it.baseArmor, props].filter(Boolean).join(" · ");
  }
  return "";
}
