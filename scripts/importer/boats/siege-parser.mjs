/**
 * Shadowdark Enhancer — Western Reaches siege-weapons parser.
 *
 * Turns the WR Player's Guide p.119 SIEGE WEAPONS table — grabbed from the
 * user's OWN PDF — into Shadowdark **Weapon** item drafts + a **Siege Weapon
 * Ammunition** item, fed through the same item preview + commit path as every
 * other item. No stats are bundled: SIEGE_MANIFEST holds names + the p119 cite;
 * the numbers, and the Blast/Exploding property text, come from the page.
 *
 * The weapon drafts carry a `siegeProperties: [{name, description}]` list (Blast
 * / Exploding) that the commit turns into real Property items (they aren't in
 * the core shadowdark.properties pack). Ammo carries `isAmmunition: true`.
 *
 * Exports:
 *   SIEGE_SOURCE / SIEGE_MANIFEST  — names + WR p119 cite
 *   parseSiegeWeapons(text)        — table → drafts (pure, node-tested)
 */

export const SIEGE_SOURCE = { key: "WR", page: "119", label: "Western Reaches" };

/** The four named WR siege weapons — NAMES + source only. */
export const SIEGE_MANIFEST = [
  "Ballista", "Catapult", "Crossbow, heavy", "Trebuchet",
].map((name) => ({ name, src: SIEGE_SOURCE.key, page: SIEGE_SOURCE.page }));

const NAMES = SIEGE_MANIFEST.map((s) => s.name);
const TYPE_CODE = { M: "melee", R: "ranged" };
const RANGE_CODE = { C: "close", N: "near", F: "far" };
const PROP_NAME = { B: "Blast", E: "Exploding" };
const SIEGE_GEAR_SLOTS = 30;   // WR p119: each siege weapon occupies 30 gear slots
const SIEGE_AMMO_NAME = "Siege Weapon Ammunition";

const esc = (n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const nameOf = (s) => NAMES.find((n) => n.toLowerCase() === String(s ?? "").toLowerCase());

/**
 * Parse the Blast/Exploding property definitions off the page. Each is
 * `<Name> (<Letter>). <text…>` continuing over wrapped lines until the next
 * definition or a structural boundary. Returns { B: {name, description}, … }.
 */
function parsePropertyDefs(lines) {
  const defs = {};
  const startRe = /^(Blast|Exploding)\s*\(([BE])\)\.\s*(.*)$/i;
  const boundaryRe = /^(SIEGE WEAPONS|Siege Weapons|Type\s+Range|Weapon\s+Cost|Ballista|Catapult|Trebuchet|Crossbow|Ammunition|Gear Slots|Assembly|Operating|\d+\s*$)/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(startRe);
    if (!m) continue;
    const parts = m[3] ? [m[3]] : [];
    for (let j = i + 1; j < lines.length; j++) {
      if (startRe.test(lines[j]) || boundaryRe.test(lines[j])) break;
      parts.push(lines[j]);
    }
    defs[m[2].toUpperCase()] = {
      name: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(),
      description: parts.join(" ").replace(/\s+/g, " ").trim(),
    };
  }
  return defs;
}

/** Build one Weapon draft from raw cells (null when the name is unknown). */
function makeDraft(name, cost, typeCode, rangeCode, damage, propsRaw, defs) {
  name = nameOf(name);
  if (!name) return null;
  propsRaw = String(propsRaw ?? "").trim();
  const letters = (propsRaw && propsRaw !== "-")
    ? propsRaw.split(/[,\s]+/).map((t) => t.trim().toUpperCase()).filter((l) => PROP_NAME[l])
    : [];
  const siegeProperties = letters.map((l) => ({
    name: PROP_NAME[l],
    description: defs?.[l]?.description ? `<p>${defs[l].description}</p>` : "",
  }));
  // Shadowdark's weapon damage field holds a SINGLE die (d6, d8…) — it can't
  // represent a siege weapon's multi-die damage (3d6). Store the base die so the
  // weapon sheet populates, and keep the full formula in a flag for the boat's
  // Damage roll + its Weapons tab + the description.
  const full = String(damage);
  const dm = full.match(/^(\d*)d(\d+)$/i);
  const die = dm ? `d${dm[2]}` : full;
  return {
    name,
    type: "Weapon",
    wtype: TYPE_CODE[String(typeCode).toUpperCase()] ?? "ranged",
    range: RANGE_CODE[String(rangeCode).toUpperCase()] ?? "far",
    damage: { oneHanded: die, twoHanded: "" },
    cost: { gp: Number(String(cost).replace(/[, ]|gp/gi, "")) },
    slots: { per_slot: 1, slots_used: SIEGE_GEAR_SLOTS },
    ammoClass: SIEGE_AMMO_NAME,   // links the weapon's ammunition field to the ammo item
    siegeProperties,   // resolved to real Property items at commit
    // siegeWeapon: the boat sheet classifies mounts by this flag (not item type),
    // so ordinary weapons don't masquerade as siege weapons. siegeDamage: full
    // "3d6" for the boat's Damage roll.
    flags: { "shadowdark-enhancer": { siegeWeapon: true, siegeDamage: full } },
    description: `<p>Siege weapon (Western Reaches, p119). Damage <strong>${full}</strong>. Occupies ${SIEGE_GEAR_SLOTS} gear slots.</p>`,
    source: { title: "western-reaches" },
  };
}

/** The generic siege ammunition item (WR p119: 1 gp / piece, 2 gear slots). */
function ammoDraft() {
  return {
    name: SIEGE_AMMO_NAME,
    type: "Basic",
    isAmmunition: true,
    cost: { gp: 1 },
    slots: { per_slot: 1, slots_used: 2 },
    description: "<p>Siege weapon ammunition (Western Reaches, p119). 1 gp per piece; each occupies 2 gear slots.</p>",
    source: { title: "western-reaches" },
  };
}

/**
 * Parse the WR siege-weapons table into Weapon drafts + one ammunition item.
 * Handles the two-column split table a PDF grab produces (a `Weapon Cost` half
 * and a `Type Range Damage Properties` half, zipped by row) and a whole-row
 * paste. Surrounding prose (and the property definitions) is read, not dropped.
 * @param {string} text
 * @returns {Array<object>} weapon drafts followed by the ammunition draft
 */
export function parseSiegeWeapons(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length);
  const defs = parsePropertyDefs(lines);
  const nameAlt = NAMES.map(esc).join("|");

  // Split-table: left half `<name> <cost> gp`, right half `<type> <range> <dmg> <props>`.
  const leftRe = new RegExp(`^(${nameAlt})\\s+([\\d,]+)\\s*gp$`, "i");
  const left = [];
  for (const l of lines) {
    const m = l.match(leftRe);
    if (m) left.push({ name: m[1], cost: m[2] });
  }
  const hdr = lines.findIndex((l) => /^Type\s+Range\s+Damage\s+Properties/i.test(l));
  const right = [];
  if (hdr >= 0) {
    for (let i = hdr + 1; i < lines.length; i++) {
      const m = lines[i].match(/^([MR])\s+([CNF])\s+(\d*d\d+)\s+(.+)$/i);
      if (!m) break;
      right.push({ type: m[1], range: m[2], damage: m[3], props: m[4] });
    }
  }
  let weapons = [];
  if (left.length >= 2 && left.length === right.length) {
    weapons = left
      .map((L, i) => makeDraft(L.name, L.cost, right[i].type, right[i].range, right[i].damage, right[i].props, defs))
      .filter(Boolean);
  } else {
    // Whole-row fallback: `Ballista 150 gp R F 3d6 E`.
    const seen = new Set();
    const rowRe = new RegExp(`^(${nameAlt})\\s+([\\d,]+)\\s*gp\\s+([MR])\\s+([CNF])\\s+(\\d*d\\d+)\\s+(.+)$`, "i");
    for (const l of lines) {
      const m = l.match(rowRe);
      if (!m) continue;
      const d = makeDraft(m[1], m[2], m[3], m[4], m[5], m[6], defs);
      if (d && !seen.has(d.name)) { seen.add(d.name); weapons.push(d); }
    }
  }
  return weapons.length ? [...weapons, ammoDraft()] : [];
}
