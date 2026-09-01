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
import { itemRecognizer, splitDescriptionsByNames } from "./item-parser.mjs";
import { stripPageFurniture } from "./record-boundary.mjs";

const _strip = (h) => String(h ?? "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const _norm  = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
// Claim keys fold punctuation; literal keys retain it so a source alias such
// as "Oil flask" can be audited against the distinct row spelling "Oil, flask".
const _literalNorm = (s) => String(s ?? "").toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Assignment aliases for the Basic Gear descriptions page. These are source
 * spellings, not looser matching rules: each target is admitted only when its
 * canonical row is unique and every other row claiming the alias is one of
 * the explicitly audited source variants below.
 *
 * The plain "Rope." header is the base 60-foot rope row. The other row names
 * its material ("Rope, morzo silk"), so the source data breaks that apparent
 * tie without relying on array order or substring containment. An unexpected
 * third rope variant remains refused rather than inheriting this policy.
 */
export const BASIC_GEAR_DESCRIPTION_ASSIGNMENT_ALIASES = Object.freeze([
  Object.freeze({ alias: "Oil flask", target: "Oil, flask", allowedOwners: ["Oil, flask"] }),
  Object.freeze({
    alias: "Rope",
    target: "Rope, 60'",
    allowedOwners: ["Rope, 60'", "Rope, morzo silk"],
  }),
]);

/**
 * Anchor variants for one table row: the full name, the name without a
 * trailing quantity, and the part before a container comma. The book's
 * description headers use these bare/source spellings ("Candle.", "Tallow.",
 * and so on) while the table rows carry suffixes.
 * @param {string} name
 * @returns {string[]}
 */
export function descriptionAnchorNames(name) {
  const full = String(name ?? "").trim();
  const noQty = full.replace(/\s*\([^)]*\)\s*$/, "").trim();
  const noComma = noQty.split(",")[0].trim();
  return [...new Set([full, noQty, noComma].filter(Boolean))];
}

function addOwner(ownersByKey, key, item) {
  if (!key) return;
  if (!ownersByKey.has(key)) ownersByKey.set(key, new Set());
  ownersByKey.get(key).add(item);
}

function addClaim(claim, key, item) {
  if (!key) return;
  if (!claim.has(key)) claim.set(key, item);
  else if (claim.get(key) !== item) claim.set(key, null);
}

function addLiteralClaim(claim, key, item) {
  if (!key) return;
  if (!claim.has(key)) claim.set(key, item);
  else if (claim.get(key) !== item) claim.set(key, null);
}

/**
 * Match the Item Builder's description paste to already-parsed rows. This is
 * the pure seam behind _onMatchDesc: boundaries still belong to
 * splitDescriptionsByNames, while this function owns explicit assignment,
 * collision refusal, and one-to-one ownership.
 *
 * @param {object[]} items
 * @param {string} text
 * @param {{ aliases?: Array<{alias:string,target:string,allowedOwners?:string[]}> }} [options]
 * @returns {{ assignments: Array<{item:object,sourceName:string,description:string}>,
 *   entries: Array<{name:string,description:string}>, anchorNames:string[], refusedAliases:string[] }}
 */
export function matchGearDescriptions(items, text, { aliases = BASIC_GEAR_DESCRIPTION_ASSIGNMENT_ALIASES } = {}) {
  const rows = Array.isArray(items) ? items : [];
  const canonical = new Map();       // normalized canonical name -> item/null
  const canonicalLiterals = new Map(); // exact canonical spelling -> item/null
  const ownersByKey = new Map();     // normalized phrase -> every row claiming it
  const literalClaims = new Map();   // source spelling -> item/null

  for (const item of rows) {
    const canonicalKey = _norm(item?.name);
    addClaim(canonical, canonicalKey, item);
    addLiteralClaim(canonicalLiterals, _literalNorm(item?.name), item);
    addOwner(ownersByKey, canonicalKey, item);
    addLiteralClaim(literalClaims, _literalNorm(item?.name), item);
    for (const phrase of [...descriptionAnchorNames(item?.name), ...(item?.altNames ?? [])]) {
      addOwner(ownersByKey, _norm(phrase), item);
      addLiteralClaim(literalClaims, _literalNorm(phrase), item);
    }
  }

  // Exact canonical names win over variants, but a normalized collision among
  // canonical rows is refused rather than silently selecting the last row.
  const claim = new Map(canonical);
  for (const item of rows) {
    for (const phrase of [...descriptionAnchorNames(item?.name), ...(item?.altNames ?? [])]) {
      const key = _norm(phrase);
      if (!key || canonical.has(key)) continue;
      addClaim(claim, key, item);
    }
  }

  const refusedAliases = [];
  const acceptedAliases = [];
  for (const alias of aliases ?? []) {
    const aliasText = String(alias?.alias ?? "").trim();
    const aliasKey = _norm(aliasText);
    const target = canonicalLiterals.get(_literalNorm(alias?.target));
    const existingLiteral = literalClaims.get(_literalNorm(aliasText));
    const owners = ownersByKey.get(aliasKey) ?? new Set();
    const allowed = new Set((alias?.allowedOwners ?? [alias?.target])
      .map(_literalNorm).filter(Boolean));
    const auditedOwners = owners.has(target)
      && [...owners].every((owner) => allowed.has(_literalNorm(owner?.name)));
    const literalCollision = literalClaims.has(_literalNorm(aliasText))
      && existingLiteral !== target
      && !auditedOwners;
    const collision = !target || literalCollision || !auditedOwners;
    if (collision) {
      if (target && aliasText) refusedAliases.push(aliasText);
      continue;
    }
    // An explicit, data-backed alias may resolve a known shared variant (the
    // plain Rope case), but only after the collision audit above passes.
    claim.set(aliasKey, target);
    literalClaims.set(_literalNorm(aliasText), target);
    acceptedAliases.push(aliasText);
  }

  const ownerFor = (phrase) => {
    const literalKey = _literalNorm(phrase);
    if (literalClaims.has(literalKey)) return literalClaims.get(literalKey);
    return claim.get(_norm(phrase)) ?? null;
  };
  const anchorNames = [];
  const seenAnchors = new Set();
  const addAnchor = (phrase) => {
    const value = String(phrase ?? "").trim();
    if (!value || seenAnchors.has(value) || !ownerFor(value)) return;
    seenAnchors.add(value);
    anchorNames.push(value);
  };
  for (const item of rows) {
    for (const phrase of [...descriptionAnchorNames(item?.name), ...(item?.altNames ?? [])]) addAnchor(phrase);
  }
  for (const alias of acceptedAliases) addAnchor(alias);

  const entries = splitDescriptionsByNames(text, anchorNames);
  const assignments = [];
  const assignedItems = new Set();
  for (const entry of entries) {
    const item = ownerFor(entry.name);
    if (!item || assignedItems.has(item)) continue;
    assignedItems.add(item);
    assignments.push({ item, sourceName: entry.name, description: entry.description });
  }
  return { assignments, entries, anchorNames, refusedAliases };
}

/**
 * Parse a price/stat table paste into working rows for the builder.
 * @param {string} text
 * @param {"Basic"|"Weapon"|"Armor"} gearType
 * @param {{ onDrop?: (label: string, reason: string) => void }} [opts]
 *   `label` is whatever identifies the dropped row in the builder's list: the
 *   raw row text for a row the parser couldn't read, and the name cell for a
 *   currency row, which is refused on its name alone.
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
  // A Basic Gear paste can arrive with a page footer in its own blank-line
  // block. Force mode quite properly treats every remaining block as an item,
  // so remove page furniture at this input seam first. It is furniture, not a
  // dropped row the GM should review; record-boundary.mjs owns the predicate
  // used here and by the description path.
  const { claimed, skipped } = itemRecognizer.claim(stripPageFurniture(text), { force: true });
  // Rows the recognizer refused (currency rows like Coin/Gem, a multi-column
  // grid it can't split) travel out through onDrop, so the builder reports them
  // the same way the Weapon/Armor path reports its own drops.
  for (const s of skipped ?? []) onDrop?.(s.name, s.reason);
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
  // Every offered label form maps canonically: "CS1"…"CS6" and
  // "Cursed Scroll 1"…"Cursed Scroll 6" → cursed-scroll-N; WR both ways.
  const cs = s.match(/^(?:cs\s*|cursed scrolls?\s+)([1-6])$/);
  if (cs) return `cursed-scroll-${cs[1]}`;
  if (s === "western reaches" || s === "wr") return "western-reaches";
  return s.replace(/\s+/g, "-");
}

/**
 * Assemble the create-ready drafts for ItemImporter.createItems, carrying the
 * type-appropriate mechanics through (this is the pass-through `_onCreate` was
 * missing). `properties` (resolved UUIDs) rides along when present, as does
 * `unmappedProps` — unsupported WR property labels buildItemData appends to the
 * description; `lanceProperties` — the three evidenced Lance names the commit
 * prepass materializes; `sourceTitle` stamps `system.source.title` for
 * char-builder gating.
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
    } : {}),
    ...(gearType === "Armor" ? {
      ac: it.ac ?? { base: 0, modifier: 0, attribute: "" },
      baseArmor: it.baseArmor ?? "",
    } : {}),
    // Both stat-carrying types read the same two property lists; kept in one
    // place so a change to either can't land on only one of them.
    ...(gearType === "Weapon" || gearType === "Armor" ? {
      propNames: it.propNames ?? [],
      unmappedProps: it.unmappedProps ?? [],
    } : {}),
    ...(gearType === "Weapon" && Array.isArray(it.lanceProperties) && it.lanceProperties.length
      ? { lanceProperties: [...it.lanceProperties] } : {}),
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
