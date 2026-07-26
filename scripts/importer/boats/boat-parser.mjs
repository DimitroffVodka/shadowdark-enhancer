/**
 * Shadowdark Enhancer — Western Reaches boats parser + importer.
 *
 * Turns the WR Player's Guide p.118 BOATS table — grabbed from the user's OWN
 * PDF (or pasted) — into `shadowdark-enhancer.boat` actor drafts. No stat data
 * is bundled: BOAT_MANIFEST holds the eight boat NAMES + source only (the same
 * sealed-content contract as the char-content manifest); every number comes
 * from the parsed page at import time.
 *
 * Exports:
 *   BOAT_SOURCE / BOAT_MANIFEST   — names + WR p118 cite (no stats)
 *   parseBoats(text)              — table → drafts (pure, node-tested)
 *   boatDraftToActorData(draft)   — draft → Actor.create data (pure)
 *   BoatImporter.createBoats(...)  — GM-gated, idempotent live commit
 */

import { MODULE_ID } from "../../shared/module-id.mjs";

export const BOAT_SOURCE = { key: "WR", page: "118", label: "Western Reaches" };

/** The eight named WR boats — NAMES + source only, never bundled stats. */
export const BOAT_MANIFEST = [
  "Canoe", "Galleon", "Junk", "Longboat", "Raft", "Rowboat", "Sailboat", "Sloop",
].map((name) => ({ name, src: BOAT_SOURCE.key, page: BOAT_SOURCE.page }));

const BOAT_NAMES = BOAT_MANIFEST.map((b) => b.name);

// WR (p118) property letter → BoatDataModel flag. R = Row Galley.
const PROP_FLAGS = { C: "crew", F: "fast", R: "rowGalley", U: "unseaworthy", W: "weapons" };
const PROP_NOTE = {
  crew: "Crew: needs 4+ trained crew aboard to move.",
  fast: "Fast: double near in combat.",
  rowGalley: "Row Galley: treats difficult terrain as normal terrain.",
  unseaworthy: "Unseaworthy: cumulative 1:6 sink each storm on the open sea.",
  weapons: "Weapons: may employ up to two siege weapons.",
};

const nameOf = (s) => BOAT_NAMES.find((n) => n.toLowerCase() === String(s ?? "").toLowerCase());
const isInt = (s) => /^\d+$/.test(s);
const isCost = (s) => /^[\d,]+\s*gp$/i.test(s);

/** Build one draft from raw cell strings (null when the name is unknown). */
function makeDraft(name, cost, speed, ac, hp, gearSlots, propsRaw) {
  name = nameOf(name);
  if (!name) return null;
  propsRaw = String(propsRaw ?? "").trim();
  const props = {};
  if (propsRaw && propsRaw !== "-") {
    for (const tok of propsRaw.split(/[,\s]+/)) {
      const flag = PROP_FLAGS[tok.trim().toUpperCase()];
      if (flag) props[flag] = true;
    }
  }
  return {
    name,
    cost: Number(String(cost).replace(/[, ]|gp/gi, "")),
    speed: Number(speed), ac: Number(ac), hp: Number(hp), gearSlots: Number(gearSlots),
    props, propsRaw: propsRaw || "-",
  };
}
/**
 * Split-table layout: a two-column page splits the table at the gutter into a
 * `Name Cost Speed` half and an `AC HP Gear Slots Properties` half, each in row
 * order. Zip the halves by row index when both are present and the same length.
 */
function parseSplitTable(lines) {
  const leftRe = new RegExp(`^(${BOAT_NAMES.join("|")})\\s+([\\d,]+)\\s*gp\\s+(\\d+)$`, "i");
  const left = [];
  for (const l of lines) {
    const m = l.match(leftRe);
    if (m) left.push({ name: m[1], cost: m[2], speed: m[3] });
  }
  if (left.length < 2) return [];
  const hdr = lines.findIndex((l) => /^AC\s+HP\s+Gear\s*Slots\s+Properties/i.test(l));
  const right = [];
  if (hdr >= 0) {
    for (let i = hdr + 1; i < lines.length; i++) {
      const m = lines[i].match(/^(\d+)\s+(\d+)\s+(\d+)\s+(.+)$/);
      if (!m) break;                       // numeric block ended
      right.push({ ac: m[1], hp: m[2], gearSlots: m[3], propsRaw: m[4] });
    }
  }
  if (right.length !== left.length) return [];
  return left
    .map((L, i) => makeDraft(L.name, L.cost, L.speed, right[i].ac, right[i].hp, right[i].gearSlots, right[i].propsRaw))
    .filter(Boolean);
}

/** Inline layouts: a whole boat on one line, or the name + six cells per line. */
function parseInline(lines) {
  const out = [];
  const seen = new Set();
  const rowRe = new RegExp(
    `^(${BOAT_NAMES.join("|")})\\s+([\\d,]+)\\s*gp\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(\\d+)\\s+(.+)$`, "i",
  );
  const push = (...cells) => {
    const d = makeDraft(...cells);
    if (d && !seen.has(d.name)) { seen.add(d.name); out.push(d); }
  };
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(rowRe);
    if (m) { push(m[1], m[2], m[3], m[4], m[5], m[6], m[7]); continue; }
    if (nameOf(lines[i])) {               // name alone, then six cells
      const c = lines.slice(i + 1, i + 7);
      if (c.length === 6 && isCost(c[0]) && isInt(c[1]) && isInt(c[2]) && isInt(c[3]) && isInt(c[4])) {
        push(lines[i], c[0], c[1], c[2], c[3], c[4], c[5]);
        i += 6;
      }
    }
  }
  return out;
}

/**
 * Parse the WR boats table into drafts. Handles every shape the page yields —
 * the two-column split table a PDF text-grab produces (Name/Cost/Speed and
 * AC/HP/Gear/Properties halves zipped by row), a whole boat on one line, and
 * the name-then-six-cells column layout. Surrounding intro prose, headers, and
 * the property legend are ignored.
 * @param {string} text
 * @returns {Array<{name:string,cost:number,speed:number,ac:number,hp:number,gearSlots:number,props:object,propsRaw:string}>}
 */
export function parseBoats(text) {
  const lines = String(text ?? "").split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length);
  const split = parseSplitTable(lines);
  const inline = parseInline(lines);
  return split.length >= inline.length ? split : inline;
}

/** Map a parsed boat draft to `shadowdark-enhancer.boat` Actor.create data. */
export function boatDraftToActorData(d) {
  const p = d.props ?? {};
  const notes = [`Cost: ${(d.cost ?? 0).toLocaleString()} gp.`];
  for (const flag of ["crew", "fast", "rowGalley", "unseaworthy", "weapons"]) {
    if (p[flag]) notes.push(PROP_NOTE[flag]);
  }
  return {
    name: d.name,
    type: `${MODULE_ID}.boat`,
    system: {
      boatType: d.name,
      cost: d.cost ?? 0,
      hp: { value: d.hp ?? 0, max: d.hp ?? 0 },
      ac: d.ac ?? 11,
      speed: d.speed ?? 0,
      gearSlots: { max: d.gearSlots ?? 0, used: 0 },
      crew: { required: p.crew ? 4 : 0, current: 0 },
      properties: {
        crew: !!p.crew, fast: !!p.fast, rowGalley: !!p.rowGalley,
        unseaworthy: !!p.unseaworthy, weapons: !!p.weapons,
      },
      notes: `<p>${notes.join(" ")}</p>`,
    },
  };
}
