/** Native offset records. Tags, keyed pages and regions remain their own authorities.
 * Private records live ONLY in a GM-only world JournalEntry compendium. World
 * journal flags reach every client even at NONE ownership in Foundry 14.
 * Pack ownership provides ordinary Foundry spoiler protection, not raw-data
 * confidentiality: deliberate document API access can bypass the UI boundary.
 * A separate OBSERVER journal carries an allowlisted disclosure projection, not a tag store.
 */
import { MODULE_ID } from "../shared/module-id.mjs";
import { decodeTags, readCell, FEATURES, normalizeTerrainWord } from "./tag-store.mjs";
import { hexNumberAt } from "./hex-number-api.mjs";
import { replaceModuleFlag } from "../shared/module-flags.mjs";
import { disclosure } from "./hex-fog-core.mjs";

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
const journals = () => globalThis.game?.journal?.contents ?? [];
export function recordJournal(scene, { publicOnly = false } = {}) {
  if (!publicOnly && !globalThis.game?.user?.isGM) return null;
  const flag = publicOnly ? PUBLIC_FLAG : RECORD_FLAG;
  const source = publicOnly ? journals() : [...privateJournals.values()];
  const hits = source.filter(j => j.flags?.[MODULE_ID]?.[flag]?.sceneUuid === sceneUuid(scene));
  if (hits.length > 1) throw new Error("SDE.hexRecords.duplicateStore");
  return hits[0] ?? null;
}
export const isHexAdopted = scene => sceneRef(scene)?.getFlag?.(MODULE_ID, RECORD_FLAG)?.adopted === true;

/** Compose one cell without copying the tag store. Tag edits, even a removed line, win. */
export function recordView({ sceneUuid: uuid, offset, num, cell = {}, tag = null, keyed = [], region = null }) {
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
    features: (record.features ?? []).filter(f => f?.discovered === true && (FEATURES.includes(f.type) || location))
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
function keyedPages(scene, num) {
  if (num === null) return [];
  const out = [];
  for (const note of scene?.notes?.contents ?? []) {
    if (note.getFlag?.(MODULE_ID, "hexPin")?.num !== num) continue;
    const entry = game.journal?.get?.(note.entryId), page = entry?.pages?.get?.(note.pageId);
    if (!page || !entry?.testUserPermission?.(game.user, "OBSERVER") || !page.testUserPermission?.(game.user, "OBSERVER")) continue;
    out.push({ uuid: page.uuid, title: page.name });
  }
  return out;
}
export const HexRecords = {
  read(offset, target) {
    const scene = sceneRef(target), key = offsetKey(offset);
    if (!key || !scene) return null;
    if (!game.user?.isGM) {
      const data = recordJournal(scene, { publicOnly: true })?.flags?.[MODULE_ID]?.[PUBLIC_FLAG]?.cells?.[key];
      if (!data) return null;
      const out = clone(data);
      if (locationVisible(out.discovery)) out.keyed = keyedPages(scene, out.num);
      return out;
    }
    const cell = recordJournal(scene)?.flags?.[MODULE_ID]?.[RECORD_FLAG]?.cells?.[key] ?? {};
    const num = hexNumberAt(offset, scene), tags = decodeTags(scene.getFlag?.(MODULE_ID, "hexTags"));
    const raw = num === null ? null : tags.cells.get(String(num));
    const tag = raw ? { ...raw, ...readCell(tags, num) } : null;
    return recordView({ sceneUuid: sceneUuid(scene), offset, num, cell, tag, keyed: keyedPages(scene, num) });
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
export async function publishHexProjection(target) {
  if (!game.user?.isGM) return;
  const scene = sceneRef(target), journal = recordJournal(scene);
  if (!journal) return;
  assertPrivateJournal(journal);
  const cells = {};
  for (const key of Object.keys(journal.flags[MODULE_ID][RECORD_FLAG].cells ?? {})) {
    const [i, j] = key.split("_").map(Number);
    const projection = playerProjection(HexRecords.read({ i, j }, scene));
    if (projection) cells[key] = projection;
  }
  const value = { version: 1, sceneUuid: sceneUuid(scene), cells };
  const publicJournal = recordJournal(scene, { publicOnly: true });
  if (publicJournal) await replaceModuleFlag(publicJournal, PUBLIC_FLAG, value);
  else await JournalEntry.create({ name: game.i18n.format("SDE.hexRecords.publicName", { scene: scene.name }), ownership: { default: 2 }, flags: { [MODULE_ID]: { [PUBLIC_FLAG]: value } } });
}
