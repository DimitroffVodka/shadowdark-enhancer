/**
 * Shadowdark Enhancer — Patron Items for imported boon tables (#167)
 *
 * The Character Builder, the system's own character generator, and the
 * system's level-up all find a Warlock's patrons the same way:
 * `shadowdark.compendiums.patrons()`, which walks the Item compendium PACKS
 * for type "Patron" and follows `system.boonTable`. A boon table on its own is
 * therefore invisible, and so is a Patron Item in the world Items directory.
 * This module makes the Item in the suite's `patrons-and-deities` pack
 * whenever a WR boon table is imported, and the tables carry the system's
 * name ("Patron Boons: Freya") so the system's Patron sheet dropdown, which
 * filters on that prefix, lists them too.
 *
 * The Item's description is the patron's blurb printed above the boon table
 * (WR pp.208-223), the same shape as the system's own Patron descriptions.
 * It is read off the page text the import pastes, or pulled from the linked
 * WR PDF by the hub's Tools action for worlds that imported before this.
 *
 * The six Cursed Scroll 1 patrons ship in the system with their own Items and
 * tables; only WR_PATRONS are handled here.
 */
import { MODULE_ID } from "../../shared/module-id.mjs";
import { escapeHtml } from "../pdf-text-utils.mjs";
import { WR_PATRONS } from "./table-folders.mjs";

const PREFIX = "Patron Boons: ";
/** Pre-0.18 name for the same table: "Freya Boons". */
const LEGACY = /^(.+?)\s+Boons$/i;
/** The system's own Patron icon, so ours sit beside the CS1 six without a seam. */
const PATRON_IMG = "icons/magic/unholy/silhouette-light-fire-blue.webp";

/** "Patron Boons: Freya" | "Freya Boons" → "Freya"; not a WR patron table → null. */
export function patronNameFromTable(name) {
  const n = String(name ?? "").replace(/\s+/g, " ").trim();
  const patron = n.startsWith(PREFIX) ? n.slice(PREFIX.length).trim() : (n.match(LEGACY)?.[1] ?? "");
  return WR_PATRONS.find((p) => p.toLowerCase() === patron.toLowerCase()) ?? null;
}

/** The system's name for a patron's boon table. */
export function patronBoonTableName(patron) { return `${PREFIX}${patron}`; }

/**
 * The patron's blurb off a WR patron page: every prose line above the
 * "<PATRON> BOONS" caption, minus the page's own name line, the seeded paste
 * title, bare page numbers and any other caption. One paragraph of HTML, or
 * "" when the caption is not on the page.
 *
 * ponytail: blurb only. The single-column grab the boon-table import uses
 * welds DEMANDS and IN THE REACHES into one line per row (they sit side by
 * side under the table), so those need a second, gutter-split grab to read
 * cleanly. Add that pass here if the lore is wanted; the system's own Patron
 * descriptions are the blurb alone.
 */
export function patronBlurbFromPage(text, patron) {
  const norm = (s) => String(s).replace(/\s+/g, " ").trim();
  const lines = String(text ?? "").split(/\r?\n/).map(norm).filter(Boolean);
  const caption = `${patron} BOONS`.toUpperCase();
  const at = lines.findIndex((l) => l.toUpperCase() === caption);
  if (at === -1) return "";
  const skip = new Set([patron, patronBoonTableName(patron)].map((s) => s.toLowerCase()));
  const isCaption = (l) => /[A-Z]{2}/.test(l) && l === l.toUpperCase();
  const kept = lines.slice(0, at)
    .filter((l) => !skip.has(l.toLowerCase()) && !/^\d+$/.test(l) && !isCaption(l));
  // The page heading may carry an epithet ("Obe-Ixx of Azarumme"): a first
  // line that is the name plus a few words and no punctuation is the heading,
  // not the blurb's first wrapped line ("Oros is a lesser god of power,").
  const head = kept[0] ?? "";
  if (head.toLowerCase().startsWith(patron.toLowerCase())) {
    const rest = head.slice(patron.length).trim();
    if (!/[.,;:!?]/.test(rest) && rest.split(/\s+/).filter(Boolean).length <= 3) kept.shift();
  }
  const blurb = kept.join(" ");
  return blurb ? `<p>${escapeHtml(blurb)}</p>` : "";
}

/** Short stable hash of a description, so a later import can tell the
 *  module's own text (safe to refresh) from a GM's edit (never touched). */
export function descriptionHash(html) {
  let h = 5381;
  for (const ch of String(html ?? "")) h = ((h * 33) ^ ch.codePointAt(0)) >>> 0;
  return h.toString(16);
}

/** Create-shaped data for a Patron Item wired to its boon table. */
export function patronItemData(patron, tableUuid, description = "") {
  return {
    name: patron, type: "Patron", img: PATRON_IMG,
    // "western-reaches" is the source slug this module registers with the
    // system, so the system's source filter keeps the Item when WR is ticked.
    system: { boonTable: tableUuid, source: { title: "western-reaches" }, ...(description ? { description } : {}) },
    flags: { [MODULE_ID]: { imported: true, source: "WR", ...(description ? { descriptionHash: descriptionHash(description) } : {}) } },
  };
}

const BLANK = /^(\s|<p>\s*<\/p>|<br\s*\/?>)*$/i;

/**
 * Find-or-create the Patron Item for a WR boon table and point it at the
 * table. Re-links an existing Item whose table was replaced (new uuid), and
 * writes `description` when the Item has none yet or still carries the
 * module's own text (hash match) — a GM's edit is never overwritten.
 * Returns `{ id, changed }`, or null when the table is not a WR patron table.
 */
export async function ensurePatronItem(table, { description = "" } = {}) {
  const patron = patronNameFromTable(table?.name);
  if (!patron) return null;
  const { findSuitePack, ensureSuite, cleanImportHtml } = await import("../../shared/compendium-suite.mjs");
  // ensureSuite() reconfigures every suite pack (a dozen server round trips),
  // so only pay for it the first time, when the pack does not exist yet.
  const pack = findSuitePack("patrons-and-deities") ?? (await ensureSuite())?.patrons;
  if (!pack) return null;
  const desc = description ? cleanImportHtml(description) : "";
  const idx = await pack.getIndex({ fields: ["type", "system.boonTable", "system.description", "flags"] });
  const hit = idx.find((e) => e.type === "Patron" && e.name === patron);
  if (!hit) {
    const created = await Item.create(patronItemData(patron, table.uuid, desc), { pack: pack.collection });
    return created ? { id: created.id, changed: true } : null;
  }
  const update = {};
  if (hit.system?.boonTable !== table.uuid) update["system.boonTable"] = table.uuid;
  const current = hit.system?.description ?? "";
  const ours = BLANK.test(current) || hit.flags?.[MODULE_ID]?.descriptionHash === descriptionHash(current);
  if (desc && ours && current !== desc) {
    update["system.description"] = desc;
    update[`flags.${MODULE_ID}.descriptionHash`] = descriptionHash(desc);
  }
  if (!Object.keys(update).length) return { id: hit._id, changed: false };
  const doc = await pack.getDocument(hit._id);
  await doc.update(update);
  return { id: hit._id, changed: true };
}

/**
 * Bring an already-imported world up to date: rename pre-0.18 "<God> Boons"
 * tables to the system scheme and make sure every WR boon table has its
 * Patron Item. Touches nothing in a world that never imported one.
 */
export async function backfillPatronItems() {
  const out = { renamed: 0, linked: 0 };
  const { findSuitePack } = await import("../../shared/compendium-suite.mjs");
  const tables = findSuitePack("sde-tables");
  if (!tables) return out;
  const idx = await tables.getIndex();
  const names = new Set(idx.map((e) => e.name));
  // Steady state (every GM load) must cost index reads only, no document
  // fetches: a table already under the system name and already linked is skipped.
  const ppack = findSuitePack("patrons-and-deities");
  const pIdx = ppack ? await ppack.getIndex({ fields: ["type", "system.boonTable"] }) : [];
  for (const e of idx) {
    const patron = patronNameFromTable(e.name);
    if (!patron) continue;
    const want = patronBoonTableName(patron);
    // A world holding both the old and the new name keeps both: the
    // system-named copy takes the link and the legacy copy is left alone.
    if (e.name !== want && names.has(want)) continue;
    const uuid = `Compendium.${tables.collection}.RollTable.${e._id}`;
    if (e.name === want && pIdx.some((p) => p.type === "Patron" && p.name === patron && p.system?.boonTable === uuid)) continue;
    const table = await tables.getDocument(e._id);
    if (table.name !== want) { await table.update({ name: want }); out.renamed++; }
    if ((await ensurePatronItem(table))?.changed) out.linked++;
  }
  return out;
}

/**
 * WR patrons whose Patron Item exists but still has no description — a world
 * that imported before 0.17.2. The Manage tree offers "Fill description" on
 * exactly those rows, and the button goes away once the text is in.
 */
export async function patronsMissingDescription() {
  const out = new Set();
  const { findSuitePack } = await import("../../shared/compendium-suite.mjs");
  const pack = findSuitePack("patrons-and-deities");
  if (!pack) return out;
  for (const e of await pack.getIndex({ fields: ["type", "system.description"] })) {
    if (e.type === "Patron" && WR_PATRONS.includes(e.name) && BLANK.test(e.system?.description ?? "")) out.add(e.name);
  }
  return out;
}

/**
 * Manage-tree action ("Fill description" on a patron row, "Fill all" on the
 * Boons folder): read each imported WR patron's page out of the linked
 * Western Reaches PDF and fill the Patron Items that still have no
 * description (or only the module's own). `only` narrows it to named patrons.
 */
export async function fillPatronDescriptions({ only = null } = {}) {
  const { sourcePdfTarget } = await import("../source-pdf-registry.mjs");
  const { findSuitePack } = await import("../../shared/compendium-suite.mjs");
  const tables = findSuitePack("sde-tables");
  const pIdx = findSuitePack("patrons-and-deities")
    ? await findSuitePack("patrons-and-deities").getIndex({ fields: ["type"] }) : [];
  if (!tables || !pIdx.some((e) => e.type === "Patron")) {
    ui.notifications.warn("No Western Reaches patron is imported yet — import a patron's boon table first.");
    return null;
  }
  const { tablePagesFor } = await import("../char-content/char-content-manifest.mjs");
  const { extractPdfText } = await import("../pdf-text-extract.mjs");
  const tIdx = await tables.getIndex();
  const out = { filled: 0, kept: 0, missing: 0 };
  let announced = false;
  for (const patron of only ? WR_PATRONS.filter((p) => only.includes(p)) : WR_PATRONS) {
    const tableName = patronBoonTableName(patron);
    const t = tIdx.find((e) => e.name === tableName);
    if (!t || !pIdx.some((e) => e.type === "Patron" && e.name === patron)) { out.missing++; continue; }
    const target = sourcePdfTarget("WR", tablePagesFor("WR", tableName));
    if (!target) {
      ui.notifications.warn("No Western Reaches PDF is linked. Use Tools → Source PDFs to upload it first.");
      return null;
    }
    if (!announced) { ui.notifications.info("Reading patron pages from your Western Reaches PDF…"); announced = true; }
    // Same single-column mode the boon-table unlock grabs with, so the blurb
    // parses identically whichever way it arrives.
    const { text } = await extractPdfText(target.file, { pages: [target.page], columns: "1" });
    const description = patronBlurbFromPage(text, patron);
    const r = description
      ? await ensurePatronItem({ name: tableName, uuid: `Compendium.${tables.collection}.RollTable.${t._id}` }, { description })
      : null;
    if (r?.changed) out.filled++; else out.kept++;
  }
  ui.notifications.info(`Patron descriptions: ${out.filled} filled, ${out.kept} already set or edited by hand, ${out.missing} not imported.`);
  return out;
}
