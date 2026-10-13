/** Native offset records. Tags, keyed pages and regions remain their own authorities.
 * Private records live ONLY in a GM-only world JournalEntry compendium. World
 * journal flags reach every client even at NONE ownership in Foundry 14.
 * Pack ownership provides ordinary Foundry spoiler protection, not raw-data
 * confidentiality: deliberate document API access can bypass the UI boundary.
 * A separate OBSERVER journal carries an allowlisted disclosure projection, not a tag store.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { decodeTags, readCell, FEATURES, NOT_GROUND, normalizeTerrainWord } from "./tag-store.mjs";
import { hexPrint } from "./hex-prints.mjs";
import { hexNumberAt } from "./hex-number-api.mjs";
import { pinNumber } from "./extras-records.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { disclosure, effectiveDiscovery, bestProjection } from "./hex-fog-core.mjs";
import { Party } from "../party/party.mjs";
import { findSuitePack, sourceFolderName } from "../shared/compendium-suite.mjs";
import { HEX_FLAG } from "../importer/hex/hex-commit.mjs";
import { hexNum } from "../importer/hex/hex-dataset.mjs";
import { A0_PRINT } from "./a0-print.mjs";
import { WR_MAP_ID } from "./wr-keyed-art.mjs";

export const RECORD_FLAG = "hexRecords";
export const PUBLIC_FLAG = "hexRecordProjection";
export const PRIVATE_PACK = "world.shadowdark-enhancer--hex-records";
const privateJournals = new Map();
let loadedPack = null, loadPromise = null, packPromise = null;
export async function loadHexRecords() {
  if (!game.user?.isGM) return;
  const pack = game.packs?.get(PRIVATE_PACK);
  if (!pack) return;
  assertPrivatePack(pack);
  if (loadedPack === pack) return loadPromise;
  loadedPack = pack;
  loadPromise = pack.getDocuments().then(documents => {
    privateJournals.clear();
    for (const journal of documents) privateJournals.set(journal.id, journal);
  }).catch(error => { loadedPack = null; throw error; });
  return loadPromise;
}
export function assertPrivatePack(pack) {
  if (!pack || ["PLAYER", "TRUSTED", "ASSISTANT"].some(role => pack.ownership?.[role] !== "NONE")) throw new Error("SDE.hexRecords.unsafeStore");
}
export async function ensurePrivateHexPack() {
  if (!game.user?.isGM) throw new Error("SDE.hexRecords.gmOnly");
  if (packPromise) return packPromise;
  packPromise = createPrivateHexPack();
  try { return await packPromise; } finally { packPromise = null; }
}
async function createPrivateHexPack() {
  let pack = game.packs?.get(PRIVATE_PACK);
  if (!pack) {
    const Collection = foundry.documents.collections.CompendiumCollection;
    pack = await Collection.createCompendium({ name: "shadowdark-enhancer--hex-records", label: game.i18n.localize("SDE.hexRecords.packName"), type: "JournalEntry", packageType: "world",
      ownership: { GAMEMASTER: "OWNER", ASSISTANT: "NONE", TRUSTED: "NONE", PLAYER: "NONE" } });
    await pack.configure({ ownership: { GAMEMASTER: "OWNER", ASSISTANT: "NONE", TRUSTED: "NONE", PLAYER: "NONE" } });
  }
  assertPrivatePack(pack);
  if (pack.locked) await pack.configure({ locked: false });
  return pack;
}
export const cacheHexJournal = journal => privateJournals.set(journal.id, journal);
export const sceneRef = scene => typeof scene === "string" ? game.scenes?.get(scene.replace(/^Scene\./, "")) : scene ?? globalThis.canvas?.scene;
export const sceneUuid = scene => scene?.uuid ?? (scene?.id ? `Scene.${scene.id}` : null);
export const offsetKey = ({ i, j } = {}) => Number.isSafeInteger(i) && Number.isSafeInteger(j) ? `${i}_${j}` : null;
const clone = value => structuredClone(value);
let crawlNames = new Map();
/** GM only: each book's keyed row names, read ahead so the synchronous record read can fall back on them. Books number their hexes from the same range, so a name is only ever read from the scene's own book. */
export async function loadCrawlNames() {
  if (!globalThis.game?.user?.isGM) return;
  const [{ crawlEntries, keyedNames }, { sourceFolderName }, { HEX_FLAG }] = await Promise.all([
    import("./hex-region.mjs"), import("../shared/compendium-suite.mjs"), import("../importer/hex/hex-commit.mjs"),
  ]);
  const byBook = new Map();
  for (const entry of await crawlEntries()) {
    const folder = sourceFolderName(entry.getFlag(MODULE_ID, HEX_FLAG)?.source);
    byBook.set(folder, [...byBook.get(folder) ?? [], entry]);
  }
  crawlNames = new Map([...byBook].map(([folder, entries]) => [folder, keyedNames(entries)]));
}
const journals = () => globalThis.game?.journal?.contents ?? [];
/**
 * A pack applies every update to the one copy it holds and drops it after CACHE_LIFETIME_SECONDS idle; the next
 * update holds a fresh copy, and getDocuments() only ever returns new ones. A copy kept from load therefore reads
 * stale after the first idle gap: it publishes an empty view to players, and each write clones its old cells back
 * over the pack's. So take the pack's copy on every read and keep it as the fallback for when it is dropped.
 */
function privateJournal(id) {
  const held = globalThis.game?.packs?.get?.(PRIVATE_PACK)?.get?.(id);
  if (typeof held?.update === "function") privateJournals.set(id, held);
  return privateJournals.get(id);
}
export function recordJournal(scene, { publicOnly = false } = {}) {
  if (!publicOnly && !globalThis.game?.user?.isGM) return null;
  const flag = publicOnly ? PUBLIC_FLAG : RECORD_FLAG;
  const source = publicOnly ? journals() : [...privateJournals.keys()].map(privateJournal);
  const hits = source.filter(j => j.flags?.[MODULE_ID]?.[flag]?.sceneUuid === sceneUuid(scene));
  if (hits.length > 1) throw new Error("SDE.hexRecords.duplicateStore");
  return hits[0] ?? null;
}
/** One synchronous pass over many cells: the store journal, the decoded tag store and the pin index are read once. */
export function readPass(target) {
  return { scene: sceneRef(target) };
}
export const isHexAdopted = scene => sceneRef(scene)?.getFlag?.(MODULE_ID, RECORD_FLAG)?.adopted === true;

/** A keyed page's name without the hex number the book prints before it ("3826 Haldrin's Tower" → "Haldrin's Tower"). */
export const keyedTitle = keyed => String(keyed?.[0]?.title ?? "").replace(/^\d{3,4}\s*/, "").trim();

/** The crawl row's name for a hex: the scene's own book only (hexMapId, as the pinning step does), and only for a keyed hex. */
const rowNameOf = (scene, num, tag) => NOT_GROUND.has(tag?.terrain)
  ? crawlNames.get(hexPrint(scene.getFlag?.(MODULE_ID, "hexMapId"))?.folder)?.get(num) ?? "" : "";
/** Compose one cell without copying the tag store. Tag edits, even a removed line, win. */
export function recordView({ sceneUuid: uuid, offset, num, cell = {}, tag = null, keyed = [], region = null, rowName = "" }) {
  const structured = Array.isArray(cell.features) ? clone(cell.features) : [];
  const features = tag ? [
    ...structured.filter(f => !FEATURES.includes(typeof f === "string" ? f : f?.type)),
    ...(tag.features ?? []).map(type => structured.find(f => f?.type === type) ?? { type }),
  ] : structured.map(f => typeof f === "string" ? { type: f } : f);
  return { ...clone(cell), sceneUuid: uuid, offset: { ...offset }, num,
    terrain: tag ? tag.terrain : (normalizeTerrainWord(cell.terrain) || null), features,
    provenance: tag ? { source: tag.source, margin: tag.margin, review: !!tag.review } : cell.provenance ?? null,
    keyed: clone(keyed), region: region ?? cell.zone ?? null,
    discovery: { revealed: false, visited: false, ...(cell.discovery ?? {}) },
    // A title the GM typed wins; a keyed hex with none is named by its journal page, so the pin and the record agree,
    // and a scene with no pins by the crawl entry's keyed row.
    ...(!cell.title && (keyedTitle(keyed) || rowName) ? { title: keyedTitle(keyed) || rowName } : {}),
  };
}
const pick = (value, keys) => Object.fromEntries(keys.filter(k => typeof value?.[k] === "string").map(k => [k, value[k]]));
const locationVisible = discovery => disclosure(discovery, "location");
/** No spread of imported objects across the privacy boundary. Unknown fields stay private. */
export function playerProjection(record) {
  if (!disclosure(record?.discovery)) return null;
  const location = locationVisible(record.discovery);
  const out = { sceneUuid: record.sceneUuid, offset: { ...record.offset }, num: record.num,
    terrain: record.terrain, discovery: { revealed: true, visited: !!record.discovery.visited, locationRevealed: !!location },
    features: (record.features ?? []).filter(f => FEATURES.includes(f?.type) || f?.discovered === true && location)
      .map(f => pick(f, ["id", "type", "name", "uuid"])),
    notes: (record.notes ?? []).filter(n => n?.visible === true && (n.location !== true || location)).map(n => pick(n, ["id", "text"])),
  };
  if (location) {
    if (typeof record.title === "string") out.title = record.title;
    out.links = (record.links ?? []).filter(l => l?.visible === true).map(l => pick(l, ["uuid", "label"]));
  }
  return out;
}
/** Only the viewed scene's pins, never every same-numbered page in the world. */
function pinIndex(scene) {
  const out = new Map();
  for (const note of scene?.notes?.contents ?? []) {
    const num = pinNumber(note);
    if (num === null) continue;
    const entry = game.journal?.get?.(note.entryId), page = entry?.pages?.get?.(note.pageId);
    if (!page || !entry?.testUserPermission?.(game.user, "OBSERVER") || !page.testUserPermission?.(game.user, "OBSERVER")) continue;
    // An Enhancer pin and an Extras note can name the same page on one scene: one link.
    const list = out.get(num) ?? [];
    if (!list.some(k => k.uuid === page.uuid)) list.push({ uuid: page.uuid, title: page.name });
    out.set(num, list);
  }
  return out;
}
function keyedPages(scene, num, pass = null) {
  if (num === null) return [];
  if (pass) {
    pass.pins ??= pinIndex(scene);
    return (pass.pins.get(num) ?? []).map(entry => ({ ...entry }));
  }
  const out = [];
  for (const note of scene?.notes?.contents ?? []) {
    if (pinNumber(note) !== num) continue;
    const entry = game.journal?.get?.(note.entryId), page = entry?.pages?.get?.(note.pageId);
    if (!page || !entry?.testUserPermission?.(game.user, "OBSERVER") || !page.testUserPermission?.(game.user, "OBSERVER")) continue;
    if (!out.some(k => k.uuid === page.uuid)) out.push({ uuid: page.uuid, title: page.name });
  }
  return out;
}
/**
 * The print a scene's numbered hexes were made from: the map flow's own flag
 * (`hexMapId`; HEXMAP_FLAG in hex-map-flow.mjs, which this module never loads),
 * else — a painted copy carries none — the tagged hex field's bounds, the same
 * fallback the tagger reads for the Western Reaches print.
 * @returns {object|null} the book's facts (hex-prints.mjs), or null for a scene no book claims
 */
export function scenePrint(scene) {
  const byFlag = hexPrint(String(scene?.getFlag?.(MODULE_ID, "hexMapId") ?? "").split(":")[0]);
  if (byFlag) return byFlag;
  const b = scene?.getFlag?.(MODULE_ID, "hexTags")?.origin?.bounds;
  return b?.cols === A0_PRINT.bounds.cols && b?.rows === A0_PRINT.bounds.rows ? hexPrint(WR_MAP_ID) : null;
}
/**
 * The book's own journal pages for one hex number, found without any pin: the
 * scene's print, that book's crawl entries (the deployed world copy when the
 * pin step has placed one, else the pack copy), and the pages carrying this
 * number in their flag. Scoped to that book's entries, so another book's page
 * with the same number is never listed. GM path only; players keep the pins.
 * @returns {Promise<{book: boolean, imported: boolean, pages: Array<{uuid:string, title:string}>}>} `book` = the scene is
 *   tied to a known print; `imported` = that book's crawl entry was found, so an empty `pages` means this hex is not keyed
 */
export async function bookKeyedPages(scene, num) {
  const print = scenePrint(scene);
  if (!print) return { book: false, imported: false, pages: [] };
  const pack = findSuitePack("journal");
  let entries = [];
  if (pack) { try { entries = await pack.getDocuments(); } catch { entries = []; } }
  const out = [];
  let imported = false;
  for (const entry of entries) {
    const flag = entry.getFlag?.(MODULE_ID, HEX_FLAG);
    if (!flag?.crawl || sourceFolderName(flag.source) !== print.folder) continue;
    imported = true;
    if (!Number.isInteger(num)) continue;
    // The deployment keeps the pack entry's id, so the world copy is the same document the GM sees and may have edited.
    const pages = (globalThis.game?.journal?.get?.(entry.id) ?? entry).pages?.contents ?? [];
    for (const page of pages) {
      if (hexNum(page.getFlag?.(MODULE_ID, HEX_FLAG)?.num) !== num) continue;
      if (!out.some(k => k.uuid === page.uuid)) out.push({ uuid: page.uuid, title: page.name });
    }
  }
  return { book: true, imported, pages: out };
}
/** The keyed rows for one hex: the pinned pages first, then the book's own; one row per document. */
export function mergeKeyedPages(pins = [], book = []) {
  const out = [];
  for (const k of [...pins, ...book]) if (k?.uuid && !out.some(o => o.uuid === k.uuid)) out.push({ uuid: k.uuid, title: k.title });
  return out;
}
/** Patch fields a raw cell write may touch; the archive and arrival history stay out of reach. */
const WRITABLE_CELL_FIELDS = new Set(["title", "features", "notes", "links", "terrain", "rollTable", "rollTableChance", "rollTableFirstOnly"]);
/** The parties whose fog this player sees: those with a character they own on the roster, or the only party there is. */
function playerPartyIds(projection, pass) {
  if (!projection) return [];
  if (pass?.mineOf === projection) return pass.mine;
  const all = Object.entries(projection?.parties ?? {});
  let mine = all.filter(([, party]) => (party.members ?? []).some(id => game.actors?.get(id)?.isOwner)).map(([id]) => id);
  if (!mine.length && all.length === 1) mine = [all[0][0]];
  if (pass) Object.assign(pass, { mineOf: projection, mine });
  return mine;
}
export const HexRecords = {
  read(offset, target, pass = null) {
    const scene = sceneRef(target), key = offsetKey(offset);
    if (!key || !scene) return null;
    // A pass memoizes the reads shared by every cell: the store journal, the decoded tag store and the pin index.
    const reuse = pass?.scene === scene ? pass : null;
    if (!game.user?.isGM) {
      // Cache the resolved projection, not just the journal: `journal.flags` is a live accessor.
      const projection = reuse ? (reuse.public ??= recordJournal(scene, { publicOnly: true })?.flags?.[MODULE_ID]?.[PUBLIC_FLAG]) : recordJournal(scene, { publicOnly: true })?.flags?.[MODULE_ID]?.[PUBLIC_FLAG];
      // A player's party decides: its copy wins over what everyone knows, so a party's own conceal holds. A missing
      // entry means it matches the shared cell; null means the party does not see the hex. Only a player in no party reads the shared cell.
      const mine = playerPartyIds(projection, reuse), shared = projection?.cells?.[key];
      const data = bestProjection(mine.length ? mine.map(id => { const own = projection.parties[id]?.cells; return own && Object.hasOwn(own, key) ? own[key] : shared; }) : [shared]);
      if (!data) return null;
      const out = clone(data);
      if (locationVisible(out.discovery)) {
        out.keyed = keyedPages(scene, out.num, reuse);
        if (!out.title && keyedTitle(out.keyed)) out.title = keyedTitle(out.keyed);
      }
      return out;
    }
    const store = reuse ? (reuse.record ??= recordJournal(scene)?.flags?.[MODULE_ID]?.[RECORD_FLAG]) : recordJournal(scene)?.flags?.[MODULE_ID]?.[RECORD_FLAG];
    const cell = store?.cells?.[key] ?? {};
    const num = hexNumberAt(offset, scene);
    const tags = reuse ? (reuse.tags ??= decodeTags(scene.getFlag?.(MODULE_ID, "hexTags"))) : decodeTags(scene.getFlag?.(MODULE_ID, "hexTags"));
    const raw = num === null ? null : tags.cells.get(String(num));
    const tag = raw ? { ...raw, ...readCell(tags, num) } : null;
    return recordView({ sceneUuid: sceneUuid(scene), offset, num, cell, tag, keyed: keyedPages(scene, num, reuse), rowName: rowNameOf(scene, num, tag) });
  },
  async get(offset, target) {
    const scene = sceneRef(target), record = this.read(offset, scene);
    if (!record || !game.user?.isGM || record.num === null) return record;
    const { sceneZones } = await import("./hex-region.mjs");
    const region = (await sceneZones(scene)).byNum.get(record.num);
    return region ? { ...record, region: region.zone, regionProvenance: "existing-region" } : record;
  },
  async write(offset, patch, target) {
    if (!game.user?.isGM) throw new Error("SDE.hexRecords.gmOnly");
    const scene = sceneRef(target), key = offsetKey(offset);
    if (!key || !scene || !patch || typeof patch !== "object" || Array.isArray(patch)) throw new Error("SDE.hexRecords.invalidCell");
    for (const field of Object.keys(patch)) if (!WRITABLE_CELL_FIELDS.has(field)) throw new Error("SDE.hexRecords.protectedField");
    // E3 writes terrain/line features through hexTags; never shadow a numbered tag here.
    if (hexNumberAt(offset, scene) !== null && Object.hasOwn(patch, "terrain")) throw new Error("SDE.hexRecords.useTags");
    const { adoptHexScene, withHexLock } = await import("./hex-adoption.mjs");
    await adoptHexScene(scene);
    return withHexLock(scene, async () => {
      const journal = recordJournal(scene);
      if (!journal) throw new Error("SDE.hexRecords.unreadable");
      assertPrivateJournal(journal);
      const saved = clone(journal.flags[MODULE_ID][RECORD_FLAG]);
      saved.cells[key] = { ...(saved.cells[key] ?? {}), ...clone(patch) };
      await replaceModuleFlag(journal, RECORD_FLAG, saved);
      await publishHexProjection(scene);
      return this.read(offset, scene);
    });
  },
};
/** Refuse a pre-existing unsafe native store, rather than claiming old exposure was repaired. */
export function assertPrivateJournal(journal) {
  assertPrivatePack(game.packs?.get(PRIVATE_PACK));
  if (Number(journal.ownership?.default ?? 0) > 0 || Object.entries(journal.ownership ?? {}).some(([id, level]) => id !== "default" && Number(level) > 0 && !game.users?.get?.(id)?.isGM)) throw new Error("SDE.hexRecords.unsafeStore");
}
/** The module's private record store: the pack it lives in, or its own record flag on a journal (or one of its pages). */
export function isHexRecordStore(document) {
  const journal = document?.documentName === "JournalEntryPage" ? document.parent : document;
  return !!journal && (journal.pack === PRIVATE_PACK || journal.flags?.[MODULE_ID]?.[RECORD_FLAG] !== undefined);
}
/** The actor ids on a party's roster, as the players' view names them. */
export function partyMemberIds(actor) {
  try { return Party.members(actor).map(uuid => String(uuid).replace(/^Actor\./, "")); } catch { return []; } // an unadopted party has no roster
}
export async function publishHexProjection(target) {
  if (!game.user?.isGM) return;
  const scene = sceneRef(target), journal = recordJournal(scene);
  if (!journal) return;
  assertPrivateJournal(journal);
  // Cells hold what every party knows; each party's own differences are projected apart, so one party's map is not another's.
  const cells = {}, parties = {};
  for (const actor of Party.list()) parties[actor.id] = { members: partyMemberIds(actor), cells: {} };
  // One pass for every cell: a lone read decodes all ~4,800 tags (6 ms each in Firefox), and this runs on every
  // reveal, once for each recorded hex (a second a walked hex on the Western Reaches map before it had one).
  const pass = readPass(scene);
  for (const key of Object.keys(journal.flags[MODULE_ID][RECORD_FLAG].cells ?? {})) {
    const [i, j] = key.split("_").map(Number), record = HexRecords.read({ i, j }, scene, pass);
    const shown = (ids) => playerProjection({ ...record, discovery: effectiveDiscovery(record.discovery, ids) });
    const everyone = shown([]), same = JSON.stringify(everyone);
    if (everyone) cells[key] = everyone;
    // A party's cell is stored only where it differs from the shared one (null: the party does not see the hex).
    for (const id of Object.keys(parties)) {
      const own = shown([id]);
      if (JSON.stringify(own) !== same) parties[id].cells[key] = own;
    }
  }
  const value = { version: 1, sceneUuid: sceneUuid(scene), cells, parties };
  const publicJournal = recordJournal(scene, { publicOnly: true });
  if (publicJournal) await replaceModuleFlag(publicJournal, PUBLIC_FLAG, value);
  else await JournalEntry.create({ name: game.i18n.format("SDE.hexRecords.publicName", { scene: scene.name }), ownership: { default: 2 }, flags: { [MODULE_ID]: { [PUBLIC_FLAG]: value } } });
}
