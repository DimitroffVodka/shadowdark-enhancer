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
 * LAYOUTS. p119 prints the table full width on a two-column page, so a grab can
 * hand us the row three ways, and the parser reads all of them off one cell
 * grammar (name · cost · type · range · damage · properties):
 *   - whole row on one line       — `Ballista 150 gp R F 3d6 E`
 *   - one cell per line           — the name, then the cells, each on its own
 *   - split at the page gutter    — a `Weapon Cost` half above a
 *                                   `Type Range Damage Properties` half
 * The split halves are paired by the column they MEET at, so a cell the gutter
 * pushed to the wrong side costs that one row, never the whole table.
 *
 * Exports:
 *   SIEGE_SOURCE / SIEGE_MANIFEST  — names + WR p119 cite
 *   parseSiegeTable(text)          — the same parse + why it came up short
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

/**
 * Normalized name key: lowercased, punctuation → spaces, words SORTED. Sorting
 * collapses "Crossbow, heavy", "Crossbow (heavy)" and "Heavy crossbow" onto one
 * key, so a printing's punctuation or word order can't cost us the row. It used
 * to cost the whole TABLE: the split halves were zipped only when their counts
 * matched exactly, so one unread name dropped all four weapons.
 */
const nameKey = (s) => String(s ?? "").toLowerCase()
  .replace(/[(),.;:]/g, " ")
  .trim().split(/\s+/).filter(Boolean)
  .sort()
  .join(" ");

const NAME_BY_KEY = new Map(NAMES.map((n) => [nameKey(n), n]));
// A bare "Crossbow" in THIS table is the heavy one — a row still has to carry
// the siege stat cells to be read as a row at all, so a core-gear crossbow
// can't slip in on the name alone.
NAME_BY_KEY.set("crossbow", "Crossbow, heavy");

/** The manifest name a cell string denotes, or null. */
const canonicalName = (s) => NAME_BY_KEY.get(nameKey(s)) ?? null;

const tokens = (s) => String(s ?? "").trim().split(/\s+/).filter(Boolean);

/**
 * The row's cells, in the order the table prints them. A grab may split the row
 * anywhere along this list (see LAYOUTS above). `props` is the only one a row
 * may omit: a weapon with no properties prints a dash, but nothing guarantees
 * the cell isn't simply left blank, and a missing dash must not cost the row.
 */
const CELLS = ["cost", "type", "range", "damage", "props"];
const DAMAGE_CELL = CELLS.indexOf("damage");

/** Cell readers: (tokens, i) → { value, next } or null. */
const CELL_READERS = {
  cost(toks, i) {
    const m = /^([\d,]+)\s*gp$/i.exec(toks[i] ?? "");
    if (m) return { value: m[1], next: i + 1 };
    // "150" and "gp" arrive as separate runs when the cell is padded.
    if (/^[\d,]+$/.test(toks[i] ?? "") && /^gp$/i.test(toks[i + 1] ?? "")) {
      return { value: toks[i], next: i + 2 };
    }
    return null;
  },
  type(toks, i) {
    const m = /^([MR])$/i.exec(toks[i] ?? "");
    return m ? { value: m[1].toUpperCase(), next: i + 1 } : null;
  },
  range(toks, i) {
    const m = /^([CNF])$/i.exec(toks[i] ?? "");
    return m ? { value: m[1].toUpperCase(), next: i + 1 } : null;
  },
  damage(toks, i) {
    const m = /^(\d*d\d+)$/i.exec(toks[i] ?? "");
    return m ? { value: m[1].toLowerCase(), next: i + 1 } : null;
  },
  props(toks, i) {
    // Every dash the books use for "none", not just ASCII.
    if (/^[-–—]$/.test(toks[i] ?? "")) return { value: "-", next: i + 1 };
    const letters = [];
    let j = i;
    while (/^[BE][,;]?$/i.test(toks[j] ?? "")) { letters.push(toks[j][0].toUpperCase()); j++; }
    return letters.length ? { value: letters.join(", "), next: j } : null;
  },
};

/**
 * Read consecutive cells from `CELLS[from]` onward, stopping at the first that
 * doesn't match.
 * @returns {{values:object, end:number, next:number}} `end` is the cell index
 *   reached (exclusive), `next` the token index after the last cell read.
 */
function readCells(toks, i, from) {
  const values = {};
  let k = from;
  for (; k < CELLS.length; k++) {
    const r = CELL_READERS[CELLS[k]](toks, i);
    if (!r) break;
    values[CELLS[k]] = r.value;
    i = r.next;
  }
  return { values, end: k, next: i };
}

/** A weapon name starting at token `i` (names run to two words), or null. */
function matchNameAt(toks, i) {
  for (let n = Math.min(2, toks.length - i); n >= 1; n--) {
    const name = canonicalName(toks.slice(i, i + n).join(" "));
    if (name) return { name, next: i + n };
  }
  return null;
}

/** True when the tokens are a bare stat half reaching at least the damage die.
 *  Requiring the die is what tells a table half from a stray "1 gp" in prose. */
function statHalfAt(toks, from) {
  const c = readCells(toks, 0, from);
  return (c.end > DAMAGE_CELL && c.next === toks.length) ? c : null;
}

/** True when any token in the line starts a weapon name. */
const hasName = (toks) => toks.some((_, k) => matchNameAt(toks, k));

/**
 * Re-join a name cell the grab wrapped over two lines. A narrow Weapon column
 * breaks "Crossbow, heavy" after the comma, and the fragment alone already
 * reads as the whole name — so the leftover word would sit at the head of the
 * next line and hide the cells behind it.
 */
function joinWrappedNames(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const toks = tokens(lines[i]);
    const next = tokens(lines[i + 1] ?? "");
    const hit = matchNameAt(toks, 0);
    if (hit && hit.next === toks.length && next.length
        && canonicalName([...toks, next[0]].join(" "))) {
      out.push([...toks, ...next].join(" "));
      i++;
      continue;
    }
    out.push(lines[i]);
  }
  return out;
}

/** Rows printed whole on one line — `Ballista 150 gp R F 3d6 E`. */
function scanWholeRows(lines) {
  const rows = [];
  for (const line of lines) {
    const toks = tokens(line);
    for (let i = 0; i < toks.length; i++) {
      const hit = matchNameAt(toks, i);
      if (!hit) continue;
      const c = readCells(toks, hit.next, 0);
      if (c.end <= DAMAGE_CELL) continue;
      rows.push({ name: hit.name, ...c.values });
      i = c.next - 1;
    }
  }
  return rows;
}

/**
 * Rows the grab broke one cell per line: a line holding ONLY the name, then its
 * cells down the following lines.
 *
 * The name must sit alone on its line. A line carrying the name AND some of its
 * cells is the left half of a gutter-split table, and reading on past its end
 * would weld the FIRST row of the right half onto the LAST name of the left —
 * a complete, plausible, wrong row. Those halves are scanSplitRows' business.
 */
function scanStackedRows(lines) {
  const rows = [];
  for (let i = 0; i < lines.length; i++) {
    const head = tokens(lines[i]);
    const hit = matchNameAt(head, 0);
    if (!hit || hit.next !== head.length) continue;   // the name, and nothing else
    const rest = [];
    for (let j = i + 1; j < lines.length; j++) {
      const toks = tokens(lines[j]);
      if (hasName(toks)) break;                       // the next row starts
      rest.push(...toks);
      // A full row is eight tokens at the outside ("1,000 gp" splits in two,
      // "B, E" into two more); past that we are reading the page, not a row.
      if (rest.length > 8) break;
    }
    const c = readCells(rest, 0, 0);
    if (c.end > DAMAGE_CELL) rows.push({ name: hit.name, ...c.values });
  }
  return rows;
}

/**
 * Rows recovered from a table the page gutter split in two: a `<name> …` half
 * and a bare `<cells>` half, each in row order.
 *
 * Halves are grouped by the cell the split falls on and paired within a group,
 * rather than zipped as two flat lists. A cell the gutter RELOCATES (the split
 * lands a column earlier for one row) moves that row's boundary alone: a flat
 * zip mismatches by one and drops all four weapons, while grouping pairs that
 * row on its own boundary and keeps the rest. A seeded title line is dropped by
 * name, since a name heads only one row of the table.
 *
 * A cell the gutter CORRUPTS is a different thing and is NOT recovered here.
 * "333 gp" arriving as "3 33gp" stops that line reading as a head at all, and
 * nothing left in the text says which tail it had been aligned with — pairing
 * the survivors by position would silently hand one weapon another's stats,
 * which is the failure mode this whole file is arranged to avoid. The group is
 * dropped and diagnose() tells the GM the split ran through the table and to
 * re-grab the page. Pinned in siege-parser.test.mjs.
 */
function scanSplitRows(lines) {
  const heads = [];
  const tails = [];
  for (const line of lines) {
    const toks = tokens(line);
    if (!toks.length) continue;
    const hit = matchNameAt(toks, 0);
    if (hit) {
      const c = readCells(toks, hit.next, 0);
      if (c.next === toks.length) heads.push({ name: hit.name, at: c.end, values: c.values });
      continue;
    }
    for (let from = 0; from <= DAMAGE_CELL; from++) {
      const c = statHalfAt(toks, from);
      if (c) { tails.push({ at: from, values: c.values }); break; }
    }
  }
  const rows = [];
  for (const at of new Set(heads.map((h) => h.at))) {
    // A name can only head one row of the table, so a repeat is the seeded
    // title line, not a fifth weapon. Grouping alone sorts that out whenever
    // the split leaves a cell on the head (the title, carrying none, lands in
    // its own group and finds no tails) — but when the split falls at the name
    // column every head carries none either, title included, and the extra
    // name unbalanced the whole group into being dropped.
    const seen = new Set();
    const H = heads.filter((h) => h.at === at && !seen.has(h.name) && seen.add(h.name));
    const T = tails.filter((t) => t.at === at);
    if (!T.length || H.length !== T.length) continue;
    H.forEach((h, i) => rows.push({ name: h.name, ...h.values, ...T[i].values }));
  }
  return rows;
}

/** Headings and captions on p119 that end a property definition. */
const SECTION_RE = /^(SIEGE\s+WEAPONS|Weapon\s+Cost|Cost\s+Type|Type\s+Range|Damage\s+Properties|Ammunition|Gear\s+Slots|Assembly|Operating)\b/i;

/** True when a line ends the property definition above it. */
function isDefBoundary(line) {
  if (SECTION_RE.test(line)) return true;
  if (/^\d{1,4}$/.test(line)) return true;                  // bare page footer
  if (/^[A-Z][A-Z &/,'’-]{3,}$/.test(line)) return true;    // ALL-CAPS caption
  const toks = tokens(line);
  if (!toks.length) return true;
  if (matchNameAt(toks, 0)) return true;                    // a table row
  for (let from = 0; from <= DAMAGE_CELL; from++) if (statHalfAt(toks, from)) return true;
  return false;
}

/**
 * Pick between two readings of the same property's rule text. A grab can offer
 * both: a column-split pass truncates the definition where the gutter cuts it,
 * a single-column pass welds the neighbouring column's words onto it. Prefer
 * text that ends on a sentence, then the shorter one — the welded reading is
 * the one carrying words that aren't its own.
 */
function betterDef(a, b) {
  if (!a?.description) return b;
  if (!b?.description) return a;
  const whole = (d) => /[.!?]["')\]]?$/.test(d.description);
  if (whole(a) !== whole(b)) return whole(a) ? a : b;
  return a.description.length <= b.description.length ? a : b;
}

/**
 * Parse the Blast/Exploding property definitions off the page. Each is
 * `<Name> (<Letter>). <text…>` continuing over wrapped lines until the next
 * definition or a structural boundary. Returns { B: {name, description}, … }.
 */
function parsePropertyDefs(lines) {
  const defs = {};
  const startRe = /^(Blast|Exploding)\s*\(([BE])\)[.:]?\s*(.*)$/i;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(startRe);
    if (!m) continue;
    const parts = m[3] ? [m[3]] : [];
    for (let j = i + 1; j < lines.length; j++) {
      if (startRe.test(lines[j]) || isDefBoundary(lines[j])) break;
      parts.push(lines[j]);
    }
    const letter = m[2].toUpperCase();
    defs[letter] = betterDef(defs[letter], {
      name: m[1][0].toUpperCase() + m[1].slice(1).toLowerCase(),
      description: parts.join(" ").replace(/\s+/g, " ").trim(),
    });
  }
  return defs;
}

/** Build one Weapon draft from raw cells (null when the name is unknown). */
function makeDraft(name, cost, typeCode, rangeCode, damage, propsRaw, defs) {
  name = canonicalName(name);
  if (!name) return null;
  propsRaw = String(propsRaw ?? "").trim();
  const letters = (propsRaw && !/^[-–—]$/.test(propsRaw))
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

/** Every manifest name the text mentions at all, in manifest order. */
function namesMentioned(lines) {
  const seen = new Set();
  for (const line of lines) {
    const toks = tokens(line);
    for (let i = 0; i < toks.length; i++) {
      const hit = matchNameAt(toks, i);
      if (hit) seen.add(hit.name);
    }
  }
  return NAMES.filter((n) => seen.has(n));
}

/**
 * Why a parse came up short, in words the GM can act on — they hold the book
 * and we can't see it, so "nothing found" has to say what was actually there.
 * @returns {string|null} null when all four weapons parsed
 */
function diagnose(parsed, missing, mentioned) {
  if (!parsed.length) {
    return mentioned.length
      ? `Siege weapons: found ${mentioned.length} name${mentioned.length === 1 ? "" : "s"} (${mentioned.join("; ")}) but no complete stat row, so the column split most likely ran through the table. Re-grab p119 with Open PDF (cites assume the V1 printing — another printing's front matter shifts every page), or paste its rows (Weapon · Cost · Type · Range · Damage · Properties).`
      : "No siege weapons found — paste the Western Reaches p119 SIEGE WEAPONS table. If you grabbed it from your PDF, open the page (Open PDF) and check it really is the SIEGE WEAPONS page: cites assume the V1 printing, and another printing's front matter shifts every page.";
  }
  return missing.length
    ? `Siege weapons: read ${parsed.length} of ${NAMES.length} — no stat row for ${missing.join("; ")}. Check that row against the page before Create.`
    : null;
}

/**
 * Parse the WR siege-weapons table, with a report of what didn't come through.
 * @param {string} text
 * @returns {{drafts:Array<object>, weapons:Array<object>, missing:string[],
 *   mentioned:string[], note:string|null}} `drafts` is the weapons plus the
 *   ammunition item (empty when no weapon parsed — no orphan ammunition).
 */
export function parseSiegeTable(text) {
  const lines = joinWrappedNames(
    String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length));
  const defs = parsePropertyDefs(lines);

  // Whole rows first: they arrive intact, so they win over a half-and-half
  // reconstruction of the same weapon when one grab supplies both shapes.
  const byName = new Map();
  for (const r of [...scanWholeRows(lines), ...scanStackedRows(lines), ...scanSplitRows(lines)]) {
    if (!byName.has(r.name)) byName.set(r.name, r);
  }

  const weapons = NAMES
    .map((n) => byName.get(n))
    .filter(Boolean)
    .map((r) => makeDraft(r.name, r.cost, r.type, r.range, r.damage, r.props, defs))
    .filter(Boolean);
  const missing = NAMES.filter((n) => !byName.has(n));
  const mentioned = namesMentioned(lines);
  return {
    drafts: weapons.length ? [...weapons, ammoDraft()] : [],
    weapons,
    missing,
    mentioned,
    note: diagnose(weapons, missing, mentioned),
  };
}

